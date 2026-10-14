'use strict';
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

// --- the four steps after the sex --------------------------------------------------

test('after the sex she taps a height range, types a weight, agrees once and sends a full-length photo', async () => {
  const phone = seed(STATUS.AWAITING_SEX);
  await say(phone, tap(BUTTON_IDS.SEX_FEMALE));
  let p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_HEIGHT);
  const list = lastToHer(phone);
  assert.equal(list.kind, 'list');
  assert.equal(list.sections[0].rows.length, 7, 'six ranges and Skip');
  assert.deepEqual(list.sections[0].rows.slice(0, 6).map((r) => r.id), ['h_lt_5_0', 'h_5_0_5_2', 'h_5_3_5_5', 'h_5_6_5_8', 'h_5_9_5_11', 'h_6_0_plus']);

  await say(phone, text('170'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_HEIGHT, 'a typed height is not read');
  await say(phone, row(BUTTON_IDS.HEIGHT_5_3_5_5));
  p = records.get(phone);
  assert.equal(p.heightRange, 'h_5_3_5_5');
  assert.equal(p.status, STATUS.AWAITING_WEIGHT);
  assert.equal(lastToHer(phone).kind, 'text', 'weight is required: no Skip button');

  await say(phone, text('abc'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_WEIGHT);
  await say(phone, text('58 kg'));
  p = records.get(phone);
  assert.equal(p.weightKg, 58);
  assert.equal(p.status, STATUS.AWAITING_PROFILE_CONSENT);
  const consent = lastToHer(phone);
  assert.equal(consent.kind, 'buttons');
  assert.equal(consent.body, FLOWS.kerala_malayalam.MESSAGES.profileConsentText);
  assert.deepEqual(consent.buttons.map((b) => b.id), [BUTTON_IDS.PROFILE_CONSENT_AGREE]);

  await say(phone, text('hmm'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_PROFILE_CONSENT, 'consent is not skipped');
  assert.equal(records.get(phone).profileConsent, null);
  await say(phone, tap(BUTTON_IDS.PROFILE_CONSENT_AGREE));
  p = records.get(phone);
  assert.equal(p.profileConsent.version, 'profile_sharing_v1');
  assert.equal(p.profileConsent.source, 'whatsapp');
  assert.ok(p.profileConsent.acceptedAt);
  assert.equal(p.status, STATUS.AWAITING_PROFILE_PHOTO);
  assert.deepEqual(lastToHer(phone).buttons.map((b) => b.id), [BUTTON_IDS.PROFILE_PHOTO_LATER]);

  await say(phone, doc('pdf1'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_PROFILE_PHOTO, 'a document is not a photo');
  assert.equal(lastToHer(phone).body, FLOWS.kerala_malayalam.MESSAGES.profilePhotoRequest);
  await say(phone, image('img1'));
  p = records.get(phone);
  assert.equal(p.profilePhoto.status, 'pending');
  assert.equal(p.profilePhoto.mediaId, 'img1');
  assert.equal(p.profilePhoto.cloudStorageUrl, `https://archive/${phone}/profile_photo.jpg`);
  assert.equal(p.status, STATUS.AWAITING_DISTRICT);
  assert.equal(lastToHer(phone).kind, 'list');
  assert.ok(events(phone).includes('profile_consent_given'));
  assert.ok(events(phone).includes('profile_photo_received'));
});

test('Skip on height, weight required, Send later on the photo: the chat goes on', async () => {
  const phone = seed(STATUS.AWAITING_HEIGHT, { sex: 'Female' });
  await say(phone, row(BUTTON_IDS.HEIGHT_SKIP));
  assert.equal(records.get(phone).heightRange, null);
  assert.equal(records.get(phone).status, STATUS.AWAITING_WEIGHT);
  // Weight is required (14 Oct 2026): an old Skip tap or "skip" typed is asked again.
  await say(phone, tap(BUTTON_IDS.WEIGHT_SKIP));
  assert.equal(records.get(phone).status, STATUS.AWAITING_WEIGHT);
  await say(phone, text('skip'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_WEIGHT);
  await say(phone, text('62'));
  assert.equal(records.get(phone).weightKg, 62);
  assert.equal(records.get(phone).status, STATUS.AWAITING_PROFILE_CONSENT);
  await say(phone, tap(BUTTON_IDS.PROFILE_CONSENT_AGREE));
  await say(phone, tap(BUTTON_IDS.PROFILE_PHOTO_LATER));
  assert.equal(records.get(phone).profilePhoto, null);
  assert.equal(records.get(phone).status, STATUS.AWAITING_DISTRICT);
  assert.ok(events(phone).includes('profile_photo_deferred'));
});

test('the details check shows height and weight, and Change can re-ask both', async () => {
  const phone = seed(STATUS.AWAITING_DISTRICT, { sex: 'Female', heightRange: 'h_5_3_5_5', weightKg: 58, districtListPage: 1 });
  await say(phone, row('district_ernakulam', 'എറണാകുളം'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_LOGIN_PHONE, 'the app login number comes next');
  await say(phone, tap(BUTTON_IDS.LOGIN_PHONE_SAME));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.match(lastToHer(phone).body, /ഉയരം: 5 ft 3 in – 5 ft 5 in\n/);
  assert.match(lastToHer(phone).body, /ഭാരം: 58 kg\n/);
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  const rows = lastToHer(phone).sections[0].rows;
  assert.ok(rows.some((r) => r.id === BUTTON_IDS.DETAILS_EDIT_HEIGHT));
  assert.ok(rows.some((r) => r.id === BUTTON_IDS.DETAILS_EDIT_WEIGHT));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_WEIGHT));
  assert.equal(records.get(phone).detailsEditing, 'weight');
  await say(phone, text('62'));
  const p = records.get(phone);
  assert.equal(p.weightKg, 62);
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.equal(p.detailsEditing, null);
  assert.match(lastToHer(phone).body, /ഭാരം: 62 kg\n/);
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_HEIGHT));
  assert.equal(lastToHer(phone).kind, 'list');
  await say(phone, row(BUTTON_IDS.HEIGHT_5_6_5_8));
  assert.equal(records.get(phone).heightRange, 'h_5_6_5_8');
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
});

// --- the reviewer ------------------------------------------------------------------------

test('Correct sends the photo to the reviewer with the certificate; Accept photo tells her', async () => {
  const phone = seed(STATUS.AWAITING_DETAILS_CONFIRMATION, {
    sex: 'Female', district: 'Ernakulam', detailsCheckShownAt: new Date().toISOString(),
    profileConsent: { version: 'profile_sharing_v1', acceptedAt: '2026-10-11T00:00:00Z', source: 'whatsapp' },
    profilePhoto: { status: 'pending', source: 'whatsapp', mediaId: 'img9', cloudStorageUrl: 'https://archive/x/profile_photo.jpg', submittedAt: '2026-10-11T00:00:00Z' },
    documents: { certificateAttachments: [{ id: 'c1', type: 'image', cloudStorageUrl: 'https://archive/x/certificate.jpg' }] }
  });
  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  assert.equal(records.get(phone).status, STATUS.VERIFICATION_PENDING);
  const photoAlert = sent.find((m) => m.kind === 'template' && m.name === 'caregiver_photo_review');
  assert.ok(photoAlert, 'the photo review template went out');
  assert.equal(photoAlert.to, OWNER);
  assert.equal(photoAlert.components[0].parameters[0].image.link, 'https://archive/x/profile_photo.jpg');
  assert.deepEqual(photoAlert.components[1].parameters.map((x) => x.text), ['Sindhu Sajeev', 'GDA', 'Ernakulam']);
  assert.equal(photoAlert.components[2].parameters[0].payload, `review_photo_accept_${phone}`);
  assert.equal(photoAlert.components[3].parameters[0].payload, `review_photo_retake_${phone}`);
  assert.ok(events(phone).includes('profile_photo_review_sent'));

  sent.length = 0;
  synced.length = 0;
  await say(OWNER, templateTap(`review_photo_accept_${phone}`));
  const p = records.get(phone);
  assert.equal(p.profilePhoto.status, 'accepted');
  assert.equal(p.profilePhoto.reviewedBy, OWNER);
  assert.equal(lastToHer(phone).body, FLOWS.kerala_malayalam.MESSAGES.profilePhotoAccepted);
  assert.match(sent.find((m) => m.to === OWNER).body, /Photo accepted for Sindhu Sajeev/);
  assert.equal(synced.length, 1, 'the server hears about the acceptance');
  assert.equal(buildProviderSyncPayload(synced[0]).profilePhoto.status, 'accepted');
});

test('New photo + note: the reviewer types a note, she gets it, and her next photo is reviewed again', async () => {
  const phone = seed(STATUS.COMPLETED, {
    sex: 'Male', district: 'Kozhikode', fullName: 'Adarsh P', termsAccepted: true, completedAt: '2026-05-01T00:00:00Z',
    profileConsent: { version: 'profile_sharing_v1', acceptedAt: '2026-10-11T00:00:00Z', source: 'app' },
    profilePhoto: { status: 'pending', source: 'app', cloudStorageUrl: 'https://signed/app.jpg', submittedAt: '2026-10-11T00:00:00Z' }
  });
  sent.length = 0;
  await say(OWNER, templateTap(`review_photo_retake_${phone}`));
  assert.equal(records.get(phone).verification.reviewerWorkflow.stage, 'awaiting_photo_note');
  assert.match(lastToHer(OWNER).body, /Type a short note for Adarsh P/);

  await say(OWNER, text('Stand straight, full body, in daylight'));
  const p = records.get(phone);
  assert.equal(p.profilePhoto.status, 'retake');
  assert.equal(p.profilePhoto.note, 'Stand straight, full body, in daylight');
  assert.equal(p.verification.reviewerWorkflow, null);
  assert.match(lastToHer(phone).body, /Reviewer note: Stand straight, full body, in daylight$/);
  assert.match(lastToHer(OWNER).body, /Asked Adarsh P for a new photo/);

  sent.length = 0;
  await say(phone, image('img-new'));
  const again = records.get(phone);
  assert.equal(again.profilePhoto.status, 'pending');
  assert.equal(again.profilePhoto.mediaId, 'img-new');
  assert.equal(again.status, STATUS.COMPLETED, 'a completed caregiver stays completed');
  assert.ok(sent.find((m) => m.kind === 'template' && m.name === 'caregiver_photo_review'), 'reviewed again at once');
  assert.ok(events(phone).includes('profile_photo_resent'));
});

test('a photo uploaded in the app reaches the same reviewer', async () => {
  sent.length = 0;
  const result = await bot.handleProfilePhotoFromApp({ phone: '+91 90000 09999', uid: 'u-app', photoUrl: 'https://signed/full.jpg', fullName: 'Anitha K', qualification: 'gda', district: 'Thrissur' });
  assert.equal(result.ok, true);
  const p = records.get('919000009999');
  assert.equal(p.profilePhoto.status, 'pending');
  assert.equal(p.profilePhoto.source, 'app');
  assert.equal(p.appUid, 'u-app');
  const alert = sent.find((m) => m.kind === 'template' && m.name === 'caregiver_photo_review');
  assert.equal(alert.components[0].parameters[0].image.link, 'https://signed/full.jpg');
  await assert.rejects(() => bot.handleProfilePhotoFromApp({ phone: '', photoUrl: 'x' }));
});

// --- the wake-up for the 65 ----------------------------------------------------------

test('the wake-up: one template with two buttons; Not now pauses, Yes walks the missing steps', async () => {
  sent.length = 0;
  const result = await bot.runStillAvailableForInactiveProviders([
    { phone: '919000008801', fullName: 'Adarsh.pt', sex: 'Male', age: 26, district: 'Kozhikode', qualification: '', uid: 'u1', completedAt: '2026-05-02T00:00:00Z', source: 'app_activation' },
    { phone: '919000008802', fullName: 'Rinsha M', sex: 'Female', age: null, district: 'Malappuram', qualification: '', uid: 'u2' }
  ]);
  assert.equal(result.sent, 2);
  const t = sent.find((m) => m.to === '919000008801' && m.kind === 'template');
  assert.equal(t.name, 'caregiver_still_available');
  assert.equal(t.components[0].parameters[0].text, 'Adarsh.pt');
  assert.equal(t.components[1].parameters[0].payload, BUTTON_IDS.STILL_AVAILABLE_YES);
  assert.equal(t.components[2].parameters[0].payload, BUTTON_IDS.STILL_AVAILABLE_NOT_NOW);
  const p1 = records.get('919000008801');
  assert.equal(p1.region, 'kerala');
  assert.equal(p1.flowId, 'kerala_malayalam');
  assert.equal(p1.status, STATUS.COMPLETED);
  // Run again: nobody asked in the last week is asked twice.
  const again = await bot.runStillAvailableForInactiveProviders([{ phone: '919000008801', fullName: 'Adarsh.pt' }]);
  assert.deepEqual({ sent: again.sent, skipped: again.skipped, failed: again.failed }, { sent: 0, skipped: 1, failed: 0 });
  assert.equal(p1.pulsoAppPromptStage, 'awaiting_still_available');
  assert.equal(p1.reactivation.answer, '');
  const dry = await bot.runStillAvailableForInactiveProviders([{ phone: '919000008803' }], { dryRun: true });
  assert.deepEqual(dry, { eligible: 1, dryRun: true, phones: ['919000008803'] });

  // Not now: paused on the server, nothing else.
  synced.length = 0;
  await say('919000008801', templateTap(BUTTON_IDS.STILL_AVAILABLE_NOT_NOW));
  assert.equal(records.get('919000008801').reactivation.answer, 'not_now');
  assert.equal(records.get('919000008801').status, STATUS.COMPLETED);
  assert.equal(buildProviderSyncPayload(synced[0]).reactivation.answer, 'not_now');
  assert.equal(lastToHer('919000008801').body, FLOWS.kerala_malayalam.MESSAGES.stillAvailableNotNow);

  // Yes, no course on file: the course list, then the certificate, then height.
  await say('919000008802', templateTap(BUTTON_IDS.STILL_AVAILABLE_YES));
  let p2 = records.get('919000008802');
  assert.equal(p2.reactivation.answer, 'yes');
  assert.equal(p2.reactivationFlow, true);
  assert.equal(p2.status, STATUS.AWAITING_AGE, 'the old app form never asked her age');
  await say('919000008802', text('23'));
  p2 = records.get('919000008802');
  assert.equal(p2.age, 23);
  assert.equal(p2.status, STATUS.AWAITING_QUALIFICATION);
  assert.equal(lastToHer('919000008802').kind, 'list');
  await say('919000008802', row(BUTTON_IDS.QUALIFICATION_GDA));
  p2 = records.get('919000008802');
  assert.equal(p2.qualification, 'gda');
  assert.equal(p2.status, STATUS.AWAITING_CERTIFICATE, 'no age, no working model, no interest question again');
  await say('919000008802', image('cert1'));
  await say('919000008802', tap(BUTTON_IDS.CERTIFICATE_CONTINUE));
  p2 = records.get('919000008802');
  assert.equal(p2.status, STATUS.AWAITING_HEIGHT, 'the name is known; on to the height');
  await say('919000008802', row(BUTTON_IDS.HEIGHT_5_0_5_2));
  await say('919000008802', text('50'));
  await say('919000008802', tap(BUTTON_IDS.PROFILE_CONSENT_AGREE));
  await say('919000008802', image('full1'));
  p2 = records.get('919000008802');
  assert.equal(p2.status, STATUS.AWAITING_DETAILS_CONFIRMATION, 'the district is known: straight to the check');
  assert.match(lastToHer('919000008802').body, /ജില്ല: Malappuram/);

  // Yes with no certificate to send: height straight after the course.
  records.set('919000008804', { ...records.get('919000008801'), phone: '919000008804', reactivation: { answer: '' }, pulsoAppPromptStage: 'awaiting_still_available', history: [] });
  await say('919000008804', templateTap(BUTTON_IDS.STILL_AVAILABLE_YES));
  await say('919000008804', row(BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE));
  assert.equal(records.get('919000008804').status, STATUS.AWAITING_HEIGHT);
});

// --- what the server hears, and WhatsApp's limits ---------------------------------------

test('the sync payload carries the five new fields', () => {
  const payload = buildProviderSyncPayload({
    phone: '919000000001', heightRange: 'h_5_3_5_5', weightKg: 58,
    profileConsent: { version: 'profile_sharing_v1', acceptedAt: 'x', source: 'whatsapp' },
    profilePhoto: { status: 'pending', cloudStorageUrl: 'https://a' },
    reactivation: { answer: 'yes' }
  });
  assert.equal(payload.heightRange, 'h_5_3_5_5');
  assert.equal(payload.weightKg, 58);
  assert.equal(payload.profileConsent.source, 'whatsapp');
  assert.equal(payload.profilePhoto.status, 'pending');
  assert.equal(payload.reactivation.answer, 'yes');
  assert.equal(buildProviderSyncPayload({ phone: '1' }).heightRange, '');
  assert.equal(buildProviderSyncPayload({ phone: '1' }).weightKg, null);
});

test('every flow fits WhatsApp: height rows ≤24, list button ≤20, consent and photo buttons ≤20', async () => {
  for (const id of Object.keys(FLOWS)) {
    await flow.runWithFlow(id, async () => {
      for (const r of flow.HEIGHT_OPTIONS) assert.ok(utf16(r.title) <= 24, `${id} row: ${r.title}`);
      assert.ok(utf16(flow.UI_TEXT.heightButtonText) <= 20, `${id} list button: ${flow.UI_TEXT.heightButtonText}`);
      assert.ok(utf16(flow.UI_TEXT.heightSectionTitle) <= 24);
      for (const t of [flow.UI_TEXT.skipTitle, flow.UI_TEXT.profileConsentAgreeTitle, flow.UI_TEXT.profilePhotoLaterTitle]) {
        assert.ok(t && utf16(t) <= 20, `${id} button: ${t}`);
      }
      for (const k of ['heightQuestion', 'weightQuestion', 'profileConsentText', 'profilePhotoRequest', 'profilePhotoRetakeRequest', 'stillAvailableNotNow']) {
        assert.ok(flow.MESSAGES[k] && utf16(flow.MESSAGES[k]) <= 1024, `${id} ${k}`);
        assert.doesNotMatch(flow.MESSAGES[k], /\*\*/);
      }
      assert.match(flow.MESSAGES.profileConsentText, /full/i);
    });
  }
});
