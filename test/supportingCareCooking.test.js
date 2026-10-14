'use strict';
// Supporting care (founder, 15 Oct 2026): right after the duty hours, a Basic or
// GDA caregiver is asked whether she will cook the patient's food for ₹500 more
// a day. The nurse tier is never asked. The answer is stored as cookingOptIn,
// shown in the duties she confirms and the sample offer, mirrored to the app,
// and tagged "Cook" in the ops phone book.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.NO_CERTIFICATE_REVIEWER_PHONE = '+91 62383 78859';
process.env.NO_CERTIFICATE_REVIEWER_NAME = 'Mohamed Afiq';
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';
process.env.GOOGLE_CONTACTS_CLIENT_ID = '';
process.env.GOOGLE_CONTACTS_CLIENT_SECRET = '';
process.env.GOOGLE_CONTACTS_REFRESH_TOKEN = '';

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
  sendList: async (to, body) => { sent.push({ to, kind: 'list', body }); return { messages: [{ id: 'w' }] }; },
  sendTemplate: async (to, name) => { sent.push({ to, kind: 'template', name }); return { messages: [{ id: 'w' }] }; },
  isAppMediaId: () => false
});
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => records.get(phone) || null,
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone), patch)); return records.get(phone); },
  appendHistory: async () => null,
  listReviewerWorkflowProviders: async () => [],
  listPendingVerificationNotificationProviders: async () => []
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 50 }) });

const flow = require('../src/services/onboardingFlow');
const { STATUS, BUTTON_IDS, STEPS } = require('../src/flow');
const { buildProviderSyncPayload } = require('../src/services/pulsoHubSyncService');
const { outboundToAppMessage } = require('../src/services/appChannel');
const contacts = require('../src/services/googleContactsService');

const tap = (id, title = '') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const typed = (body) => ({ type: 'text', text: { body } });

const ML_QUESTION = [
  '🍲 *പാചകം കൂടിയുള്ള ഡ്യൂട്ടി — ദിവസം ₹500 അധികം*',
  '',
  'രോഗിക്ക് ഭക്ഷണം പാചകം ചെയ്യാൻ താല്പര്യമുണ്ടോ?',
  '(രോഗിക്ക് മാത്രം. വീട്ടുകാർക്ക് പാചകം ചെയ്യേണ്ട.)',
  '',
  '24 മണിക്കൂർ: ₹700 + ₹500 = *₹1,200/ദിവസം*',
  '8 മണിക്കൂർ: ₹600 + ₹500 = *₹1,100/ദിവസം*'
].join('\n');
const ML_YES = 'ശരി 👍 പാചകം കൂടിയുള്ള ഡ്യൂട്ടികളും (Supporting care) ഇനി താങ്കൾക്ക് കിട്ടും. Profile-ൽ എപ്പോൾ വേണമെങ്കിലും മാറ്റാം.';
const COOKING_DUTY_LINE = "- Cooking (patient's food only)";

let seq = 0;
function atDutyHours(qualification, extra = {}) {
  seq += 1;
  const phone = `91900000${String(7000 + seq)}`;
  records.set(phone, {
    phone, flowId: 'kerala_malayalam', language: 'ml', region: 'kerala', qualification, age: 35,
    interestConfirmed: true, status: STATUS.AWAITING_DUTY_HOUR_PREFERENCE, currentStep: 5, history: [], ...extra
  });
  return phone;
}
function atCooking(qualification, extra = {}) {
  const phone = atDutyHours(qualification, extra);
  records.set(phone, deepMerge(records.get(phone), {
    status: STATUS.AWAITING_COOKING_PREFERENCE, currentStep: 5.5, dutyHourPreference: '24_hour',
    sampleDutyState: { stage: 'initial_prompt', initialChoice: '24_hour', alternateChoice: '8_hour' }
  }));
  return phone;
}
const to = (phone) => sent.filter((m) => m.to === phone);
const cookingQuestions = (phone) => to(phone).filter((m) => m.kind === 'buttons' && m.buttons.some((b) => b.id === BUTTON_IDS.COOKING_YES));

for (const qualification of ['gda', 'hca', 'anm', 'other_caregiving', 'basic_caregiver', 'no_certificate']) {
  test(`${qualification}: asked about cooking right after the duty hours`, async () => {
    const phone = atDutyHours(qualification);
    await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_24, '24 hour'));
    const r = records.get(phone);
    assert.equal(r.status, STATUS.AWAITING_COOKING_PREFERENCE);
    assert.equal(r.currentStep, 5.5);
    assert.equal(r.dutyHourPreference, '24_hour');
    assert.equal(r.cookingOptIn, undefined, 'nothing stored until she answers');
    const [question] = cookingQuestions(phone);
    assert.ok(question, 'cooking question sent');
    assert.deepEqual(question.buttons.map((b) => b.id), [BUTTON_IDS.COOKING_YES, BUTTON_IDS.COOKING_NO]);
    assert.deepEqual(question.buttons.map((b) => b.title), ['✅ അതെ, പാചകം ചെയ്യാം', '❌ വേണ്ട']);
    for (const b of question.buttons) assert.ok(b.title.length <= 20, `button title over 20: ${b.title}`);
    // The sample prompt waits for her answer.
    assert.ok(!to(phone).some((m) => m.kind === 'buttons' && m.buttons.some((b) => b.id === BUTTON_IDS.SAMPLE_DUTY_YES)));
  });
}

test('GDA reads the founder\'s figures: ₹700 + ₹500 = ₹1,200 and ₹600 + ₹500 = ₹1,100', async () => {
  const phone = atDutyHours('gda');
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_BOTH, 'രണ്ടും'));
  assert.equal(cookingQuestions(phone)[0].body, ML_QUESTION);
});

test('Basic reads her own tier payout plus ₹500, never the GDA figure', async () => {
  const phone = atDutyHours('no_certificate');
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_24, '24 hour'));
  const body = cookingQuestions(phone)[0].body;
  assert.match(body, /₹600 \+ ₹500 = \*₹1,100\/ദിവസം\*/);
  assert.match(body, /₹500 \+ ₹500 = \*₹1,000\/ദിവസം\*/);
});

for (const qualification of ['gnm', 'bsc_nursing']) {
  test(`${qualification}: the nurse tier is never asked and goes straight to the sample`, async () => {
    const phone = atDutyHours(qualification);
    await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_24, '24 hour'));
    const r = records.get(phone);
    assert.equal(r.status, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE);
    assert.equal(r.currentStep, 6);
    assert.equal(r.cookingOptIn, undefined);
    assert.equal(cookingQuestions(phone).length, 0);
  });
}

test('a nurse on the Basic rate because of her age is still not asked', async () => {
  const phone = atDutyHours('gnm', { age: 55 });
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_8, '8 hour'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE);
  assert.equal(cookingQuestions(phone).length, 0);
});

test('yes: cookingOptIn true with a timestamp, the confirmation, then the sample prompt', async () => {
  const phone = atCooking('gda');
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.COOKING_YES, '✅ അതെ, പാചകം ചെയ്യാം'));
  const r = records.get(phone);
  assert.equal(r.cookingOptIn, true);
  assert.ok(!Number.isNaN(Date.parse(r.cookingOptInAt)));
  assert.equal(r.status, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE);
  assert.equal(r.currentStep, 6);
  assert.equal(r.dutyHourPreference, '24_hour');
  const out = to(phone);
  assert.equal(out[0].body, ML_YES);
  assert.ok(out[1].buttons.some((b) => b.id === BUTTON_IDS.SAMPLE_DUTY_YES));
});

test('no: cookingOptIn false, and the walk goes on', async () => {
  const phone = atCooking('no_certificate');
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.COOKING_NO, '❌ വേണ്ട'));
  const r = records.get(phone);
  assert.equal(r.cookingOptIn, false);
  assert.ok(r.cookingOptInAt);
  assert.equal(r.status, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE);
  assert.match(to(phone)[0].body, /പാചകം ഇല്ലാത്ത ഡ്യൂട്ടികൾ/);
});

test('free text is asked again; nothing is stored', async () => {
  const phone = atCooking('hca');
  await flow.processIncomingMessage(phone, typed('enikku ariyilla'));
  const r = records.get(phone);
  assert.equal(r.status, STATUS.AWAITING_COOKING_PREFERENCE);
  assert.equal(r.cookingOptIn, undefined);
  const out = to(phone);
  assert.match(out[0].body, /ദയവായി താഴെയുള്ള buttons/);
  assert.equal(cookingQuestions(phone).length, 1, 'the question is sent again');
  // A tap from an older message is not an answer either.
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_24, '24 hour'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_COOKING_PREFERENCE);
});

test('a typed "വേണ്ട" or "yes" is read as the answer', async () => {
  const a = atCooking('gda');
  await flow.processIncomingMessage(a, typed('വേണ്ട'));
  assert.equal(records.get(a).cookingOptIn, false);
  const b = atCooking('gda', { flowId: 'kerala_english', language: 'en' });
  await flow.processIncomingMessage(b, typed('Yes'));
  assert.equal(records.get(b).cookingOptIn, true);
});

test('typing "താൽപര്യമില്ല" at the cooking question stops the chat like every joining step', async () => {
  const phone = atCooking('gda');
  await flow.processIncomingMessage(phone, typed('താൽപര്യമില്ല'));
  assert.equal(records.get(phone).status, STATUS.NOT_INTERESTED_RESTARTABLE);
});

test('English flow: English question and buttons', async () => {
  const phone = atDutyHours('gda', { flowId: 'kerala_english', language: 'en' });
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_24, '24 hour'));
  const [q] = cookingQuestions(phone);
  assert.match(q.body, /Are you willing to cook food for the patient\?/);
  assert.match(q.body, /For the patient only\. You do not cook for the family\./);
  assert.match(q.body, /24 hours: ₹700 \+ ₹500 = \*₹1,200\/day\*/);
  assert.match(q.body, /8 hours: ₹600 \+ ₹500 = \*₹1,100\/day\*/);
  assert.deepEqual(q.buttons.map((b) => b.title), ['✅ Yes, I can cook', '❌ No']);
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.COOKING_YES, '✅ Yes, I can cook'));
  assert.match(to(phone).at(-2).body, /You will also get duties with cooking \(Supporting care\)/);
});

test('opted in: the sample offer mentions Supporting care and the duties list adds cooking', async () => {
  const phone = atCooking('gda');
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.COOKING_YES));
  sent.length = 0;
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.SAMPLE_DUTY_YES, 'കാണാം'));
  const sample = to(phone).find((m) => m.kind === 'text');
  assert.match(sample.body, /Supporting care \(പാചകം രോഗിക്ക് മാത്രം\) ആണെങ്കിൽ: ദിവസം ₹500 അധികം\./);
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.SAMPLE_DUTY_NO, 'വേണ്ട'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION);
  assert.ok(to(phone).some((m) => m.kind === 'text' && m.body.includes(`- Following diet plan given by doctor / dietician\n${COOKING_DUTY_LINE}`)));
});

test('said no: neither the sample nor the duties mention cooking', async () => {
  const phone = atCooking('gda');
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.COOKING_NO));
  sent.length = 0;
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.SAMPLE_DUTY_YES, 'കാണാം'));
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.SAMPLE_DUTY_NO, 'വേണ്ട'));
  assert.ok(!to(phone).some((m) => typeof m.body === 'string' && /Supporting care|Cooking \(patient/.test(m.body)));
});

test('answering the qualification again clears an old cooking answer', async () => {
  seq += 1;
  const phone = `91900000${String(7000 + seq)}`;
  records.set(phone, { phone, flowId: 'kerala_english', language: 'en', region: 'kerala', status: STATUS.AWAITING_QUALIFICATION,
    cookingOptIn: true, cookingOptInAt: '2026-10-15T10:00:00.000Z', history: [] });
  await flow.processIncomingMessage(phone, { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'qualification_gnm', title: 'GNM' } } });
  assert.equal(records.get(phone).cookingOptIn, null);
});

test('the step map has the cooking step between duty hours and the sample', () => {
  assert.equal(STEPS[5.5], STATUS.AWAITING_COOKING_PREFERENCE);
  assert.equal(STEPS[5], STATUS.AWAITING_DUTY_HOUR_PREFERENCE);
  assert.equal(STEPS[6], STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE);
});

test('the in-app chat draws the cooking question with both buttons', async () => {
  const phone = atDutyHours('gda');
  await flow.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_24, '24 hour'));
  const [q] = cookingQuestions(phone);
  const app = outboundToAppMessage({ kind: 'buttons', body: { body: q.body, buttons: q.buttons } });
  assert.equal(app.kind, 'buttons');
  assert.equal(app.text, ML_QUESTION);
  assert.deepEqual(app.buttons, [
    { id: 'cooking_yes', title: '✅ അതെ, പാചകം ചെയ്യാം' },
    { id: 'cooking_no', title: '❌ വേണ്ട' }
  ]);
});

test('the mirror to the app carries cookingOptIn, and leaves it out when never asked', () => {
  const base = { phone: '919000000001', qualification: 'gda', dutyHourPreference: 'both' };
  assert.equal(buildProviderSyncPayload({ ...base, cookingOptIn: true }).cookingOptIn, true);
  assert.equal(buildProviderSyncPayload({ ...base, cookingOptIn: false }).cookingOptIn, false);
  assert.ok(!('cookingOptIn' in buildProviderSyncPayload(base)));
  assert.ok(!('cookingOptIn' in buildProviderSyncPayload({ ...base, cookingOptIn: null })));
});

test('the ops phone book tags a cooking caregiver "Cook"', () => {
  const p = { fullName: 'Anju M Babu', phone: '919074490963', district: 'Ernakulam', region: 'kerala',
    sex: 'Female', qualification: 'gda', dutyHourPreference: 'both' };
  assert.equal(contacts.buildContactName({ ...p, cookingOptIn: true }), 'P24&8 Cook Anju M Babu GDA Female Ernakulam');
  assert.equal(contacts.buildContactName({ ...p, cookingOptIn: false }), 'P24&8 Anju M Babu GDA Female Ernakulam');
});
