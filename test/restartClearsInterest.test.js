'use strict';
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

// +91 80753 53989 (10 Oct 2026): "Yes, interested" on 27 Sep, refused the duties,
// wrote again on 10 Oct. The stale interestConfirmed sent her from age straight
// to sex, so she reached review with no certificate and no name.
const listTap = (id, title = '') => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const typed = (body) => ({ type: 'text', text: { body } });

test('a returning nurse who refused the duties walks the whole chat again, certificate included', async () => {
  const phone = '919000000961';
  records.set(phone, { phone, flowId: 'kerala_english', language: 'en', region: 'kerala',
    qualification: 'bsc_nursing', interestConfirmed: true, dutyHourPreference: '8_hour',
    expectedDutiesAccepted: false, status: STATUS.NOT_INTERESTED_RESTARTABLE, currentStep: 6,
    documents: { certificateReceived: false, certificateAttachments: [] }, history: [] });
  await flow.processIncomingMessage(phone, typed('Hello! Can I get more info on this?'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_QUALIFICATION);
  await flow.processIncomingMessage(phone, listTap('qualification_bsc_nursing', 'BSc Nursing'));
  assert.equal(records.get(phone).interestConfirmed, false);
  await flow.processIncomingMessage(phone, typed('32'));
  const r = records.get(phone);
  assert.equal(r.status, STATUS.AWAITING_INTEREST, 'age leads to the working model, not to sex');
  assert.notEqual(r.status, STATUS.VERIFICATION_PENDING);
});

test('refusing the duties clears the interest mark', async () => {
  const phone = '919000000962';
  records.set(phone, { phone, flowId: 'kerala_english', language: 'en', region: 'kerala',
    qualification: 'gnm', age: 30, interestConfirmed: true, dutyHourPreference: '24_hour',
    status: STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION, history: [] });
  await flow.processIncomingMessage(phone, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'expected_duties_no', title: 'No' } } });
  const r = records.get(phone);
  assert.equal(r.status, STATUS.NOT_INTERESTED_RESTARTABLE);
  assert.equal(r.interestConfirmed, false);
});
