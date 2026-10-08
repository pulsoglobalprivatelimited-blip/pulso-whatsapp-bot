'use strict';
// The pay line before the terms (8 Oct 2026): sendCertificateApprovalFollowup
// read an undefined `careTier` from 28 Sep, so every approval threw on that step
// and 40 Basic caregivers accepted the terms without being told their pay.
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
const history = [];
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
  appendHistory: async (phone, entry) => { history.push(entry); return null; },
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()]
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 50, basic: { payout8h: 650, payout24h: 750 }, gda: { payout8h: 800, payout24h: 900 }, nurse: { payout8h: 1200, payout24h: 1400 } }) });

const ops = require('../src/services/opsNotifications');
const flow = require('../src/services/onboardingFlow');
const { STATUS } = require('../src/flow');


function verifyingBasic(phone, extra = {}) {
  return {
    phone, fullName: 'Liya', age: 22, sex: 'Female', district: 'Ernakulam',
    flowId: 'kerala_malayalam', language: 'ml',
    qualification: 'nursing_student', candidateSelectedQualification: 'nursing_student',
    status: STATUS.VERIFICATION_PENDING, verification: { status: 'pending' },
    ...extra
  };
}

test('approving as Basic sends her pay line, and the follow-up no longer fails', async () => {
  const phone = '919000000901';
  records.set(phone, verifyingBasic(phone));
  sent.length = 0;
  history.length = 0;
  await flow.approveCertificate(phone, 'admin', '', 'basic_caregiver', ['no_course_certificate']);
  const failed = history.filter((e) => e.event === 'certificate_approval_followup_send_failed');
  assert.deepEqual(failed, [], JSON.stringify(failed));
  const toHer = sent.filter((m) => m.to === phone && m.kind === 'text').map((m) => m.body);
  assert.ok(toHer.some((b) => /₹/.test(b)), 'a pay line with a rupee figure reached her: ' + JSON.stringify(toHer));
});

test('a GNM approved as a nurse is not sent a Basic pay line', async () => {
  const phone = '919000000902';
  records.set(phone, verifyingBasic(phone, { age: 30, qualification: 'gnm', candidateSelectedQualification: 'gnm' }));
  sent.length = 0;
  history.length = 0;
  await flow.approveCertificate(phone, 'admin', '', 'gnm', []);
  assert.deepEqual(history.filter((e) => e.event === 'certificate_approval_followup_send_failed'), []);
});
