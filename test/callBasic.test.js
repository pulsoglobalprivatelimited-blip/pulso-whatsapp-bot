'use strict';
// Call (Basic) (founder, 3 Oct 2026): under every certificate alert to a full
// reviewer, one button that moves a person whose paper is not valid into
// "Needs a call", sends her nothing, and answers with Call her / Approve
// (Basic) / Reject.
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
    phone, fullName: 'Test GDA', age: 30, district: 'Kannur', dutyHourPreference: 'both',
    qualification: 'hca', status: STATUS.VERIFICATION_PENDING, verification: { status: 'pending' }, ...extra
  };
}
const tap = (id) => ({ type: 'interactive', interactive: { button_reply: { id } } });
const toWho = (who) => sent.filter((m) => m.to === who);

test('a certificate alert to you ends with the Call (Basic) button; Mohamed never gets it', async () => {
  sent.length = 0;
  await ops.notifyCertificateUploaded(pending('919000000401'), []);
  const mine = toWho(OWNER);
  const last = mine[mine.length - 1];
  assert.equal(last.kind, 'buttons');
  assert.match(last.body, /Certificate not valid\? Call and take her on as Basic\./);
  assert.deepEqual(last.buttons, [{ id: 'review_call_basic_919000000401', title: 'Call (Basic)' }]);
  assert.equal(toWho(SECOND).length, 0);
});

test('a No certificate alert does not get the Call (Basic) button', async () => {
  sent.length = 0;
  await ops.notifyCertificateUploaded(pending('919000000402', { qualification: 'no_certificate' }), []);
  assert.ok(!sent.some((m) => m.buttons && m.buttons.some((b) => b.title === 'Call (Basic)')));
});

test('the tap marks her as needing a call, sends her nothing, and answers with Call her / Approve (Basic) / Reject', async () => {
  sent.length = 0;
  records.set('919000000403', pending('919000000403'));
  await flow.processIncomingMessage(OWNER, tap('review_call_basic_919000000403'));
  const v = records.get('919000000403').verification;
  assert.equal(v.needsCall, true);
  assert.equal(v.needsCallReason, 'certificate_not_valid');
  assert.equal(v.needsCallBy, OWNER);
  assert.ok(!sent.some((m) => m.to === '919000000403'), 'nothing to her');
  const reply = toWho(OWNER).find((m) => m.kind === 'buttons');
  assert.match(reply.body, /Needs a call: certificate not valid \(claimed HCA\)/);
  assert.match(reply.body, /Call her: https:\/\/whatsapp\.pulso\.co\.in\/call\/919000000403-/);
  assert.deepEqual(reply.buttons.map((b) => b.title), ['Approve (Basic)', 'Reject']);
});

test('Approve (Basic) after the call goes to Confirm approve on the Basic rate', async () => {
  sent.length = 0;
  await flow.processIncomingMessage(OWNER, tap('review_approve_basic_919000000403'));
  const wf = records.get('919000000403').verification.reviewerWorkflow;
  assert.equal(wf.qualification, 'basic_caregiver');
  assert.equal(wf.stage, 'awaiting_approve_confirmation');
});

test('Mohamed cannot use Call (Basic)', async () => {
  sent.length = 0;
  records.set('919000000404', pending('919000000404'));
  await flow.processIncomingMessage(SECOND, tap('review_call_basic_919000000404'));
  assert.notEqual(records.get('919000000404').verification.needsCall, true);
  assert.match(toWho(SECOND)[0].body, /applications only/);
});

test('Call (Basic) on someone already decided is refused with who decided', async () => {
  sent.length = 0;
  records.set('919000000405', pending('919000000405', {
    status: 'awaiting_terms_acceptance',
    verification: { status: 'verified', reviewedBy: SECOND, reviewedAt: '2026-10-03T10:42:00.000Z' }
  }));
  await flow.processIncomingMessage(OWNER, tap('review_call_basic_919000000405'));
  assert.match(toWho(OWNER)[0].body, /Already approved by Mohamed Afiq/);
  assert.notEqual(records.get('919000000405').verification.needsCall, true);
});

test('markNeedsCall (the desk button) refuses someone not waiting for review', async () => {
  records.set('919000000406', pending('919000000406', { status: 'awaiting_certificate' }));
  await assert.rejects(() => flow.markNeedsCall('919000000406', 'admin'), /not pending/);
});
