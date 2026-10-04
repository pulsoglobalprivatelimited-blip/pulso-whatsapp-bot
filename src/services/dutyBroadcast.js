'use strict';
/* Duty broadcast (founder, 4 Oct 2026).

   Ops press "Send broadcast" on a Basic booking in the admin panel. The Pulso
   server picks the same caregivers the booking's app offer was pushed to,
   keeps the Basic ones, and hands the duty and that list to this module, which
   sends each caregiver one WhatsApp template:

     New duty: <place>  ·  <24-hour>  ·  from <date> for <days> days  ·  Pay ₹<pay>/day
     [ I'm interested ]  [ Not now ]  [ Call Pulso ]   (Call Pulso dials 8714105333)

   Her answer goes to ONE number on WhatsApp (DUTY_INTEREST_PHONE, Sanju) and
   nowhere else: no owner alert, no second reviewer, no desk, no Pulso app alert.
*/
const config = require('../config');
const { getFirestore } = require('./storage');
const { sendTemplate, sendText } = require('./metaClient');
const { getMessageText } = require('./messageParser');

const COLLECTION = 'dutyBroadcasts';
const BY_PHONE = 'dutyBroadcastRecipients';
const PAYLOAD_INTEREST = 'dutybc_interest_';
const PAYLOAD_NOT_NOW = 'dutybc_notnow_';
const FORWARD_WINDOW_MS = 48 * 60 * 60 * 1000;

const CAREGIVER_THANKS = {
  ml: 'നന്ദി. Pulso team ഉടൻ വിളിക്കും.',
  en: 'Thank you. The Pulso team will call you soon.'
};
const CAREGIVER_STOPPED = {
  ml: 'ശരി. ഇനി duty messages അയയ്ക്കില്ല.',
  en: 'Okay. We will not send you duty messages any more.'
};
const HOURS_LABEL = {
  ml: { '24h': '24 മണിക്കൂർ', '8h': '8 മണിക്കൂർ' },
  en: { '24h': '24-hour', '8h': '8-hour' }
};

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function interestPhone() {
  return normalizePhone(config.dutyInterestPhone);
}

function templateValue(value) {
  const text = String(value === 0 ? '0' : value || '').replace(/\s+/g, ' ').trim();
  return text || '-';
}

// The caregiver's language, from her onboarding chat; Malayalam when unknown.
async function languageFor(phone) {
  try {
    const snap = await getFirestore().collection('providers').doc(phone).get();
    const flowId = String((snap.exists && snap.data().flowId) || '');
    return /english/.test(flowId) ? 'en' : 'ml';
  } catch (_) {
    return 'ml';
  }
}

async function isOptedOut(phone) {
  try {
    const snap = await getFirestore().collection(BY_PHONE).doc(phone).get();
    return Boolean(snap.exists && snap.data().optedOut === true);
  } catch (_) {
    return false;
  }
}

function buildOfferComponents(duty, broadcastId, language) {
  const values = [
    duty.place,
    (HOURS_LABEL[language] || HOURS_LABEL.en)[duty.hours] || duty.hours,
    duty.startLabel,
    duty.days,
    duty.pay
  ].map(templateValue);
  return [
    { type: 'body', parameters: values.map((text) => ({ type: 'text', text })) },
    { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `${PAYLOAD_INTEREST}${broadcastId}` }] },
    { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: `${PAYLOAD_NOT_NOW}${broadcastId}` }] }
  ];
}

function validateDuty(duty) {
  const missing = ['place', 'hours', 'startLabel', 'days', 'pay'].filter((k) => !duty || duty[k] === undefined || duty[k] === null || duty[k] === '');
  if (missing.length) throw new Error(`Duty is missing ${missing.join(', ')}`);
  if (!['24h', '8h'].includes(duty.hours)) throw new Error('Duty hours must be 24h or 8h');
}

/* Send the duty to a list. A caregiver gets one message per broadcast: anyone
   already sent is skipped, so "Send again" only reaches people not yet sent to
   or (onlyUnanswered) not yet answered. */
async function sendDutyBroadcast({ broadcastId, duty, bookingLabel, recipients, sentBy, onlyUnanswered = false }) {
  if (!config.dutyBroadcastEnabled) {
    throw new Error('Duty broadcast templates are not approved yet');
  }
  const id = String(broadcastId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new Error('broadcastId required');
  validateDuty(duty);

  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(id);
  const existing = (await ref.get()).data() || {};
  const sent = { ...(existing.recipients || {}) };
  const now = new Date().toISOString();
  const result = { sent: 0, skipped: 0, failed: 0, optedOut: 0 };

  const list = [];
  const seen = new Set();
  for (const r of Array.isArray(recipients) ? recipients : []) {
    const phone = normalizePhone(r && r.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    list.push({ phone, name: String((r && r.name) || '').trim() });
  }

  for (const r of list) {
    const before = sent[r.phone];
    if (before && (!onlyUnanswered || before.answer)) {
      result.skipped += 1;
      continue;
    }
    if (before && onlyUnanswered && before.resentAt) {
      result.skipped += 1;
      continue;
    }
    if (await isOptedOut(r.phone)) {
      result.optedOut += 1;
      continue;
    }
    let language = await languageFor(r.phone);
    try {
      try {
        await sendTemplate(r.phone, config.dutyOfferTemplateName, language, buildOfferComponents(duty, id, language));
      } catch (error) {
        // The Malayalam template may not be approved yet; English always is
        // (it is the one the switch-on waits for).
        if (language === 'en') throw error;
        console.warn('[DUTY_BROADCAST_ML_FALLBACK]', r.phone, error.message);
        language = 'en';
        await sendTemplate(r.phone, config.dutyOfferTemplateName, language, buildOfferComponents(duty, id, language));
      }
      sent[r.phone] = before
        ? { ...before, resentAt: now }
        : { name: r.name, language, sentAt: now, answer: null, answeredAt: null };
      await db.collection(BY_PHONE).doc(r.phone).set({ lastBroadcastId: id, lastSentAt: now }, { merge: true });
      result.sent += 1;
    } catch (error) {
      sent[r.phone] = { ...(before || { name: r.name, language }), failedAt: now, error: String(error.message || error).slice(0, 200) };
      result.failed += 1;
    }
  }

  await ref.set(
    {
      broadcastId: id,
      duty,
      bookingLabel: String(bookingLabel || existing.bookingLabel || '').trim(),
      recipients: sent,
      updatedAt: now,
      createdAt: existing.createdAt || now,
      sends: [...(existing.sends || []), { at: now, by: String(sentBy || ''), ...result, onlyUnanswered: Boolean(onlyUnanswered) }]
    },
    { merge: false }
  );
  return { ...result, status: summarize(sent) };
}

function summarize(recipients) {
  const rows = Object.values(recipients || {});
  const out = { total: rows.length, interested: 0, notNow: 0, noAnswer: 0, failed: 0 };
  for (const r of rows) {
    if (r.answer === 'interested') out.interested += 1;
    else if (r.answer === 'not_now') out.notNow += 1;
    else if (r.failedAt && !r.sentAt) out.failed += 1;
    else out.noAnswer += 1;
  }
  return out;
}

async function getDutyBroadcastStatus(broadcastId) {
  const snap = await getFirestore().collection(COLLECTION).doc(String(broadcastId || '')).get();
  if (!snap.exists) return null;
  const data = snap.data();
  const sends = data.sends || [];
  return { ...summarize(data.recipients), firstSentAt: sends.length ? sends[0].at : null, lastSentAt: sends.length ? sends[sends.length - 1].at : null };
}

// The message to the one interest number. A template when approved, so it
// reaches that number even when its chat has been quiet for 24 hours.
async function tellInterestPhone(caregiver, broadcast) {
  const to = interestPhone();
  if (!to) return null;
  const forLine = [broadcast.bookingLabel, broadcast.duty && broadcast.duty.place].filter(Boolean).join(', ');
  if (config.dutyInterestTemplateName && config.dutyBroadcastEnabled) {
    const { signCallToken } = require('./opsNotifications');
    try {
      return await sendTemplate(to, config.dutyInterestTemplateName, 'en', [
        {
          type: 'body',
          parameters: [caregiver.name || '-', caregiver.phone, caregiver.district || '-', forLine || '-'].map((t) => ({ type: 'text', text: templateValue(t) }))
        },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: signCallToken(caregiver.phone) }] }
      ]);
    } catch (error) {
      console.error('[DUTY_INTEREST_TEMPLATE_ERROR]', error.message);
    }
  }
  const { buildCallLink } = require('./opsNotifications');
  return sendText(
    to,
    `A Basic caregiver tapped I am interested on a duty broadcast.\nName: ${caregiver.name || '-'}\nPhone: ${caregiver.phone}\nDistrict: ${caregiver.district || '-'}\nFor: ${forLine || '-'}\nCall her: ${buildCallLink(caregiver.phone)}`
  );
}

async function caregiverDetails(phone, fallbackName) {
  try {
    const p = (await getFirestore().collection('providers').doc(phone).get()).data() || {};
    return { phone, name: p.fullName || fallbackName || '', district: p.district || '' };
  } catch (_) {
    return { phone, name: fallbackName || '', district: '' };
  }
}

function replyPayload(message) {
  if (!message) return '';
  if (message.type === 'button' && message.button) return String(message.button.payload || '');
  const i = message.interactive;
  return String((i && ((i.button_reply && i.button_reply.id) || (i.list_reply && i.list_reply.id))) || '');
}

/* A caregiver's reply to a broadcast. Returns true when it was one (and the
   onboarding flow should not see it), false otherwise. */
async function handleDutyBroadcastReply(phone, message) {
  const caller = normalizePhone(phone);
  const payload = replyPayload(message);
  const db = getFirestore();

  if (payload.startsWith(PAYLOAD_INTEREST) || payload.startsWith(PAYLOAD_NOT_NOW)) {
    const interested = payload.startsWith(PAYLOAD_INTEREST);
    const id = payload.slice((interested ? PAYLOAD_INTEREST : PAYLOAD_NOT_NOW).length);
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return true;
    const broadcast = snap.data();
    const mine = (broadcast.recipients || {})[caller] || {};
    const language = mine.language || (await languageFor(caller));
    const already = mine.answer === 'interested';
    await ref.set(
      { recipients: { [caller]: { ...mine, answer: interested ? 'interested' : 'not_now', answeredAt: new Date().toISOString() } } },
      { merge: true }
    );
    if (interested) {
      await sendText(caller, CAREGIVER_THANKS[language] || CAREGIVER_THANKS.ml);
      if (!already) await tellInterestPhone(await caregiverDetails(caller, mine.name), broadcast);
    }
    return true;
  }

  // Typed words from someone who had a broadcast recently: STOP opts out;
  // anything else is forwarded to the interest number, and the onboarding
  // flow still answers her as it always has.
  const text = String(getMessageText(message) || '').trim();
  if (!text) return false;
  const marker = (await db.collection(BY_PHONE).doc(caller).get()).data();
  const recent = marker && marker.lastSentAt && Date.now() - Date.parse(marker.lastSentAt) < FORWARD_WINDOW_MS;
  if (!recent) return false;
  if (/^\s*stop\s*$/i.test(text)) {
    await db.collection(BY_PHONE).doc(caller).set({ optedOut: true, optedOutAt: new Date().toISOString() }, { merge: true });
    const language = await languageFor(caller);
    await sendText(caller, CAREGIVER_STOPPED[language] || CAREGIVER_STOPPED.ml);
    return true;
  }
  try {
    const who = await caregiverDetails(caller);
    const to = interestPhone();
    if (to) await sendText(to, `Message from ${who.name || caller} (${caller}) about a duty broadcast:\n"${text.slice(0, 500)}"`);
  } catch (error) {
    console.error('[DUTY_FORWARD_ERROR]', error.message);
  }
  return false;
}

module.exports = {
  sendDutyBroadcast,
  getDutyBroadcastStatus,
  handleDutyBroadcastReply,
  buildOfferComponents,
  summarize,
  PAYLOAD_INTEREST,
  PAYLOAD_NOT_NOW,
  CAREGIVER_THANKS
};
