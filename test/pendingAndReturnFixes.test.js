'use strict';
// Fixes from +91 99478 89890's chat (15 Oct 2026): the waiting reply for
// call-review applicants, said once; the 8-hour note once; an old duty-hour tap
// at the cooking question; a welcome back after a week; desk button labels.
// She checks her name, age, sex, district and qualification before review
// (docs/confirm_details_before_review_plan.md, 8 Oct 2026). The district no
// longer sends her to review: a check message does, on Correct; Change re-asks
// one answer through the same handler and comes back to the check.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
const SECOND = '916238378859';
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.NO_CERTIFICATE_REVIEWER_PHONE = '+91 62383 78859';
process.env.NO_CERTIFICATE_REVIEWER_NAME = 'Mohamed Afiq';
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';

// ---- fakes: no Firestore, no WhatsApp ---------------------------------------
const sent = [];
const records = new Map();
function deepMerge(target, patch) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? deepMerge(out[k], v)
      : v;
  }
  return out;
}
function stub(rel, impl) {
  const file = require.resolve(path.join('../src/services', rel));
  const fallback = async () => null;
  require.cache[file] = {
    id: file, filename: file, loaded: true,
    exports: new Proxy(impl, { get: (t, k) => (k in t ? t[k] : fallback) })
  };
}
const ok = { messages: [{ id: 'w' }] };
stub('metaClient', {
  sendText: async (to, body) => { sent.push({ to, kind: 'text', body }); return ok; },
  sendButtons: async (to, body, buttons) => { sent.push({ to, kind: 'buttons', body, buttons }); return ok; },
  sendList: async (to, body, buttonText, sections) => { sent.push({ to, kind: 'list', body, buttonText, sections }); return ok; },
  sendTemplate: async (to, name, lang, components) => { sent.push({ to, kind: 'template', name, components }); return ok; },
  isAppMediaId: () => false,
  currentChannel: () => null
});
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => records.get(phone) || null,
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone), patch)); return records.get(phone); },
  appendHistory: async (phone, event) => {
    const p = records.get(phone);
    if (!p) return null;
    p.history = [...(p.history || []), { at: new Date().toISOString(), ...event }];
    return p;
  },
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()],
  listProvidersByStatus: async (status) => [...records.values()].filter((p) => p.status === status)
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 45 }) });
stub('reviewAlertEscalation', {
  buildVerificationNotificationPatch: (result) => (result && result.sent ? { notificationSentAt: new Date().toISOString() } : null),
  recordReviewAlertSend: async () => null
});
stub('mediaStorage', {
  archiveIncomingMedia: async (phone, message) => ({
    id: (message.image || message.document).id,
    type: message.type,
    cloudArchiveStatus: 'dry_run'
  })
});

const flow = require('../src/flow');
const { STATUS, BUTTON_IDS, FLOWS } = flow;
const ops = require('../src/services/opsNotifications');
const bot = require('../src/services/onboardingFlow');

const tap = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const row = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const text = (body) => ({ type: 'text', text: { body } });
const image = (id) => ({ type: 'image', image: { id } });
const utf16 = (s) => Buffer.from(String(s), 'utf16le').length / 2;

const toHer = (phone) => sent.filter((m) => m.to === phone);
const lastToHer = (phone) => toHer(phone)[toHer(phone).length - 1];
const reviewAlerts = () => sent.filter((m) => [OWNER, SECOND].includes(m.to) && m.kind === 'buttons' && /approve/i.test(m.body));
const events = (phone) => (records.get(phone).history || []).filter((h) => h.type === 'system').map((h) => h.event);

let seq = 0;

let n = 0;
function seed(status, extra = {}) {
  n += 1;
  const phone = `91900000${String(9100 + n)}`;
  records.set(phone, {
    phone, region: 'kerala', flowId: 'kerala_malayalam', status, currentStep: 5,
    qualification: 'no_certificate', age: 39, sex: 'Female', fullName: 'Shalini C', interestConfirmed: true,
    verification: { status: 'pending' }, history: [], ...extra
  });
  return phone;
}
const say = (phone, message) => bot.processIncomingMessage(phone, message);
const tapB = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id } } });
const typed = (body) => ({ type: 'text', text: { body } });
const M = FLOWS.kerala_malayalam.MESSAGES;

test('waiting for review: a no-certificate applicant hears a call is coming, once; a real question gets it again', async () => {
  const phone = seed(STATUS.VERIFICATION_PENDING);
  await say(phone, typed('Ok'));
  assert.deepEqual(toHer(phone).map((m) => m.body), ['നിങ്ങളുടെ വിവരങ്ങൾ പരിശോധിക്കുന്നു. ഉടൻ ഒരു phone call വരും.']);
  await say(phone, typed('Ok'));
  await say(phone, typed('thanks 🙏'));
  assert.equal(toHer(phone).length, 1, 'plain Ok / thanks gets no second reply');
  await say(phone, typed('When will you call?'));
  assert.equal(toHer(phone).length, 2);
  assert.equal(toHer(phone)[1].body, M.callReviewStillPending);
});

test('waiting for review: a certificate applicant still hears her certificate is being checked', async () => {
  const phone = seed(STATUS.VERIFICATION_PENDING, { qualification: 'gda', age: 30 });
  await say(phone, typed('Ok'));
  assert.equal(toHer(phone)[0].body, M.verificationStillPending);
});

test('Both: the 8-hour note is sent at the choice and again after the samples', async () => {
  const phone = seed(STATUS.AWAITING_DUTY_HOUR_PREFERENCE, { qualification: 'gnm', age: 30 });
  await say(phone, tapB(BUTTON_IDS.DUTY_HOUR_BOTH));
  let notes = toHer(phone).filter((m) => m.body === M.dutyHourPreference8HourNotice).length;
  assert.equal(notes, 1);
  // Walk on through the samples to the duties list.
  for (let i = 0; i < 4 && records.get(phone).status !== STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION; i += 1) {
    const last = toHer(phone).slice(-1)[0];
    const ids = (last.buttons || []).map((b) => b.id);
    const next = ids.find((id) => /sample_duty_no|duty_hour_both/.test(id)) || ids[0];
    if (!next) break;
    await say(phone, tapB(next));
  }
  assert.equal(records.get(phone).status, STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION);
  notes = toHer(phone).filter((m) => m.body === M.dutyHourPreference8HourNotice).length;
  assert.equal(notes, 2, 'repeated with the final choice, as the founder wants');
});

test('cooking question: an old duty-hour tap asks before changing; Yes changes it and asks cooking again', async () => {
  const phone = seed(STATUS.AWAITING_COOKING_PREFERENCE, {
    dutyHourPreference: 'both',
    sampleDutyState: { stage: 'both_prompt', initialChoice: 'both', alternateChoice: null }
  });
  await say(phone, tapB(BUTTON_IDS.DUTY_HOUR_24));
  assert.equal(records.get(phone).dutyHourPreference, 'both', 'nothing changes before she says yes');
  const ask = toHer(phone)[0];
  assert.equal(ask.body, 'Duty hour "24 hour" ആക്കി മാറ്റണോ?');
  assert.deepEqual(ask.buttons.map((b) => b.title), ['അതെ, മാറ്റുക', 'വേണ്ട']);
  await say(phone, tapB(BUTTON_IDS.PREF_CHANGE_YES));
  const p = records.get(phone);
  assert.equal(p.dutyHourPreference, '24_hour');
  assert.equal(p.sampleDutyState.initialChoice, '24_hour');
  assert.equal(p.status, STATUS.AWAITING_COOKING_PREFERENCE);
  assert.equal(toHer(phone)[1].body, 'ശരി 👍 മാറ്റി.');
  assert.deepEqual(toHer(phone)[2].buttons.map((b) => b.id), [BUTTON_IDS.COOKING_YES, BUTTON_IDS.COOKING_NO]);
});

test('back after a week partway through: one welcome line, then the step; not after two days', async () => {
  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const phone = seed(STATUS.AWAITING_NAME, { age: 39, lastInboundAt: old });
  await say(phone, typed('Shalini C'));
  assert.equal(toHer(phone)[0].body, M.welcomeBack);
  assert.equal(records.get(phone).fullName, 'Shalini C');
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const phone2 = seed(STATUS.AWAITING_NAME, { age: 39, lastInboundAt: recent });
  await say(phone2, typed('Anu K'));
  assert.ok(!toHer(phone2).some((m) => m.body === M.welcomeBack));
  assert.equal(bot.isWelcomeBack({ status: STATUS.VERIFICATION_PENDING, lastInboundAt: old }), false, 'not once waiting for review');
});

test('desk: Approve / Reject for call-review records, certificate wording otherwise', () => {
  const fs = require('fs');
  const js = fs.readFileSync(path.join(__dirname, '..', 'src/public/assets/dashboard.js'), 'utf8');
  assert.match(js, /callReview \? 'Approve' : 'Approve certificate'/);
  assert.match(js, /callReview \? 'Reject' : 'Reject certificate'/);
});
