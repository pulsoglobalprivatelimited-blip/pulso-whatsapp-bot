'use strict';
// Late taps and the photo review (founder, 16 Oct 2026): an older preference
// button asks "change to …?" first; the photo alert goes once per phone; the
// reviewer can send a sample photo (their own or Pulso's) with the note.
// The profile for agencies and families (11 Oct 2026): after the sex she taps
// a height range, types a weight, agrees once, sends a full-length photo;
// the two new answers sit on the details check; the reviewer accepts the
// photo or asks for another with a note; the wake-up for the 65 who never
// took a duty walks the same steps.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.PROFILE_PHOTO_STEP_ENABLED = 'true';
process.env.PROFILE_CONSENT_STEP_ENABLED = 'true';
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';

// ---- fakes: no Firestore, no WhatsApp, no Pulso server ----------------------
const sent = [];
const synced = [];
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
const ok = { messages: [{ id: 'w' }] };
stub('metaClient', {
  sendText: async (to, body) => { sent.push({ to, kind: 'text', body }); return ok; },
  sendButtons: async (to, body, buttons) => { sent.push({ to, kind: 'buttons', body, buttons }); return ok; },
  sendList: async (to, body, buttonText, sections) => { sent.push({ to, kind: 'list', body, buttonText, sections }); return ok; },
  sendTemplate: async (to, name, lang, components) => { sent.push({ to, kind: 'template', name, lang, components }); return ok; },
  sendImageByUrl: async (to, link, caption) => { sent.push({ to, kind: 'image', link, caption }); return ok; },
  isAppMediaId: () => false,
  currentChannel: () => null
});
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => {
    if (!records.get(phone)) records.set(phone, { phone, status: 'new_lead', currentStep: 1, history: [], documents: { certificateAttachments: [] }, verification: { status: 'not_started' }, source: 'meta_ads_whatsapp' });
    return records.get(phone);
  },
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone), patch)); return records.get(phone); },
  appendHistory: async (phone, event) => {
    const p = records.get(phone);
    if (!p) return null;
    p.history = [...(p.history || []), { at: new Date().toISOString(), ...event }];
    return p;
  },
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()],
  listProvidersByStatus: async (status) => [...records.values()].filter((p) => p.status === status)
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 45 }) });
stub('reviewAlertEscalation', {
  buildVerificationNotificationPatch: (result) => (result && result.sent ? { notificationSentAt: new Date().toISOString() } : null),
  recordReviewAlertSend: async () => null
});
stub('mediaStorage', {
  archiveIncomingMedia: async (phone, message, category) => ({
    id: (message.image || message.document).id,
    type: message.type,
    fileName: `${category}.jpg`,
    cloudObjectPath: `bot-media/${phone}/${category}.jpg`,
    cloudStorageUrl: `https://archive/${phone}/${category}.jpg`,
    cloudArchived: true,
    cloudArchiveStatus: 'uploaded'
  })
});
stub('pulsoHubSyncService', {
  syncProviderToPulsoHub: async (provider) => { synced.push(JSON.parse(JSON.stringify(provider))); return { ok: true }; },
  buildProviderSyncPayload: require('../src/services/pulsoHubSyncService').buildProviderSyncPayload
});

const flow = require('../src/flow');
const { STATUS, BUTTON_IDS, FLOWS } = flow;
const bot = require('../src/services/onboardingFlow');
const { buildProviderSyncPayload } = require('../src/services/pulsoHubSyncService');

const tap = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const row = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const templateTap = (payload) => ({ type: 'button', button: { payload, text: 'x' } });
const text = (body) => ({ type: 'text', text: { body } });
const image = (id) => ({ id: `msg-${id}`, type: 'image', image: { id } });
const doc = (id) => ({ type: 'document', document: { id } });
const utf16 = (s) => Buffer.from(String(s), 'utf16le').length / 2;
const say = (phone, message) => bot.processIncomingMessage(phone, message);
const toHer = (phone) => sent.filter((m) => m.to === phone);
const lastToHer = (phone) => toHer(phone)[toHer(phone).length - 1];
const events = (phone) => (records.get(phone).history || []).filter((h) => h.type === 'system').map((h) => h.event);

let seq = 0;
function seed(status, extra = {}) {
  seq += 1;
  const phone = `91900000${String(8000 + seq)}`;
  records.set(phone, {
    phone, region: 'kerala', flowId: 'kerala_malayalam', status, currentStep: 11,
    qualification: 'gda', fullName: 'Sindhu Sajeev', age: 34, sex: null, district: null,
    heightRange: null, weightKg: null, profileConsent: null, profilePhoto: null, reactivation: null,
    termsAccepted: false, history: [], documents: { certificateAttachments: [] },
    verification: { status: 'not_started' }, ...extra
  });
  return phone;
}

const M = FLOWS.kerala_malayalam.MESSAGES;
const syncs = [];
const hubSync = require('../src/services/pulsoHubSyncService');
const realSync = hubSync.syncProviderToPulsoHub;

test('Sandra case: joined, said no cooking, taps the old "yes, cooking": asked first; Yes changes it', async () => {
  const phone = seed(STATUS.COMPLETED, { termsAccepted: true, cookingOptIn: false, fullName: 'Sandra james' });
  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.COOKING_YES));
  assert.equal(records.get(phone).cookingOptIn, false, 'nothing changes yet');
  const ask = lastToHer(phone);
  assert.equal(ask.body, 'പാചകം കൂടിയുള്ള ഡ്യൂട്ടി വേണമെന്ന് മാറ്റണോ?');
  assert.deepEqual(ask.buttons.map((b) => b.id), [BUTTON_IDS.PREF_CHANGE_YES, BUTTON_IDS.PREF_CHANGE_NO]);
  await say(phone, tap(BUTTON_IDS.PREF_CHANGE_YES));
  const p = records.get(phone);
  assert.equal(p.cookingOptIn, true);
  assert.equal(p.pendingPreferenceChange, null);
  assert.equal(lastToHer(phone).body, 'ശരി 👍 മാറ്റി.');
  assert.ok(events(phone).includes('late_tap_change_applied'));
});

test('"വേണ്ട" leaves it as it was', async () => {
  const phone = seed(STATUS.COMPLETED, { termsAccepted: true, cookingOptIn: false });
  await say(phone, tap(BUTTON_IDS.COOKING_YES));
  await say(phone, tap(BUTTON_IDS.PREF_CHANGE_NO));
  assert.equal(records.get(phone).cookingOptIn, false);
  assert.equal(lastToHer(phone).body, 'ശരി, മാറ്റിയില്ല.');
});

test('tapping the value she already has asks nothing', async () => {
  const phone = seed(STATUS.COMPLETED, { termsAccepted: true, cookingOptIn: true });
  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.COOKING_YES));
  assert.ok(!toHer(phone).some((m) => m.body === M.prefChangeCookingYes));
});

test('an old step button mid-joining re-shows her current question and changes nothing', async () => {
  const phone = seed(STATUS.AWAITING_NAME, { age: 30, fullName: null });
  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.EXPECTED_DUTIES_YES));
  assert.equal(records.get(phone).status, STATUS.AWAITING_NAME);
  assert.equal(records.get(phone).fullName, null, 'the button title is not saved as a name');
  assert.equal(lastToHer(phone).body, M.nameQuestion);
});

test('the photo review alert goes once to a number set twice', async () => {
  const ops = require('../src/services/opsNotifications');
  sent.length = 0;
  await ops.notifyProfilePhotoReview({ phone: '919000009901', fullName: 'X', qualification: 'gda', district: 'Kannur', profilePhoto: { cloudStorageUrl: 'https://p.jpg' } });
  assert.equal(sent.filter((m) => m.to === OWNER && m.kind === 'template').length, 1);
});

function withPhoto(extra = {}) {
  return seed(STATUS.COMPLETED, {
    fullName: 'Adarsh P', termsAccepted: true,
    profilePhoto: { status: 'pending', source: 'app', cloudStorageUrl: 'https://signed/app.jpg' },
    lastInboundAt: new Date().toISOString(), ...extra
  });
}

test('New photo → "Use our sample" → note: she gets the standard sample, then the note', async () => {
  const phone = withPhoto();
  sent.length = 0;
  await say(OWNER, templateTap(`review_photo_retake_${phone}`));
  await say(OWNER, tap(`review_photo_sample_${phone}`));
  assert.match(lastToHer(OWNER).body, /It goes with Pulso's sample photo/);
  await say(OWNER, text('Stand against a plain wall'));
  const her = toHer(phone);
  assert.equal(her[0].kind, 'image');
  assert.equal(her[0].link, 'https://whatsapp.pulso.co.in/admin/assets/profile_photo_sample.jpg');
  assert.equal(her[0].caption, M.profilePhotoSampleCaption);
  assert.match(her[1].body, /Reviewer note: Stand against a plain wall$/);
  const p = records.get(phone);
  assert.equal(p.profilePhoto.status, 'retake');
  assert.equal(p.profilePhoto.sampleUrl, 'https://whatsapp.pulso.co.in/admin/assets/profile_photo_sample.jpg');
  assert.match(lastToHer(OWNER).body, /Asked Adarsh P for a new photo with a sample\./);
});

test('New photo → the reviewer sends a photo with a caption: that photo, then the caption as the note', async () => {
  const phone = withPhoto();
  sent.length = 0;
  await say(OWNER, templateTap(`review_photo_retake_${phone}`));
  await say(OWNER, { id: 'm-rev', type: 'image', image: { id: 'rev-img', caption: 'Like this, full body' } });
  const her = toHer(phone);
  assert.equal(her[0].kind, 'image');
  assert.equal(her[0].link, `https://archive/${phone}/photo_sample.jpg`);
  assert.match(her[1].body, /Reviewer note: Like this, full body$/);
  assert.equal(records.get(phone).profilePhoto.sampleUrl, `https://archive/${phone}/photo_sample.jpg`);
});

test('New photo → "Note only": text only, as before', async () => {
  const phone = withPhoto();
  sent.length = 0;
  await say(OWNER, templateTap(`review_photo_retake_${phone}`));
  await say(OWNER, tap(`review_photo_noteonly_${phone}`));
  await say(OWNER, text('Face the camera'));
  const her = toHer(phone);
  assert.equal(her.length, 1);
  assert.match(her[0].body, /Reviewer note: Face the camera$/);
  assert.equal(records.get(phone).profilePhoto.sampleUrl, null);
});

test('outside her 24 hours, with the template on: one template with the sample and the note', async () => {
  const config = require('../src/config');
  config.photoRetakeTemplateEnabled = true;
  try {
    const phone = withPhoto({ lastInboundAt: '2026-01-01T00:00:00Z' });
    sent.length = 0;
    await say(OWNER, templateTap(`review_photo_retake_${phone}`));
    await say(OWNER, tap(`review_photo_sample_${phone}`));
    await say(OWNER, text('Plain wall please'));
    const her = toHer(phone);
    assert.equal(her.length, 1);
    assert.equal(her[0].kind, 'template');
    assert.equal(her[0].name, 'caregiver_photo_retake');
    assert.equal(her[0].components[0].parameters[0].image.link, 'https://whatsapp.pulso.co.in/admin/assets/profile_photo_sample.jpg');
    assert.equal(her[0].components[1].parameters[0].text, 'Plain wall please');
  } finally {
    config.photoRetakeTemplateEnabled = false;
  }
});
