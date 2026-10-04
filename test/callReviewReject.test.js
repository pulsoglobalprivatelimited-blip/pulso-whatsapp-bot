'use strict';
// Reject after a call (4 Oct 2026): for No certificate / student / above 50,
// Reject is three reasons and one confirm, she is closed for good, and she is
// sent a closing message, never "upload your certificate again".
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
    phone, fullName: 'Test NoCert', age: 30, district: 'Kannur', dutyHourPreference: 'both', flowId: 'kerala_malayalam',
    qualification: 'no_certificate', status: STATUS.VERIFICATION_PENDING, verification: { status: 'pending' }, history: [], ...extra
  };
}
const tap = (id) => ({ type: 'interactive', interactive: { button_reply: { id } } });
const toWho = (who) => sent.filter((m) => m.to === who);

test('Reject on a No certificate alert offers three reasons', async () => {
  sent.length = 0;
  records.set('919000000701', pending('919000000701'));
  await flow.processIncomingMessage(SECOND, tap('review_reject_919000000701'));
  const msg = toWho(SECOND).find((m) => m.kind === 'buttons');
  assert.deepEqual(msg.buttons.map((b) => b.title), ['Not suitable', 'Could not reach', 'Not interested']);
  assert.equal(records.get('919000000701').verification.reviewerWorkflow.stage, 'choose_call_reject_reason');
});

test('a reason asks one confirm and shows the message she will get', async () => {
  sent.length = 0;
  await flow.processIncomingMessage(SECOND, tap('review_callrej_unsuitable_919000000701'));
  const msg = toWho(SECOND).find((m) => m.kind === 'buttons');
  assert.match(msg.body, /Reason: Not suitable/);
  assert.match(msg.body, /മുന്നോട്ട് കൊണ്ടുപോകാൻ കഴിയില്ല/);
  assert.deepEqual(msg.buttons.map((b) => b.title), ['Confirm reject', 'Cancel']);
});

test('Confirm reject closes her for good, sends the closing message, never asks for a certificate', async () => {
  sent.length = 0;
  await flow.processIncomingMessage(SECOND, tap('review_callrej_confirm_919000000701'));
  const r = records.get('919000000701');
  assert.equal(r.verification.status, 'rejected');
  assert.equal(r.status, STATUS.CERTIFICATE_REJECTED_PERMANENT);
  assert.match(r.verification.notes, /Not suitable/);
  const toHer = sent.filter((m) => m.to === '919000000701').map((m) => m.body).join(' ');
  assert.match(toHer, /താൽപര്യത്തിന് നന്ദി/);
  assert.doesNotMatch(toHer, /upload/i);
  assert.match(toWho(SECOND).map((m) => m.body).join(' '), /Rejected Test NoCert \(Not suitable\)/);
});

test('a second reviewer tapping after the first decided is told who decided', async () => {
  sent.length = 0;
  await flow.processIncomingMessage(OWNER, tap('review_callrej_confirm_919000000701'));
  assert.match(toWho(OWNER)[0].body, /Already rejected by Mohamed Afiq/);
});

test('the desk path (no options) on a call-review person also sends the closing message', async () => {
  sent.length = 0;
  records.set('919000000702', pending('919000000702', { qualification: 'gda', age: 58 }));
  await flow.rejectCertificate('919000000702', 'admin', 'from desk');
  const r = records.get('919000000702');
  assert.equal(r.status, STATUS.CERTIFICATE_REJECTED_PERMANENT);
  assert.doesNotMatch(sent.filter((m) => m.to === '919000000702').map((m) => m.body).join(' '), /upload/i);
});

test('a certificate applicant still gets the certificate reject (unchanged)', async () => {
  sent.length = 0;
  records.set('919000000703', pending('919000000703', { qualification: 'gda', age: 30 }));
  await flow.processIncomingMessage(OWNER, tap('review_reject_919000000703'));
  assert.equal(records.get('919000000703').verification.reviewerWorkflow.stage, 'choose_reject_reason');
});
