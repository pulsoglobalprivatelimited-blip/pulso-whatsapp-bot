'use strict';
// Dubai caregivers, end to end through processIncomingMessage (26 Oct 2026):
// the ad's "DUBAI CAREGIVER", the typed licence in place of the certificate
// photo, no certificate review, terms, and the app message with the hub sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';
process.env.SUBSCRIPTION_FEE_ENABLED = 'true';
process.env.SUBSCRIPTION_FEE_REGIONS = 'kerala,karnataka,uae';
process.env.SUBSCRIPTION_FEE_START_AT = '2020-01-01T00:00:00Z';

// The real payload builder, taken before the module is stubbed below.
const { buildProviderSyncPayload } = require('../src/services/pulsoHubSyncService');

// ---- fakes: no Firestore, no WhatsApp ---------------------------------------
const sent = [];
const records = new Map();
const archived = [];
const synced = [];
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
  sendTemplate: async (to, name) => { sent.push({ to, kind: 'template', name }); return ok; },
  sendVideoById: async (to) => { sent.push({ to, kind: 'video' }); return ok; },
  isAppMediaId: () => false,
  currentChannel: () => null
});
const blank = (phone) => ({ phone, status: 'new_lead', currentStep: 1, flowId: null, region: null, documents: {}, verification: {}, history: [], createdAt: new Date().toISOString() });
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => {
    if (!records.has(phone)) records.set(phone, blank(phone));
    return records.get(phone);
  },
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone) || blank(phone), patch)); return records.get(phone); },
  appendHistory: async (phone, event) => {
    const p = records.get(phone);
    if (!p) return null;
    p.history = [...(p.history || []), { at: new Date().toISOString(), ...event }];
    return p;
  },
  listProvidersByStatus: async (status) => [...records.values()].filter((p) => p.status === status)
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 50 }) });
stub('mediaStorage', {
  archiveIncomingMedia: async (phone, message, category) => { archived.push({ phone, category }); return null; }
});
stub('pulsoHubSyncService', {
  syncProviderToPulsoHub: async (provider) => { synced.push(buildProviderSyncPayload(provider)); return { ok: true, data: {} }; },
  buildProviderSyncPayload
});
stub('hubAppActivationService', {
  getHubAppActivation: async () => ({ activated: true, found: true, uid: 'uid-1', activatedAt: '2026-10-26T10:00:00Z', matchStatus: 'matched' })
});
stub('googleContactsService', { saveProviderContact: async () => ({ ok: false, skipped: true, reason: 'test' }) });

const flow = require('../src/flow');
const { STATUS, BUTTON_IDS, FLOWS } = flow;
const bot = require('../src/services/onboardingFlow');

const EN = FLOWS.uae_english.MESSAGES;
const button = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const row = (id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'x' } } });
const text = (body) => ({ type: 'text', text: { body } });
const say = (phone, message) => bot.processIncomingMessage(phone, message);
const toHer = (phone) => sent.filter((m) => m.to === phone);
const lastToHer = (phone) => toHer(phone)[toHer(phone).length - 1];
const events = (phone) => (records.get(phone).history || []).filter((h) => h.type === 'system').map((h) => h.event);

let seq = 0;
function dubaiNumber() {
  seq += 1;
  return `9715012${String(30000 + seq)}`;
}

function at(status, extra = {}) {
  const phone = dubaiNumber();
  records.set(phone, {
    ...blank(phone),
    region: 'uae',
    flowId: 'uae_english',
    language: 'en',
    status,
    qualification: 'gda',
    age: 34,
    interestConfirmed: true,
    dutyHourPreference: '24_hour',
    history: [{ at: new Date().toISOString(), type: 'inbound_message', payload: {} }],
    ...extra
  });
  return phone;
}

test('"DUBAI CAREGIVER" picks region uae and asks only the language', async () => {
  const phone = dubaiNumber();
  await say(phone, text('Dubai Caregiver'));
  const p = records.get(phone);
  assert.equal(p.region, 'uae');
  assert.equal(p.flowId, 'uae_english');
  assert.equal(p.status, STATUS.AWAITING_LANGUAGE_SELECTION);
  assert.equal(lastToHer(phone).kind, 'buttons');
  assert.match(lastToHer(phone).body, /Please select your language/);
  assert.equal(toHer(phone).filter((m) => m.kind === 'list').length, 0, 'no region list');

  await say(phone, button(BUTTON_IDS.LANGUAGE_MALAYALAM));
  assert.equal(records.get(phone).flowId, 'uae_malayalam');
  assert.equal(records.get(phone).status, STATUS.AWAITING_QUALIFICATION);
});

test('any other first message still gets the region list, now with UAE (Dubai)', async () => {
  const phone = dubaiNumber();
  await say(phone, text('Hi'));
  const list = lastToHer(phone);
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.sections[0].rows.map((r) => r.title), ['Kerala', 'Karnataka', 'UAE (Dubai)']);
  await say(phone, row(BUTTON_IDS.REGION_UAE));
  assert.equal(records.get(phone).region, 'uae');
  assert.equal(records.get(phone).status, STATUS.AWAITING_LANGUAGE_SELECTION);
});

test('after the care duties, the licence question replaces the certificate photo', async () => {
  const phone = at(STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION);
  await say(phone, button(BUTTON_IDS.EXPECTED_DUTIES_YES));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DHA_LICENCE);
  assert.equal(lastToHer(phone).body, 'Type your DHA licence number.\nCaregiver without a DHA licence? Type your company name and staff ID number instead.\nOnly the number. Do not send ID cards or your passport here.');
  // No certificate too: the licence step is for everyone in Dubai.
  const none = at(STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION, { qualification: 'no_certificate' });
  await say(none, button(BUTTON_IDS.EXPECTED_DUTIES_YES));
  assert.equal(records.get(none).status, STATUS.AWAITING_DHA_LICENCE);
});

test('a photo or document at the licence step is refused, not stored or forwarded', async () => {
  const phone = at(STATUS.AWAITING_DHA_LICENCE);
  archived.length = 0;
  const before = sent.length;
  await say(phone, { type: 'image', image: { id: 'passport-photo' } });
  await say(phone, { type: 'document', document: { id: 'id-card.pdf' } });
  const p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_DHA_LICENCE);
  assert.equal(archived.length, 0, 'nothing archived');
  assert.deepEqual(p.documents, {}, 'nothing on the record');
  assert.equal(p.dhaLicenceNumber, undefined);
  const replies = sent.slice(before);
  assert.ok(replies.every((m) => m.to === phone), 'nothing sent to anyone else');
  assert.equal(replies[0].body, EN.dhaLicenceTypeOnly);
  assert.equal(replies[1].body, EN.dhaLicenceRequest);
  assert.ok(events(phone).includes('uae_licence_media_refused'));
});

test('a typed licence number is stored and she goes on to her name', async () => {
  const phone = at(STATUS.AWAITING_DHA_LICENCE);
  await say(phone, text('DHA-12345678'));
  const p = records.get(phone);
  assert.equal(p.dhaLicenceNumber, 'DHA-12345678');
  assert.equal(p.licenceCompanyName, null);
  assert.equal(p.status, STATUS.AWAITING_NAME);
  assert.equal(lastToHer(phone).body, EN.nameQuestion);

  const company = at(STATUS.AWAITING_DHA_LICENCE);
  await say(company, text('Amana Healthcare staff ID 45213'));
  assert.equal(records.get(company).licenceCompanyName, 'Amana Healthcare');
  assert.equal(records.get(company).licenceStaffId, '45213');
  assert.equal(records.get(company).dhaLicenceNumber, null);
});

test('Correct goes straight to the terms (no certificate review), then Accept sends the app message and syncs region uae', async () => {
  const phone = at(STATUS.AWAITING_DISTRICT, { fullName: 'Priya Thomas', sex: 'Female', dhaLicenceNumber: 'DHA-12345678' });
  await say(phone, row('district_dxb_al_barsha'));
  assert.equal(records.get(phone).district, 'Al Barsha');
  await say(phone, button(BUTTON_IDS.LOGIN_PHONE_SAME));
  assert.equal(records.get(phone).appLoginPhone, phone, '+971 number kept as it is');
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.match(lastToHer(phone).body, /Area: Al Barsha/);

  sent.length = 0;
  await say(phone, button(BUTTON_IDS.DETAILS_CORRECT));
  let p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_TERMS_ACCEPTANCE);
  assert.equal(p.verification.status, 'verified');
  assert.equal(p.verification.method, 'uae_app_licence');
  assert.equal(sent.filter((m) => m.to !== phone).length, 0, 'no review alert to anyone');
  assert.deepEqual(toHer(phone).map((m) => m.kind), ['text', 'buttons']);
  assert.equal(toHer(phone)[0].body, EN.termsIntro);

  sent.length = 0;
  await say(phone, button(BUTTON_IDS.TERMS_ACCEPT));
  p = records.get(phone);
  assert.equal(p.status, STATUS.COMPLETED);
  assert.equal(p.termsAccepted, true);
  assert.equal(p.subscriptionFee, undefined, 'never due in the UAE, even with uae in the fee regions');
  const mine = toHer(phone);
  assert.equal(mine[0].body, 'Thank you. Your onboarding is complete.');
  assert.equal(mine[1].body, EN.uaeAppInstructions);
  assert.equal(mine[2].kind, 'buttons');
  assert.equal(mine[2].body, EN.pulsoAppInstalledQuestion);
  assert.ok(!mine.some((m) => /channel/i.test(String(m.body))), 'no Kerala duty channel invite');
  assert.ok(!mine.some((m) => /₹|\bRs\b|UPI/.test(String(m.body))));
  assert.equal(p.pulsoAppPromptStage, 'awaiting_installed_confirmation');

  const payload = synced[synced.length - 1];
  assert.equal(payload.phone, phone);
  assert.equal(payload.region, 'uae');
  assert.equal(payload.dhaLicenceNumber, 'DHA-12345678');
  assert.equal(payload.licenceCompanyName, '');
  assert.equal(payload.licenceStaffId, '');
  assert.equal(payload.verification.status, 'verified');
  assert.equal(payload.termsAccepted, true);
  assert.equal(payload.subscriptionFee, null);
});

test('a Basic caregiver reads her AED rate before the terms', async () => {
  const phone = at(STATUS.AWAITING_DISTRICT, { fullName: 'Anu', sex: 'Female', qualification: 'no_certificate', licenceCompanyName: 'X', licenceStaffId: '1' });
  await say(phone, row('district_dxb_deira'));
  await say(phone, button(BUTTON_IDS.LOGIN_PHONE_SAME));
  sent.length = 0;
  await say(phone, button(BUTTON_IDS.DETAILS_CORRECT));
  assert.equal(toHer(phone)[0].body, 'Because you have no Nursing/Caregiving course certificate, you have been selected as a Basic Caregiver.\n\nDuty pay: 8 hours AED 60/day, 24 hours AED 80/day.');
});

test('another login number: a typed UAE number is kept as 9715…', async () => {
  const phone = at(STATUS.AWAITING_LOGIN_PHONE, { fullName: 'Priya', sex: 'Female', district: 'Karama' });
  await say(phone, button(BUTTON_IDS.LOGIN_PHONE_OTHER));
  assert.equal(lastToHer(phone).body, EN.loginPhoneTypeAsk);
  await say(phone, text('+971 55 765 4321'));
  assert.equal(records.get(phone).appLoginPhone, '971557654321');
  assert.match(lastToHer(phone).body, /App login number: \+971 55 765 4321/);
});

test('"Installed" runs the hub sign-in check; she is told to take the 2 photos; no Duty Card question', async () => {
  const phone = at(STATUS.COMPLETED, {
    termsAccepted: true,
    pulsoAppRequired: true,
    pulsoAppActivationStatus: 'link_sent',
    pulsoAppPromptStage: 'awaiting_installed_confirmation',
    mobileAppCampaignStage: 'awaiting_installed_confirmation',
    mobileAppCampaignSource: 'post_onboarding'
  });
  sent.length = 0;
  await say(phone, button(BUTTON_IDS.PULSO_APP_INSTALLED));
  const p = records.get(phone);
  assert.equal(p.pulsoAppActivationStatus, 'verified');
  const bodies = toHer(phone).map((m) => m.body);
  assert.equal(bodies[0], EN.pulsoAppActivationVerified);
  assert.match(bodies[0], /Take 2 photos in the app/);
  assert.ok(bodies.includes(EN.postOnboardingSupport));
  assert.ok(!toHer(phone).some((m) => m.kind === 'buttons'), 'no Duty Card question');
  assert.ok(!events(phone).includes('agency_question_sent'));
});
