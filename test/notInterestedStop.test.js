'use strict';
// "താൽപര്യമില്ല" stops the chat (founder, 10 Oct 2026). +91 73066 86429 tapped the
// old "താൽപര്യമില്ല" on the duty list at the name question and it became her name.
// Now: that tap, or typing it, at any joining step ends the chat; any other tap
// at the name question asks her to type her name.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
const SECOND = '916238378859';
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.NO_CERTIFICATE_REVIEWER_PHONE = `+91 62383 78859`;
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
stub('metaClient', {
  sendText: async (to, body) => { sent.push({ to, kind: 'text', body }); return { messages: [{ id: 'w' }] }; },
  sendButtons: async (to, body, buttons) => { sent.push({ to, kind: 'buttons', body, buttons }); return { messages: [{ id: 'w' }] }; },
  sendTemplate: async (to, name, lang, components) => { sent.push({ to, kind: 'template', name, components }); return { messages: [{ id: 'w' }] }; },
  isAppMediaId: () => false
});
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => records.get(phone) || null,
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone), patch)); return records.get(phone); },
  appendHistory: async () => null,
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()]
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 50 }) });

const ops = require('../src/services/opsNotifications');
const flow = require('../src/services/onboardingFlow');
const { STATUS } = require('../src/flow');


const tap = (id, title = '') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const typed = (body) => ({ type: 'text', text: { body } });
function joining(phone, status, extra = {}) {
  return { phone, flowId: 'kerala_malayalam', language: 'ml', qualification: 'no_certificate', age: 35,
    dutyHourPreference: '8_hour', expectedDutiesAccepted: true, interestConfirmed: true, status, history: [], ...extra };
}
const NOT_INTERESTED = 'ശരി. പിന്നീട് താൽപര്യമുണ്ടെങ്കിൽ വീണ്ടും message ചെയ്യാം.';

test('the case from 10 Oct: old "താൽപര്യമില്ല" tap at the name question stops the chat, no name saved', async () => {
  const phone = '919000000951';
  records.set(phone, joining(phone, STATUS.AWAITING_NAME));
  sent.length = 0;
  await flow.processIncomingMessage(phone, tap('expected_duties_no', 'താൽപര്യമില്ല'));
  const r = records.get(phone);
  assert.equal(r.status, STATUS.NOT_INTERESTED_RESTARTABLE);
  assert.equal(r.fullName, undefined);
  assert.deepEqual(sent.filter((m) => m.to === phone).map((m) => m.body), [NOT_INTERESTED]);
});

test('typing "താൽപര്യമില്ല" at any joining step stops the chat', async () => {
  for (const status of [STATUS.AWAITING_NAME, STATUS.AWAITING_AGE, STATUS.AWAITING_SEX, STATUS.AWAITING_DISTRICT, STATUS.AWAITING_DUTY_HOUR_PREFERENCE, STATUS.AWAITING_DETAILS_CONFIRMATION]) {
    const phone = '919000000952';
    records.set(phone, joining(phone, status));
    sent.length = 0;
    await flow.processIncomingMessage(phone, typed('താൽപര്യമില്ല'));
    assert.equal(records.get(phone).status, STATUS.NOT_INTERESTED_RESTARTABLE, status);
  }
  const phone = '919000000953';
  records.set(phone, joining(phone, STATUS.AWAITING_AGE, { flowId: 'kerala_english', language: 'en' }));
  await flow.processIncomingMessage(phone, typed('Not interested'));
  assert.equal(records.get(phone).status, STATUS.NOT_INTERESTED_RESTARTABLE);
});

test('any other tap at the name question asks her to type it; a typed name is saved', async () => {
  const phone = '919000000954';
  records.set(phone, joining(phone, STATUS.AWAITING_NAME));
  sent.length = 0;
  await flow.processIncomingMessage(phone, tap('duty_hour_24', '24 hour'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_NAME);
  assert.equal(records.get(phone).fullName, undefined);
  assert.deepEqual(sent.filter((m) => m.to === phone).map((m) => m.body), ['ദയവായി താങ്കളുടെ പൂർണ്ണ പേര് type ചെയ്യുക.']);
  await flow.processIncomingMessage(phone, typed('Sreeja K'));
  assert.equal(records.get(phone).fullName, 'Sreeja K');
  assert.notEqual(records.get(phone).status, STATUS.AWAITING_NAME);
});

test('a name that merely contains the word is still a name, and completed people are untouched', async () => {
  const phone = '919000000955';
  records.set(phone, joining(phone, STATUS.AWAITING_NAME));
  await flow.processIncomingMessage(phone, typed('Anu Nointerest'));
  assert.equal(records.get(phone).fullName, 'Anu Nointerest');
  const done = '919000000956';
  records.set(done, joining(done, STATUS.COMPLETED, { termsAccepted: true }));
  await flow.processIncomingMessage(done, typed('താൽപര്യമില്ല'));
  assert.equal(records.get(done).status, STATUS.COMPLETED);
});
