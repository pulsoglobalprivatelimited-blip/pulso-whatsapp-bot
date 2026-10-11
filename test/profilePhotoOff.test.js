'use strict';
// The photo step switched off (founder, 11 Oct 2026): consent, height and
// weight are still asked; after the consent the chat goes straight on. A
// reviewer's "new photo" request still takes the next photo she sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
process.env.WHATSAPP_DRY_RUN = 'true';
delete process.env.PROFILE_PHOTO_STEP_ENABLED;
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';

const sent = [];
const records = new Map();
function deepMerge(target, patch) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v;
  }
  return out;
}
function stub(rel, impl) {
  const file = require.resolve(path.join('../src/services', rel));
  const fallback = async () => null;
  require.cache[file] = { id: file, filename: file, loaded: true, exports: new Proxy(impl, { get: (t, k) => (k in t ? t[k] : fallback) }) };
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
  appendHistory: async (phone, event) => { const p = records.get(phone); if (p) p.history = [...(p.history || []), { at: new Date().toISOString(), ...event }]; return p; },
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()],
  listProvidersByStatus: async (status) => [...records.values()].filter((p) => p.status === status)
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 45 }) });
stub('reviewAlertEscalation', { buildVerificationNotificationPatch: () => null, recordReviewAlertSend: async () => null });
stub('mediaStorage', {
  archiveIncomingMedia: async (phone, message, category) => ({ id: (message.image || message.document).id, type: message.type, fileName: `${category}.jpg`, cloudObjectPath: `bot-media/${phone}/${category}.jpg`, cloudStorageUrl: `https://archive/${phone}/${category}.jpg`, cloudArchived: true, cloudArchiveStatus: 'uploaded' })
});
stub('pulsoHubSyncService', { syncProviderToPulsoHub: async () => ({ ok: true }), buildProviderSyncPayload: () => ({}) });

const config = require('../src/config');
const flow = require('../src/flow');
const { STATUS, BUTTON_IDS } = flow;
const bot = require('../src/services/onboardingFlow');

const tap = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const row = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const text = (body) => ({ type: 'text', text: { body } });
const image = (id) => ({ id: `msg-${id}`, type: 'image', image: { id } });
const say = (phone, message) => bot.processIncomingMessage(phone, message);
const toHer = (phone) => sent.filter((m) => m.to === phone);
const lastToHer = (phone) => toHer(phone)[toHer(phone).length - 1];

let seq = 0;
function seed(status, extra = {}) {
  seq += 1;
  const phone = `91900000${String(8500 + seq)}`;
  records.set(phone, { phone, region: 'kerala', flowId: 'kerala_malayalam', status, currentStep: 11, qualification: 'gda', fullName: 'Sindhu Sajeev', age: 34, sex: 'Female', district: null, heightRange: null, weightKg: null, profileConsent: null, profilePhoto: null, termsAccepted: false, history: [], documents: { certificateAttachments: [] }, verification: { status: 'not_started' }, ...extra });
  return phone;
}

test('the flag is off unless PROFILE_PHOTO_STEP_ENABLED=true', () => {
  assert.equal(config.profilePhotoStepEnabled, false);
});

test('off: consent goes straight to the district; height and weight are still asked', async () => {
  const phone = seed(STATUS.AWAITING_HEIGHT);
  await say(phone, row(BUTTON_IDS.HEIGHT_5_3_5_5));
  assert.equal(records.get(phone).status, STATUS.AWAITING_WEIGHT);
  await say(phone, text('58'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_PROFILE_CONSENT);
  await say(phone, tap(BUTTON_IDS.PROFILE_CONSENT_AGREE));
  const p = records.get(phone);
  assert.ok(p.profileConsent.acceptedAt);
  assert.equal(p.status, STATUS.AWAITING_DISTRICT, 'no photo step');
  assert.equal(p.profilePhoto, null);
  assert.equal(lastToHer(phone).kind, 'list');
  assert.ok(!toHer(phone).some((m) => m.body === flow.FLOWS.kerala_malayalam.MESSAGES.profilePhotoRequest), 'the photo was never asked for');
});

test('off: someone parked at the photo step is moved on by her next message', async () => {
  const phone = seed(STATUS.AWAITING_PROFILE_PHOTO, { heightRange: 'h_5_3_5_5', weightKg: 58, profileConsent: { version: 'profile_sharing_v1', acceptedAt: 'x', source: 'whatsapp' } });
  await say(phone, text('hello'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DISTRICT);
});

test('off: a reviewer\'s new-photo request still takes her next photo', async () => {
  const phone = seed(STATUS.COMPLETED, { district: 'Ernakulam', termsAccepted: true, profilePhoto: { status: 'retake', source: 'app', note: 'daylight please' } });
  sent.length = 0;
  await say(phone, image('again'));
  const p = records.get(phone);
  assert.equal(p.profilePhoto.status, 'pending');
  assert.equal(p.profilePhoto.mediaId, 'again');
  assert.ok(sent.find((m) => m.kind === 'template' && m.name === 'caregiver_photo_review'));
});
