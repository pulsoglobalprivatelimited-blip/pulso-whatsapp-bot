const axios = require('axios');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const config = require('../config');

// ---- The app pipe -----------------------------------------------------------
// When a turn comes from the Pulso app instead of WhatsApp, every send the flow
// makes is collected here and handed back to the app instead of posted to Meta.
// A per-call store, never a global switch: the webhook keeps sending while an
// app turn is being collected next to it. Sends the flow schedules with a timer
// inherit the same store and are still logged into the record's history, which
// is where the app reads them from on its next state check.
const collector = new AsyncLocalStorage();

// Only what the bot says TO THIS PERSON is collected. The same call also sends
// the reviewer their certificate alert and ops their notifications — those must
// still go to WhatsApp, and must never be handed to the app, which would show a
// caregiver the Approve / Reject buttons meant for the reviewer.
async function runCollected(fn, { onlyTo, channel } = {}) {
  const replies = [];
  const store = {
    replies,
    onlyTo: String(onlyTo || '').replace(/\D/g, ''),
    // Which door this turn came through. Set once here rather than threaded
    // through every appendHistory call, so a WhatsApp turn can never pick it up.
    channel: channel || ''
  };
  const result = await collector.run(store, () => fn());
  return { result, replies };
}

/** The channel of the turn in progress, or '' for WhatsApp. */
function currentChannel() {
  const store = collector.getStore();
  return (store && store.channel) || '';
}

function collectorFor(payload) {
  const store = collector.getStore();
  if (!store) return null;
  if (!store.onlyTo) return store;
  const to = String((payload && payload.to) || '').replace(/\D/g, '');
  return to && to === store.onlyTo ? store : null;
}

// Files the app uploads live here for the length of one turn: the flow's media
// helpers read them by an `app:` id exactly as they read a Meta media id.
const appMedia = new Map();

function registerAppMedia({ buffer, mime, filename }) {
  const id = `app:${crypto.randomBytes(8).toString('hex')}`;
  appMedia.set(id, { buffer, mime: mime || 'application/octet-stream', filename: filename || '', at: Date.now() });
  // Anything not read within ten minutes is forgotten.
  for (const [key, value] of appMedia) {
    if (Date.now() - value.at > 10 * 60 * 1000) appMedia.delete(key);
  }
  return id;
}

function isAppMediaId(value) {
  return typeof value === 'string' && value.startsWith('app:');
}

function logDryRun(payload) {
  console.log('[DRY RUN] WhatsApp send', JSON.stringify(payload, null, 2));
}

function durationSince(startedAt) {
  return Date.now() - startedAt;
}

function getResponseMessageIds(data) {
  return data && Array.isArray(data.messages)
    ? data.messages.map((message) => message.id).filter(Boolean)
    : [];
}

function summarizeSend(payload, phoneNumberId, extra = {}) {
  return {
    to: payload && payload.to ? payload.to : null,
    type: payload && payload.type ? payload.type : null,
    phoneNumberId,
    ...extra
  };
}

async function sendRequest(payload, options = {}) {
  const collected = collectorFor(payload);
  if (collected) {
    collected.replies.push(payload);
    return { collected: true, messages: [{ id: `app-${Date.now()}-${collected.replies.length}` }] };
  }

  const startedAt = Date.now();
  const phoneNumberId = options.phoneNumberId || config.phoneNumberId;

  if (config.dryRun || !config.whatsappToken || !phoneNumberId) {
    logDryRun(payload);
    console.log(
      '[WHATSAPP_SEND_TIMING]',
      JSON.stringify(
        summarizeSend(payload, phoneNumberId, {
          result: 'dry_run',
          durationMs: durationSince(startedAt)
        })
      )
    );
    return { dryRun: true, payload };
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${phoneNumberId}/messages`;
  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(
      '[WHATSAPP_SEND_TIMING]',
      JSON.stringify(
        summarizeSend(payload, phoneNumberId, {
          result: 'ok',
          status: response.status,
          durationMs: durationSince(startedAt),
          messageIds: getResponseMessageIds(response.data)
        })
      )
    );

    return response.data;
  } catch (error) {
    console.error(
      '[WHATSAPP_SEND_TIMING]',
      JSON.stringify(
        summarizeSend(payload, phoneNumberId, {
          result: 'error',
          status: error && error.response ? error.response.status : null,
          durationMs: durationSince(startedAt),
          message: error && error.message ? error.message : 'send_failed'
        })
      )
    );
    throw error;
  }
}

async function sendText(to, body, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body }
  }, options);
}

async function sendImageById(to, mediaId, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      id: mediaId,
      caption
    }
  }, options);
}

// Media uploaded through the app never gets a Meta media id, so the only way to
// hand it to WhatsApp is a link Meta can fetch — the signed archive URL.
async function sendImageByUrl(to, link, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      link,
      caption
    }
  }, options);
}

async function sendDocumentByUrl(to, link, filename, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: {
      link,
      filename,
      caption
    }
  }, options);
}

async function sendDocumentById(to, mediaId, filename, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: {
      id: mediaId,
      filename,
      caption
    }
  }, options);
}

async function sendVideoById(to, mediaId, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'video',
    video: {
      id: mediaId,
      caption
    }
  }, options);
}

async function sendButtons(to, body, buttons, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: {
            id: button.id,
            title: button.title
          }
        }))
      }
    }
  }, options);
}

async function sendTemplate(to, name, languageCode, components, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: {
        code: languageCode
      },
      ...(components && components.length ? { components } : {})
    }
  }, options);
}

async function sendList(to, body, buttonText, sections, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText,
        sections: sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description
          }))
        }))
      }
    }
  }, options);
}

async function sendAudio(to, mediaId, options) {
  if (!mediaId) {
    return sendText(to, 'Audio placeholder: configure WORKING_MODEL_AUDIO_MEDIA_ID to send the actual working-model voice note.');
  }

  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: { id: mediaId }
  }, options);
}

async function sendTermsAndConditions(to, url, options) {
  if (!url) {
    return sendText(to, 'Terms and conditions placeholder: configure TERMS_AND_CONDITIONS_URL to send the final link.');
  }

  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: `Terms and conditions: ${url}` }
  }, options);
}

async function getMediaMetadata(mediaId) {
  if (isAppMediaId(mediaId)) {
    const entry = appMedia.get(mediaId);
    if (!entry) throw new Error('app media expired');
    return { id: mediaId, mime_type: entry.mime, file_size: entry.buffer.length, url: mediaId };
  }
  if (!config.whatsappToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is required to fetch media metadata.');
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${mediaId}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`
    }
  });

  return response.data;
}

async function downloadMediaFile(url) {
  if (isAppMediaId(url)) {
    const entry = appMedia.get(url);
    if (!entry) throw new Error('app media expired');
    appMedia.delete(url);
    return entry.buffer;
  }
  if (!config.whatsappToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is required to download media files.');
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`
    }
  });

  return Buffer.from(response.data);
}

module.exports = {
  sendText,
  sendImageById,
  sendDocumentById,
  sendImageByUrl,
  sendDocumentByUrl,
  sendVideoById,
  sendButtons,
  sendList,
  sendTemplate,
  sendAudio,
  sendTermsAndConditions,
  getMediaMetadata,
  downloadMediaFile,
  runCollected,
  currentChannel,
  registerAppMedia,
  isAppMediaId
};
