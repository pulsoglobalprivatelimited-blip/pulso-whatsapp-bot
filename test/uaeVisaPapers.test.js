'use strict';
// UAE visa papers (founder, 28 Oct 2026): a visit visa cannot join; a husband
// visa / freelance permit is told the paper goes in the app, never WhatsApp;
// a company visa is asked nothing more.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.WHATSAPP_DRY_RUN = 'true';
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
  sendList: async (to, body, buttonText, sections) => { sent.push({ to, kind: 'list', body, sections }); return { messages: [{ id: 'w' }] }; },
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

const flow = require('../src/services/onboardingFlow');
const { STATUS, BUTTON_IDS } = require('../src/flow');

const row = (id) => ({ id: 'm' + Math.random(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id } } });
const texts = (to) => sent.filter((m) => m.to === to).map((m) => (typeof m.body === 'string' ? m.body : ''));

function atVisa(phone) {
  records.set(phone, { phone, flowId: 'uae_english', region: 'uae', language: 'english', qualification: 'gda', age: 30, status: STATUS.AWAITING_VISA_TYPE });
}

test('visit visa: polite stop, restartable, the answer cleared so a restart asks again', async () => {
  const phone = '971500000151';
  atVisa(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_visit'));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.NOT_INTERESTED_RESTARTABLE);
  assert.equal(p.uaeVisaType, '');
  assert.ok(p.uaeVisitVisaStoppedAt);
  assert.deepEqual(texts(phone), ['Sorry, Pulso duties need a UAE residence visa. You cannot work on a visit visa.\n\nWhen you have a residence visa, send Hi here and join again.']);
});

test('husband visa: told the NOC is uploaded in the app, then the working model', async () => {
  const phone = '971500000152';
  atVisa(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_family'));
  assert.equal(records.get(phone).uaeVisaType, 'family');
  const t = texts(phone);
  assert.equal(t[0], "Before your first duty, you will upload your husband's NOC letter in the Pulso app.\nDo not send it here.");
  assert.equal(records.get(phone).status, STATUS.AWAITING_INTEREST);
});

test('freelance: told the permit is uploaded in the app', async () => {
  const phone = '971500000153';
  atVisa(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_freelance'));
  assert.match(texts(phone)[0], /upload your freelance permit in the Pulso app/);
});

test('company visa: nothing extra asked or said', async () => {
  const phone = '971500000154';
  atVisa(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_company'));
  assert.equal(records.get(phone).uaeVisaType, 'company');
  assert.ok(!texts(phone).some((b) => /NOC|permit|letter/.test(b)));
  assert.equal(records.get(phone).status, STATUS.AWAITING_INTEREST);
});

// "Other" follow-up (founder, 29 Oct 2026).
async function atOther(phone) {
  atVisa(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_other'));
}

test('Other: asks "Which visa is it?" with five rows, no golden visa', async () => {
  const phone = '971500000155';
  await atOther(phone);
  assert.equal(records.get(phone).status, STATUS.AWAITING_VISA_OTHER);
  const list = sent.filter((m) => m.to === phone && m.kind === 'list').pop();
  assert.equal(list.body, 'Which visa is it?');
  const rows = list.sections[0].rows;
  assert.deepEqual(rows.map((r) => r.id), ['visa_investor', 'visa_student', 'visa_maid', 'visa_cancelled', 'visa_something_else']);
  assert.ok(rows.every((r) => r.title.length <= 24 && !/golden/i.test(r.title)));
});

test('Other → maid visa: stops, restartable, answer cleared', async () => {
  const phone = '971500000156';
  await atOther(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_maid'));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.NOT_INTERESTED_RESTARTABLE);
  assert.equal(p.uaeVisaType, '');
  assert.equal(p.uaeVisaStoppedAs, 'maid');
  assert.match(texts(phone)[0], /maid or domestic worker visa cannot work for an agency/);
});

test('Other → visa cancelled: stops, told to come back with the new visa', async () => {
  const phone = '971500000157';
  await atOther(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_cancelled'));
  assert.equal(records.get(phone).status, STATUS.NOT_INTERESTED_RESTARTABLE);
  assert.match(texts(phone)[0], /When your new visa comes, send Hi here and join again/);
});

test('Other → student: stored, told the student work permit goes in the app', async () => {
  const phone = '971500000158';
  await atOther(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, row('visa_student'));
  assert.equal(records.get(phone).uaeVisaType, 'student');
  assert.equal(texts(phone)[0], 'Before your first duty, you will upload your student work permit in the Pulso app.\nDo not send it here.');
  assert.equal(records.get(phone).status, STATUS.AWAITING_INTEREST);
});

test('Other → investor and something else: carry on with nothing extra', async () => {
  for (const [phone, id, value] of [['971500000159', 'visa_investor', 'investor'], ['971500000160', 'visa_something_else', 'other']]) {
    await atOther(phone);
    sent.length = 0;
    await flow.processIncomingMessage(phone, row(id));
    assert.equal(records.get(phone).uaeVisaType, value);
    assert.equal(records.get(phone).status, STATUS.AWAITING_INTEREST);
    assert.ok(!texts(phone).some((b) => /NOC|permit/.test(b)));
  }
});

test('Other: a typed answer that is not on the list gets the list again', async () => {
  const phone = '971500000161';
  await atOther(phone);
  sent.length = 0;
  await flow.processIncomingMessage(phone, { id: 'm' + Math.random(), type: 'text', text: { body: 'golden' } });
  assert.equal(records.get(phone).status, STATUS.AWAITING_VISA_OTHER);
  assert.equal(texts(phone)[0], 'Please choose your visa from the list below.');
});

test('reviewer alert names the answer and what to check', () => {
  const { formatProviderSummary } = require('../src/services/opsNotifications');
  const lines = (visa) => formatProviderSummary({ region: 'uae', uaeVisaType: visa }).join('\n');
  assert.match(lines('student'), /Visa: Other – Student visa – check her student work permit before approving/);
  assert.match(lines('other'), /Visa: Other – Something else – call her before approving/);
  assert.match(lines('investor'), /Visa: Other – Investor \/ partner visa/);
  assert.match(lines('company'), /Visa: Company visa/);
});
