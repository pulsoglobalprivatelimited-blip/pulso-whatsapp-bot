'use strict';
// Above 50 (founder, 3 Oct 2026): no upper age limit. She goes on through the
// chat, is told the Basic rate, and is reviewed by a call by the owner and the
// second reviewer, like "No certificate".
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

function pending(phone, extra = {}) {
  return {
    phone, fullName: 'Test Senior', age: 56, district: 'Kannur', dutyHourPreference: 'both',
    qualification: 'gda', status: STATUS.VERIFICATION_PENDING, verification: { status: 'pending' }, ...extra
  };
}
const tap = (id) => ({ type: 'interactive', interactive: { button_reply: { id } } });
const toWho = (who) => sent.filter((m) => m.to === who);

test('age 56 with a GDA claim is a call review, to both numbers, with the age at the top', async () => {
  sent.length = 0;
  const p = pending('919000000501');
  assert.equal(ops.isAboveCallReviewAge(p), true);
  const result = await ops.notifyCertificateUploaded(p, []);
  assert.deepEqual(result.recipients.sort(), [OWNER, SECOND].sort());
  for (const who of [OWNER, SECOND]) {
    const alert = toWho(who).find((m) => m.kind === 'buttons');
    assert.match(alert.body, /^Age 56 — above 50, so the Basic rate\. Claimed: GDA/);
    assert.deepEqual(alert.buttons.map((b) => b.title), ['Approve (Basic)', 'Reject']);
  }
  assert.ok(!sent.some((m) => m.buttons && m.buttons.some((b) => b.title === 'Call (Basic)')), 'no Call (Basic) offer: already a call review');
});

test('age 50 is not a call review (above 50 only)', () => {
  assert.equal(ops.isAboveCallReviewAge(pending('919000000502', { age: 50 })), false);
  assert.equal(ops.isNoCertificateProvider(pending('919000000502', { age: 50 })), false);
});

test('Mohamed may approve her on the Basic rate, reason age only (she has a certificate)', async () => {
  records.set('919000000503', pending('919000000503'));
  await flow.processIncomingMessage(SECOND, tap('review_approve_basic_919000000503'));
  const wf = records.get('919000000503').verification.reviewerWorkflow;
  assert.equal(wf.qualification, 'basic_caregiver');
  assert.deepEqual(wf.basicTierReasons, ['age_over_threshold']);
});

test('above 50 with no certificate gets both reasons', async () => {
  records.set('919000000504', pending('919000000504', { qualification: 'no_certificate' }));
  await flow.processIncomingMessage(SECOND, tap('review_approve_basic_919000000504'));
  assert.deepEqual(records.get('919000000504').verification.reviewerWorkflow.basicTierReasons.sort(), ['age_over_threshold', 'no_course_certificate']);
});

test('her own template, when switched on, carries name, age, phone, claim, district and the call token', () => {
  const c = ops.buildBasicAgeTemplateComponents(pending('919000000505'));
  assert.deepEqual(c[0].parameters.map((p) => p.text), ['Test Senior', '56', '919000000505', 'GDA', 'Kannur', 'Both']);
  assert.equal(ops.verifyCallToken(c[1].parameters[0].text), '919000000505');
  assert.equal(c[2].parameters[0].payload, 'review_approve_basic_919000000505');
});

test('typing an age above 50 no longer stops the chat', async () => {
  sent.length = 0;
  records.set('919000000506', { phone: '919000000506', status: STATUS.AWAITING_AGE, currentStep: 3, flowId: 'kerala_english', verification: {}, history: [] });
  await flow.processIncomingMessage('919000000506', { id: 'm1', type: 'text', text: { body: '67' } });
  assert.equal(records.get('919000000506').age, 67);
  assert.notEqual(records.get('919000000506').status, 'age_rejected');
  assert.ok(!sent.some((m) => /above 50 years|50 വയസിന് മുകളിലുള്ള applicants/.test(m.body || '')), 'no refusal sent');
});
