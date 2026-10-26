'use strict';
/* Offer feedback (founder, 25 Oct 2026).

   302 caregivers got duty offers in the app in the week of 18–25 Oct and
   accepted none. This asks each of them why, once, on the onboarding number,
   with one template (caregiver_offer_feedback, Malayalam only) and tap-to-
   answer buttons. Every answer is kept here (offerFeedback/{phone}) and on her
   Pulso profile (pulso-hub users.offerFeedback). "Free now" — and FREE typed
   after a family/health answer — alerts Sanju (DUTY_INTEREST_PHONE) and
   +91 94466 00809.

   All caregiver-facing words are the founder's own Malayalam, verbatim; the
   six short list titles and ₹900+ are the short forms he approved because
   WhatsApp limits a button to 20 characters and a list title to 24 (his full
   sentence stays as the row description).

   The hook runs after the onboarding flow has logged the inbound message, and
   replies go through sendAndLog, so the whole chat shows in the admin inbox.
   Plan: senior/pulso_hub/docs/caregiver_offer_feedback_broadcast_plan.md
*/
const config = require('../config');
const { getFirestore } = require('./storage');
const { getMessageText } = require('./messageParser');

const COLLECTION = 'offerFeedback';
const TEMPLATE_NAME = 'caregiver_offer_feedback';
const TEMPLATE_LANGUAGE = 'ml';
const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXTRA_ALERT_PHONE = '919446600809';

const ID = Object.freeze({
  NOT_SEEN: 'ofb_notseen',
  PAY: 'ofb_pay',
  OTHER: 'ofb_other',
  PAY_700: 'ofb_pay_700',
  PAY_800: 'ofb_pay_800',
  PAY_900: 'ofb_pay_900',
  FAR: 'ofb_l_far',
  EIGHT_HOUR: 'ofb_l_8h',
  WORKING: 'ofb_l_work',
  FAMILY: 'ofb_l_family',
  FREE_NOW: 'ofb_l_free',
  SOMETHING_ELSE: 'ofb_l_other',
  WHEN_WEEK: 'ofb_when_week',
  WHEN_MONTH: 'ofb_when_month',
  WHEN_NOT_NOW: 'ofb_when_no'
});

// The founder's Malayalam, 25 Oct 2026. Do not reword.
const TEXT = Object.freeze({
  templateBody:
    'ഹലോ {{1}},\nഈ ആഴ്ച Pulso ആപ്പിൽ നിങ്ങൾക്ക് ചില ഡ്യൂട്ടി ഓഫറുകൾ അയച്ചിരുന്നു. എന്നാൽ നിങ്ങൾ ഒന്നും സ്വീകരിച്ചിട്ടില്ല. അതിന്റെ കാരണം എന്താണ്?\n\nതാഴെയുള്ള ഒരു ഓപ്ഷൻ തിരഞ്ഞെടുക്കൂ. നിങ്ങൾക്ക് അനുയോജ്യമായ ഡ്യൂട്ടികൾ അയയ്ക്കാൻ ഇത് ഞങ്ങളെ സഹായിക്കും.',
  templateButtons: ['ഓഫറുകൾ കണ്ടില്ല', 'ദിവസക്കൂലി കുറവാണ്', 'മറ്റൊരു കാരണം'],
  notSeen:
    'നന്ദി. Pulso-യിൽ വരുന്ന എല്ലാ ഡ്യൂട്ടി ഓഫറുകളും ഉടൻ അറിയാൻ ആപ്പിന്റെ Notifications ON ആക്കുക.\n\nPhone Settings → Apps → Pulso → Notifications → Allow\n\nഇന്ന് ഒരിക്കൽ Pulso ആപ്പ് തുറക്കുകയും ചെയ്യുക.\n\nസഹായം ആവശ്യമുണ്ടെങ്കിൽ ഇവിടെ Reply ചെയ്യാം.',
  payQuestion: '24 മണിക്കൂർ ഡ്യൂട്ടി സ്വീകരിക്കാൻ നിങ്ങൾ പ്രതീക്ഷിക്കുന്ന ദിവസക്കൂലി എത്രയാണ്?',
  payThanks: 'നന്ദി. നിങ്ങൾ നൽകിയ വിവരം രേഖപ്പെടുത്തി. അതനുസരിച്ചുള്ള ഡ്യൂട്ടികൾ അയയ്ക്കാൻ ശ്രമിക്കും.',
  listBody: 'ഡ്യൂട്ടി സ്വീകരിക്കാത്തതിന്റെ കാരണം തിരഞ്ഞെടുക്കൂ:',
  listButton: 'കാരണം തിരഞ്ഞെടുക്കൂ',
  farQuestion: 'ഏത് സ്ഥലത്തിന് സമീപമാണ് നിങ്ങൾക്ക് ഡ്യൂട്ടി വേണ്ടത്?\nസ്ഥലപ്പേര് ഇവിടെ ടൈപ്പ് ചെയ്യൂ.',
  farThanks: 'നന്ദി. നിങ്ങൾ പറഞ്ഞ സ്ഥലത്തിന് സമീപമുള്ള ഡ്യൂട്ടികൾ അയയ്ക്കാൻ ശ്രമിക്കും.',
  eightHour: 'രേഖപ്പെടുത്തി. നിങ്ങൾക്ക് 8 മണിക്കൂർ ഡ്യൂട്ടികൾ മാത്രം അയയ്ക്കാം.',
  whenQuestion: 'Pulso ഡ്യൂട്ടിക്ക് നിങ്ങൾ എപ്പോൾ Free ആകും?',
  whenThanks: 'നന്ദി. നിങ്ങൾ നൽകിയ വിവരം രേഖപ്പെടുത്തി.',
  family: 'മനസ്സിലായി. ശ്രദ്ധിക്കൂ.\nവീണ്ടും ഡ്യൂട്ടി എടുക്കാൻ തയ്യാറാകുമ്പോൾ FREE എന്ന് Reply ചെയ്യൂ.',
  freeNow: 'നന്ദി! ഇന്ന് തന്നെ ഞങ്ങളുടെ ടീം നിങ്ങളെ വിളിച്ച് ഡ്യൂട്ടി വിവരങ്ങൾ അറിയിക്കും.',
  somethingElseQuestion: 'കാരണം കുറച്ച് വാക്കുകളിൽ ടൈപ്പ് ചെയ്യൂ. വേണമെങ്കിൽ Voice Message അയച്ചാലും മതി.',
  somethingElseThanks: 'പറഞ്ഞതിന് നന്ദി. ഞങ്ങളുടെ ടീം ഇത് പരിശോധിച്ച് ആവശ്യമെങ്കിൽ നിങ്ങളെ ബന്ധപ്പെടും.',
  support: 'നന്ദി. ഞങ്ങളുടെ Support Team ഉടൻ തന്നെ നിങ്ങളെ ബന്ധപ്പെടും.',
  stopped: 'ശരി. ഇനി ഇത്തരം സന്ദേശങ്ങൾ നിങ്ങൾക്ക് ലഭിക്കില്ല.'
});

const PAY_BUTTONS = [
  { id: ID.PAY_700, title: '₹700' },
  { id: ID.PAY_800, title: '₹800' },
  { id: ID.PAY_900, title: '₹900+' }
];
const WHEN_BUTTONS = [
  { id: ID.WHEN_WEEK, title: 'ഈ ആഴ്ച' },
  { id: ID.WHEN_MONTH, title: 'അടുത്ത മാസം' },
  { id: ID.WHEN_NOT_NOW, title: 'ഇപ്പോൾ വേണ്ട' }
];
const LIST_ROWS = [
  { id: ID.FAR, title: 'ദൂരം കൂടുതലാണ്', description: 'വീട്ടിൽ നിന്ന് വളരെ ദൂരെയാണ്' },
  { id: ID.EIGHT_HOUR, title: '8 മണിക്കൂർ മാത്രം', description: '8 മണിക്കൂർ ഡ്യൂട്ടി മാത്രം വേണം' },
  { id: ID.WORKING, title: 'മറ്റൊരു ജോലിയിൽ', description: 'ഇപ്പോൾ മറ്റൊരു ജോലിയിലാണ്' },
  { id: ID.FAMILY, title: 'കുടുംബം / ആരോഗ്യം', description: 'കുടുംബപരമായ / ആരോഗ്യപരമായ കാരണം' },
  { id: ID.FREE_NOW, title: 'ഇപ്പോൾ തയ്യാറാണ്', description: 'ഇപ്പോൾ ഡ്യൂട്ടിക്ക് തയ്യാറാണ്' },
  { id: ID.SOMETHING_ELSE, title: 'മറ്റെന്തെങ്കിലും കാരണം' }
];

const PAY_VALUE = { [ID.PAY_700]: 700, [ID.PAY_800]: 800, [ID.PAY_900]: 900 };
const WHEN_VALUE = { [ID.WHEN_WEEK]: 'this_week', [ID.WHEN_MONTH]: 'next_month', [ID.WHEN_NOT_NOW]: 'not_now' };

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function replyId(message) {
  if (!message) return '';
  if (message.type === 'button' && message.button) return String(message.button.payload || '');
  const i = message.interactive;
  return String((i && ((i.button_reply && i.button_reply.id) || (i.list_reply && i.list_reply.id))) || '');
}

/**
 * Pure: what to do with one message, given her feedback record.
 * Returns null when it is not ours, else { replies: [{kind, body}], patch, alert, hub }.
 */
function decide(record, message, nowMs) {
  const r = record || {};
  const id = replyId(message);
  const text = String(getMessageText(message) || '').trim();
  const recent = r.sentAt && nowMs - Date.parse(r.sentAt) < REPLY_WINDOW_MS;
  const at = new Date(nowMs).toISOString();
  const say = (body) => ({ kind: 'text', body });
  const done = (reply, patch, extra = {}) => ({ replies: [].concat(reply), patch: { ...patch, answeredAt: at, state: patch.state || '' }, ...extra });

  if (id.startsWith('ofb_')) {
    if (r.optedOut) return { replies: [], patch: {} };
    switch (id) {
      case ID.NOT_SEEN: return done(say(TEXT.notSeen), { reason: 'not_seen' }, { hub: { reason: 'not_seen' } });
      case ID.PAY: return done({ kind: 'buttons', body: { body: TEXT.payQuestion, buttons: PAY_BUTTONS } }, { reason: 'pay', state: 'awaiting_pay' }, { hub: { reason: 'pay' } });
      case ID.PAY_700: case ID.PAY_800: case ID.PAY_900:
        return done(say(TEXT.payThanks), { reason: 'pay', expectedPay: PAY_VALUE[id] }, { hub: { reason: 'pay', expectedPay: PAY_VALUE[id] } });
      case ID.OTHER:
        return done({ kind: 'list', body: { body: TEXT.listBody, buttonText: TEXT.listButton, sections: [{ title: TEXT.listButton, rows: LIST_ROWS }] } }, { reason: 'other', state: 'awaiting_list' });
      case ID.FAR: return done(say(TEXT.farQuestion), { reason: 'too_far', state: 'awaiting_place' }, { hub: { reason: 'too_far' } });
      case ID.EIGHT_HOUR: return done(say(TEXT.eightHour), { reason: '8_hour_only' }, { hub: { reason: '8_hour_only' }, dutyHours: '8_hour' });
      case ID.WORKING: return done({ kind: 'buttons', body: { body: TEXT.whenQuestion, buttons: WHEN_BUTTONS } }, { reason: 'working_elsewhere', state: 'awaiting_when' }, { hub: { reason: 'working_elsewhere' } });
      case ID.WHEN_WEEK: case ID.WHEN_MONTH: case ID.WHEN_NOT_NOW:
        return done(say(TEXT.whenThanks), { reason: 'working_elsewhere', freeWhen: WHEN_VALUE[id] }, { hub: { reason: 'working_elsewhere', freeWhen: WHEN_VALUE[id] } });
      case ID.FAMILY: return done(say(TEXT.family), { reason: 'family_health', state: 'awaiting_free' }, { hub: { reason: 'family_health' } });
      case ID.FREE_NOW: return done(say(TEXT.freeNow), { reason: 'free_now' }, { hub: { reason: 'free_now' }, alert: 'free_now' });
      case ID.SOMETHING_ELSE: return done(say(TEXT.somethingElseQuestion), { reason: 'something_else', state: 'awaiting_words' }, { hub: { reason: 'something_else' } });
      default: return null;
    }
  }

  // Typed words or a voice note: only from someone we asked, within the window.
  if (!recent || r.optedOut) return null;
  const isVoice = message && message.type === 'audio';
  if (/^\s*stop\s*$/i.test(text)) return done(say(TEXT.stopped), { optedOut: true, optedOutAt: at });
  if (r.state === 'awaiting_place' && text) {
    return done(say(TEXT.farThanks), { preferredArea: text.slice(0, 120) }, { hub: { reason: 'too_far', preferredArea: text.slice(0, 120) } });
  }
  if (r.state === 'awaiting_words' && (text || isVoice)) {
    const words = text ? text.slice(0, 500) : '(voice message)';
    return done(say(TEXT.somethingElseThanks), { ownWords: words }, { hub: { reason: 'something_else', ownWords: words } });
  }
  if (r.state === 'awaiting_free' && /^\s*free\s*$/i.test(text)) {
    return done(say(TEXT.freeNow), { reason: 'free_now', freeAgainAt: at }, { hub: { reason: 'free_now' }, alert: 'free_now' });
  }
  if (text || isVoice) {
    const words = text ? text.slice(0, 500) : '(voice message)';
    return done(say(TEXT.support), { typed: words, state: r.state || '' }, { hub: { typed: words } });
  }
  return null;
}

async function saveToHub(phone, hubPatch, dutyHours) {
  if (!hubPatch && !dutyHours) return;
  const { getHubFirestore } = require('./hubStorage');
  const db = getHubFirestore();
  const local = phone.slice(-10);
  const candidates = [`+91${local}`, `91${local}`, local];
  let ref = null;
  for (const field of ['phoneE164', 'phone']) {
    for (const value of candidates) {
      const snap = await db.collection('users').where(field, '==', value).limit(1).get();
      if (!snap.empty) { ref = snap.docs[0].ref; break; }
    }
    if (ref) break;
  }
  if (!ref) return;
  const update = { offerFeedback: { ...(hubPatch || {}), source: 'whatsapp_offer_feedback', updatedAt: new Date().toISOString() } };
  if (dutyHours) update.dutyHourPreference = dutyHours;
  await ref.set(update, { merge: true });
}

async function alertTeam(phone, record) {
  const { sendTemplate, sendText } = require('./metaClient');
  const { signCallToken } = require('./opsNotifications');
  const targets = [...new Set([normalizePhone(config.dutyInterestPhone), EXTRA_ALERT_PHONE].filter(Boolean))];
  let p = {};
  try { p = (await getFirestore().collection('providers').doc(phone).get()).data() || {}; } catch (_) {}
  const name = p.fullName || (record && record.name) || '-';
  const district = p.district || (record && record.district) || '-';
  for (const to of targets) {
    try {
      await sendTemplate(to, config.dutyInterestTemplateName, 'en', [
        { type: 'body', parameters: [name, phone, district, 'Offer feedback: free for a duty now'].map((t) => ({ type: 'text', text: String(t || '-') })) },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: signCallToken(phone) }] }
      ]);
    } catch (error) {
      console.error('[OFFER_FEEDBACK_ALERT_TEMPLATE]', to, error.message);
      try { await sendText(to, `Caregiver free now (offer feedback): ${name} · +${phone} · ${district}. Please call today.`); } catch (_) {}
    }
  }
}

/* Called from processIncomingMessage after the inbound is logged.
   Returns true when the message was a feedback answer (the onboarding flow
   should then stay quiet). */
async function handleOfferFeedbackReply(phone, message, { sendAndLog, nowMs = Date.now() } = {}) {
  const caller = normalizePhone(phone);
  const ref = getFirestore().collection(COLLECTION).doc(caller);
  const snap = await ref.get();
  let record = snap.exists ? snap.data() : null;
  if (!record && !replyId(message).startsWith('ofb_')) return false;
  // Her first tap starts the record; typed words count only after that.
  const firstTap = !record;
  if (firstTap) record = { sentAt: new Date(nowMs).toISOString() };
  const plan = decide(record, message, nowMs);
  if (!plan) return false;
  for (const reply of plan.replies) await sendAndLog(caller, reply.kind, reply.body, 'offer_feedback');
  const history = { at: new Date(nowMs).toISOString(), id: replyId(message), text: String(getMessageText(message) || '').slice(0, 200) };
  const { FieldValue } = require('firebase-admin/firestore');
  await ref.set({ ...(firstTap ? { sentAt: record.sentAt } : {}), ...plan.patch, answers: FieldValue.arrayUnion(history) }, { merge: true });
  try { await saveToHub(caller, plan.hub, plan.dutyHours); } catch (error) { console.error('[OFFER_FEEDBACK_HUB]', error.message); }
  if (plan.alert) await alertTeam(caller, record);
  return true;
}

/* True when this message belongs to the feedback flow: a tap on one of its
   buttons, or anything from someone who already answered it. Used to let the
   31 of 302 caregivers on the old pre-onboarded list through that filter. */
async function isOfferFeedbackMessage(phone, message) {
  if (replyId(message).startsWith('ofb_')) return true;
  try {
    const snap = await getFirestore().collection(COLLECTION).doc(normalizePhone(phone)).get();
    return snap.exists && !snap.data().optedOut;
  } catch (_) {
    return false;
  }
}

/* For the admin inbox: who was asked (src/data/offerFeedbackSent.json, written
   from the sender's log because the sending Mac cannot write this database)
   and what each one answered. Keyed by phone (91XXXXXXXXXX). */
async function inboxInfo() {
  let sent = {};
  try { sent = require('../data/offerFeedbackSent.json'); } catch (_) {}
  const info = {};
  for (const [phone, s] of Object.entries(sent)) info[phone] = { sentAt: s.sentAt, sentName: s.name, district: s.district };
  try {
    const snap = await getFirestore().collection(COLLECTION).get();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      info[doc.id] = {
        ...(info[doc.id] || {}),
        replied: Array.isArray(d.answers) && d.answers.length > 0,
        reason: d.reason || '',
        expectedPay: d.expectedPay || null,
        preferredArea: d.preferredArea || '',
        freeWhen: d.freeWhen || '',
        ownWords: d.ownWords || d.typed || '',
        optedOut: d.optedOut === true,
        answeredAt: d.answeredAt || ''
      };
    });
  } catch (error) {
    console.error('[OFFER_FEEDBACK_INBOX]', error.message);
  }
  return info;
}

/** The template message for one caregiver (sent by src/scripts/sendOfferFeedback.js). */
function templateComponents(name) {
  return [
    { type: 'body', parameters: [{ type: 'text', text: String(name || '').trim() || 'സുഹൃത്തേ' }] },
    ...[ID.NOT_SEEN, ID.PAY, ID.OTHER].map((payload, index) => ({
      type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }]
    }))
  ];
}

module.exports = {
  COLLECTION,
  TEMPLATE_NAME,
  TEMPLATE_LANGUAGE,
  ID,
  TEXT,
  LIST_ROWS,
  PAY_BUTTONS,
  WHEN_BUTTONS,
  decide,
  replyId,
  templateComponents,
  handleOfferFeedbackReply,
  isOfferFeedbackMessage,
  inboxInfo,
  normalizePhone
};
