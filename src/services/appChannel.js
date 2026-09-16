'use strict';
/**
 * The onboarding bot, spoken through the Pulso app.
 *
 * WhatsApp is one pipe into `processIncomingMessage`; this is the second. The
 * app sends what the person typed, tapped or uploaded; we shape it as the Meta
 * webhook would have, run the very same flow, and hand back what the bot
 * replied — collected instead of posted to Meta. The bot's steps, its record
 * per phone number, its reviewer alert and its sync to pulso-hub do not know
 * the difference. Plan: pulso_hub/docs/in_app_onboarding_bots_plan.md.
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { getHubApp } = require('./hubStorage');
const { runCollected, registerAppMedia } = require('./metaClient');
const { getMessageText } = require('./messageParser');

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function str(value, max = 2000) {
  return (value === undefined || value === null ? '' : String(value)).trim().slice(0, max);
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Express middleware: the app's Firebase sign-in token, verified against the
 * pulso-hub project (the app the bot already holds a client for). Only a phone
 * sign-in is accepted — the phone number is the key to the bot's record.
 */
function requireAppUser(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ ok: false, error: 'sign_in_required' });
  }
  return admin
    .auth(getHubApp())
    .verifyIdToken(token)
    .then((decoded) => {
      const phone = phoneDigits(decoded.phone_number);
      if (!phone) {
        return res.status(403).json({ ok: false, error: 'phone_sign_in_required' });
      }
      req.appUser = { uid: decoded.uid, phone };
      return next();
    })
    .catch((error) => {
      console.warn('[APP_CHANNEL] token rejected', error && error.message ? error.message : error);
      return res.status(401).json({ ok: false, error: 'invalid_token' });
    });
}

/**
 * What the app sent → the message object the webhook would have delivered.
 * A tapped button becomes a button_reply, a list row a list_reply, a file an
 * image/document carrying an `app:` media id the media helpers understand.
 */
function buildAppMessage({ phone, text, buttonId, buttonTitle, listRowId, listRowTitle, file, start } = {}) {
  const from = phoneDigits(phone);
  if (!from) throw new Error('phone required');
  const id = `app-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const base = { id, from, timestamp: String(Math.floor(Date.now() / 1000)), channel: 'app' };

  if (file && file.buffer && file.buffer.length) {
    if (file.buffer.length > MAX_UPLOAD_BYTES) throw new Error('file too large');
    const mime = str(file.mimetype, 100) || 'application/octet-stream';
    const filename = str(file.originalname, 200);
    const mediaId = registerAppMedia({ buffer: file.buffer, mime, filename });
    if (mime.startsWith('image/')) {
      return { ...base, type: 'image', image: { id: mediaId, mime_type: mime } };
    }
    return { ...base, type: 'document', document: { id: mediaId, mime_type: mime, filename: filename || 'document' } };
  }

  const bid = str(buttonId, 200);
  if (bid) {
    return {
      ...base,
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: bid, title: str(buttonTitle, 60) || bid } },
    };
  }
  const rid = str(listRowId, 200);
  if (rid) {
    return {
      ...base,
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: rid, title: str(listRowTitle, 60) || rid } },
    };
  }
  const body = start === true ? 'Hi' : str(text, 4000);
  if (!body) throw new Error('nothing to send');
  return { ...base, type: 'text', text: { body } };
}

/** A Meta send payload (what the bot would have posted) → what the app draws. */
function payloadToAppMessage(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const type = str(payload.type, 20);
  if (type === 'text') {
    const text = str(payload.text && payload.text.body, 4000);
    return text ? { kind: 'text', text } : null;
  }
  if (type === 'interactive') {
    const inter = payload.interactive || {};
    const body = str(inter.body && inter.body.text, 4000);
    if (inter.type === 'button') {
      const buttons = ((inter.action && inter.action.buttons) || [])
        .map((b) => ({ id: str(b.reply && b.reply.id, 200), title: str(b.reply && b.reply.title, 60) }))
        .filter((b) => b.id && b.title)
        .slice(0, 3);
      return { kind: 'buttons', text: body, buttons };
    }
    if (inter.type === 'list') {
      const sections = ((inter.action && inter.action.sections) || []).map((s) => ({
        title: str(s.title, 60),
        rows: (s.rows || [])
          .map((r) => ({ id: str(r.id, 200), title: str(r.title, 60), description: str(r.description, 120) }))
          .filter((r) => r.id && r.title),
      }));
      return { kind: 'list', text: body, buttonText: str(inter.action && inter.action.button, 40) || 'Choose', sections };
    }
    return body ? { kind: 'text', text: body } : null;
  }
  if (type === 'video' || type === 'image' || type === 'audio' || type === 'document') {
    const media = payload[type] || {};
    const out = { kind: type, text: str(media.caption, 1024) };
    if (media.id) out.mediaId = str(media.id, 120);
    if (media.link) out.url = str(media.link, 500);
    if (type === 'document' && media.filename) out.filename = str(media.filename, 240);
    return out.mediaId || out.url ? out : null;
  }
  // Templates exist for WhatsApp's 24-hour window; the same words reach the
  // app as plain sends, so a template alone has nothing to draw.
  return null;
}

/** One inbound webhook-shaped message → the person's own bubble. */
function inboundToAppMessage(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.type === 'image') return { kind: 'sent_image', text: '📷 Photo', outgoing: true };
  if (message.type === 'document') {
    const name = str(message.document && message.document.filename, 200);
    return { kind: 'sent_file', text: name ? `📄 ${name}` : '📄 Document', outgoing: true };
  }
  const text = str(getMessageText(message), 4000);
  if (!text) return null;
  // The app's opening tap is a plain "Hi" to the bot; the person tapped a
  // button, so show the button.
  return { kind: 'text', text: message.channel === 'app' && text === 'Hi' ? 'Caregiver / nurse job' : text, outgoing: true };
}

/** The bot's own log for one outbound send → what the app draws. */
function outboundToAppMessage(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const kind = str(payload.kind, 20);
  const body = payload.body;
  if (kind === 'buttons' && body && typeof body === 'object') {
    return {
      kind: 'buttons',
      text: str(body.body, 4000),
      buttons: (body.buttons || []).map((b) => ({ id: str(b.id, 200), title: str(b.title, 60) })).filter((b) => b.id && b.title).slice(0, 3),
    };
  }
  if (kind === 'list' && body && typeof body === 'object') {
    return {
      kind: 'list',
      text: str(body.body, 4000),
      buttonText: str(body.buttonText, 40) || 'Choose',
      sections: (body.sections || []).map((s) => ({
        title: str(s.title, 60),
        rows: (s.rows || []).map((r) => ({ id: str(r.id, 200), title: str(r.title, 60), description: str(r.description, 120) })).filter((r) => r.id && r.title),
      })),
    };
  }
  if (kind === 'video' && body && typeof body === 'object') {
    return body.mediaId ? { kind: 'video', mediaId: str(body.mediaId, 120), text: str(body.caption, 1024) } : null;
  }
  if (kind === 'template') return null;
  const text = typeof body === 'string' ? str(body, 4000) : str(body && body.body, 4000);
  return text ? { kind: 'text', text } : null;
}

function eventTime(event) {
  return str(event && (event.timestamp || event.at || event.createdAt || event.sentAt), 40);
}

/**
 * The provider record's history → the chat, oldest first. Both directions,
 * whichever pipe they came through, so a person who started on WhatsApp and
 * opened the app sees the whole conversation.
 */
function historyToAppMessages(history) {
  const list = Array.isArray(history) ? history : [];
  const out = [];
  list.forEach((event, index) => {
    if (!event || typeof event !== 'object') return;
    let message = null;
    if (event.type === 'inbound_message') message = inboundToAppMessage(event.payload);
    else if (event.type === 'outbound_message') message = outboundToAppMessage(event.payload);
    if (!message) return;
    out.push({ ...message, at: eventTime(event), id: `h${index}` });
  });
  return out;
}

/**
 * Run one turn of the bot for the app and collect what it replied. The flow's
 * own timers (a nudge twenty seconds after a certificate, say) fire after this
 * returns; they are logged into the record's history like every send, and the
 * app's next state read shows them.
 */
async function runAppTurn({ processIncomingMessage, phone, message }) {
  const { replies } = await runCollected(() => processIncomingMessage(phoneDigits(phone), message));
  return replies.map(payloadToAppMessage).filter(Boolean);
}

module.exports = {
  requireAppUser,
  buildAppMessage,
  payloadToAppMessage,
  inboundToAppMessage,
  outboundToAppMessage,
  historyToAppMessages,
  runAppTurn,
  phoneDigits,
  MAX_UPLOAD_BYTES,
};
