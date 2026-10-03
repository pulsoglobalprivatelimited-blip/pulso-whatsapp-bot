'use strict';
// A second reviewer for "No certificate" applications (founder, 3 Oct 2026).
// Mohamed's number gets those alerts only, with Call her / Approve (Basic) /
// Reject; he may approve as Basic or reject those people and nothing else; and
// whoever taps first decides.
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
    phone,
    fullName: 'Test No Cert',
    age: 30,
    district: 'Kannur',
    dutyHourPreference: 'both',
    qualification: 'no_certificate',
    status: STATUS.VERIFICATION_PENDING,
    verification: { status: 'pending' },
    ...extra
  };
}
const tap = (id) => ({ type: 'interactive', interactive: { button_reply: { id } } });
const toWho = (who) => sent.filter((m) => m.to === who);

test('the second number is recognised, normalised, and never a full reviewer', () => {
  assert.equal(ops.getNoCertificateReviewerPhone(), SECOND);
  assert.equal(ops.isNoCertificateReviewerPhone('+91 62383 78859'), true);
  assert.equal(ops.isReviewerPhone(SECOND), false);
  assert.equal(ops.reviewerDisplayName(SECOND), 'Mohamed Afiq');
});

test('a "No certificate" alert goes to both numbers with the call link and Approve (Basic) / Reject', async () => {
  sent.length = 0;
  const p = pending('919000000201');
  const result = await ops.notifyCertificateUploaded(p, []);
  assert.deepEqual(result.recipients.sort(), [OWNER, SECOND].sort());
  for (const who of [OWNER, SECOND]) {
    const msg = toWho(who).find((m) => m.kind === 'buttons');
    assert.ok(msg, `alert to ${who}`);
    assert.match(msg.body, /No certificate/);
    assert.match(msg.body, /Call her: https:\/\/whatsapp\.pulso\.co\.in\/call\/919000000201-[0-9a-f]{16}/);
    assert.match(msg.body, /Also sent to: /);
    assert.deepEqual(msg.buttons.map((b) => b.title), ['Approve (Basic)', 'Reject']);
  }
  assert.match(toWho(OWNER).find((m) => m.kind === 'buttons').body, /Also sent to: Mohamed Afiq/);
});

test('a certificate alert (GDA) does not go to the second number', async () => {
  sent.length = 0;
  const result = await ops.notifyCertificateUploaded(pending('919000000202', { qualification: 'gda' }), []);
  assert.ok(!result.recipients.includes(SECOND));
  assert.equal(toWho(SECOND).length, 0);
});

test('the template, when switched on, carries the call token and both payloads', () => {
  const c = ops.buildNoCertificateTemplateComponents(pending('919000000201'), 'Mohamed Afiq');
  assert.equal(c[0].parameters.length, 6);
  assert.equal(c[1].sub_type, 'url');
  assert.equal(ops.verifyCallToken(c[1].parameters[0].text), '919000000201');
  assert.equal(c[2].parameters[0].payload, 'review_approve_basic_919000000201');
  assert.equal(c[3].parameters[0].payload, 'review_reject_919000000201');
});

test('the call link dials only numbers the bot signed', () => {
  const token = ops.signCallToken('919000000201');
  assert.equal(ops.verifyCallToken(token), '919000000201');
  assert.equal(ops.verifyCallToken('919000000299-' + token.split('-')[1]), null);
  assert.equal(ops.verifyCallToken('919000000201-0000000000000000'), null);
  assert.equal(ops.verifyCallToken('tel:12345'), null);
});

test('Approve (Basic) goes straight to Confirm approve, on the Basic rate, without the reason question', async () => {
  sent.length = 0;
  records.set('919000000203', pending('919000000203'));
  await flow.processIncomingMessage(SECOND, tap('review_approve_basic_919000000203'));
  const wf = records.get('919000000203').verification.reviewerWorkflow;
  assert.equal(wf.stage, 'awaiting_approve_confirmation');
  assert.equal(wf.qualification, 'basic_caregiver');
  assert.deepEqual(wf.basicTierReasons, ['no_course_certificate']);
  const confirm = toWho(SECOND).find((m) => m.kind === 'buttons');
  assert.match(confirm.body, /Please confirm: approve/);
  assert.match(confirm.body, /Basic caregiver/);
});

test('over the age threshold, the age reason is added too', async () => {
  records.set('919000000204', pending('919000000204', { age: 58 }));
  await flow.processIncomingMessage(SECOND, tap('review_approve_basic_919000000204'));
  assert.deepEqual(records.get('919000000204').verification.reviewerWorkflow.basicTierReasons.sort(), ['age_over_threshold', 'no_course_certificate']);
});

test('the second reviewer cannot touch a certificate application', async () => {
  sent.length = 0;
  records.set('919000000205', pending('919000000205', { qualification: 'gnm' }));
  await flow.processIncomingMessage(SECOND, tap('review_reject_919000000205'));
  assert.equal(records.get('919000000205').verification.reviewerWorkflow, undefined);
  assert.match(toWho(SECOND)[0].body, /not a "No certificate" application/);
});

test('the second reviewer cannot request a document', async () => {
  sent.length = 0;
  records.set('919000000206', pending('919000000206'));
  await flow.processIncomingMessage(SECOND, tap('review_request_additional_document_919000000206'));
  assert.equal(records.get('919000000206').verification.reviewerWorkflow, undefined);
  assert.equal(toWho(SECOND).length, 1);
  assert.match(toWho(SECOND)[0].body, /"No certificate" applications only/);
});

test('REVIEW from the second reviewer brings back a waiting "No certificate" alert, never a certificate one', async () => {
  records.clear();
  sent.length = 0;
  records.set('919000000209', pending('919000000209', { qualification: 'gda' }));
  records.set('919000000210', pending('919000000210'));
  await flow.processIncomingMessage(SECOND, { type: 'text', text: { body: 'REVIEW' } });
  const alert = toWho(SECOND).find((m) => m.kind === 'buttons');
  assert.ok(alert);
  assert.match(alert.body, /919000000210/);
  assert.ok(!sent.some((m) => m.body && /919000000209/.test(m.body)));
  assert.ok(!sent.some((m) => m.to === OWNER), 'the owner is not re-alerted');
  records.clear();
  sent.length = 0;
  await flow.processIncomingMessage(SECOND, { type: 'text', text: { body: 'REVIEW' } });
  assert.match(toWho(SECOND)[0].body, /No "No certificate" application is waiting/);
});

test('the alert also sends the approved notice template, so it reaches a cold reviewer', async () => {
  sent.length = 0;
  await ops.notifyCertificateUploaded(pending('919000000211'), []);
  assert.ok(toWho(SECOND).some((m) => m.kind === 'template'), 'notice template to the second reviewer');
});

test('an old Approve button from the second reviewer means Approve (Basic)', async () => {
  records.set('919000000207', pending('919000000207'));
  await flow.processIncomingMessage(SECOND, tap('review_approve_919000000207'));
  assert.equal(records.get('919000000207').verification.reviewerWorkflow.qualification, 'basic_caregiver');
});

test('whoever taps first decides: a later tap is told who decided and changes nothing', async () => {
  sent.length = 0;
  records.set('919000000208', pending('919000000208', {
    status: STATUS.AWAITING_TERMS_ACCEPTANCE || 'awaiting_terms',
    verification: { status: 'verified', reviewedBy: SECOND, reviewedAt: '2026-10-03T10:42:00.000Z' }
  }));
  await flow.processIncomingMessage(OWNER, tap('review_reject_919000000208'));
  await flow.processIncomingMessage(OWNER, tap('review_confirm_reject_919000000208'));
  const replies = toWho(OWNER).map((m) => m.body);
  assert.equal(replies.length, 2);
  for (const r of replies) assert.match(r, /Already approved by Mohamed Afiq at 3 Oct, 4:12/);
  assert.equal(records.get('919000000208').verification.status, 'verified');
  assert.equal(records.get('919000000208').verification.reviewerWorkflow, undefined);
});
