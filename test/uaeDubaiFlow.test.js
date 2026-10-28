'use strict';
// UAE caregivers, end to end through processIncomingMessage. 26 Oct 2026: the
// ad's "DUBAI CAREGIVER". 27 Oct 2026 (the founder's whole plan): the
// Bengaluru way — certificate photo, the DHA licence asked only to nurses,
// review before the terms — plus the visa question, the 12-hour shift and
// the emirate.
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

test('any other first message gets the region list WITHOUT UAE; typing Uae there does not pick Dubai', async () => {
  const phone = dubaiNumber();
  await say(phone, text('Hi'));
  const list = lastToHer(phone);
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.sections[0].rows.map((r) => r.title), ['Kerala', 'Karnataka']);
  await say(phone, text('Uae'));
  assert.notEqual(records.get(phone).region, 'uae');
});

test('a tap on a registered Dubai caregiver ad starts region uae even without the prefix', async () => {
  const before = process.env.UAE_CAREGIVER_AD_IDS;
  process.env.UAE_CAREGIVER_AD_IDS = '999000111';
  try {
    const phone = dubaiNumber();
    await say(phone, { ...text('Hello! Can I get more info on this?'), referral: { source_id: '999000111', source_type: 'ad' } });
    assert.equal(records.get(phone).region, 'uae');
    assert.equal(records.get(phone).status, STATUS.AWAITING_LANGUAGE_SELECTION);
  } finally {
    if (before === undefined) delete process.env.UAE_CAREGIVER_AD_IDS; else process.env.UAE_CAREGIVER_AD_IDS = before;
  }
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

test('another login number: a typed UAE number is kept as 9715…', async () => {
  const phone = at(STATUS.AWAITING_LOGIN_PHONE, { fullName: 'Priya', sex: 'Female', district: 'Karama' });
  await say(phone, button(BUTTON_IDS.LOGIN_PHONE_OTHER));
  assert.equal(lastToHer(phone).body, EN.loginPhoneTypeAsk);
  await say(phone, text('+971 55 765 4321'));
  assert.equal(records.get(phone).appLoginPhone, '971557654321');
  assert.match(lastToHer(phone).body, /App login number: \+971 55 765 4321/);
});


test('the visa question comes right after the age, then the working model with the UAE intro and 12 hours', async () => {
  const phone = at(STATUS.AWAITING_AGE, { interestConfirmed: false, age: null });
  await say(phone, text('34'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_VISA_TYPE);
  const list = lastToHer(phone);
  assert.equal(list.kind, 'list');
  assert.equal(list.body, 'Which visa are you on now?');
  assert.deepEqual(list.sections[0].rows.map((r) => r.id), ['visa_company', 'visa_family', 'visa_visit', 'visa_freelance', 'visa_other']);
  assert.ok(list.sections[0].rows.every((r) => r.title.length <= 24), 'WhatsApp row titles fit');

  await say(phone, text('hello'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_VISA_TYPE, 'nothing else is taken as the visa');
  await say(phone, row('visa_family'));
  const p = records.get(phone);
  assert.equal(p.uaeVisaType, 'family');
  assert.equal(p.status, STATUS.AWAITING_NATIONALITY, 'nationality next (29 Oct 2026)');
  await say(phone, row('nat_sri_lankan'));
  assert.equal(records.get(phone).uaeNationality, 'Sri Lankan');
  assert.equal(records.get(phone).status, STATUS.AWAITING_INTEREST);
  const model = toHer(phone).find((m) => m.kind === 'text' && /Pulso Global Private Limited/.test(m.body));
  assert.match(model.body, /In the UAE we give caregivers/);
  assert.match(model.body, /Duty timing may be 8 hours, 12 hours or 24 hours/);
  assert.match(model.body, /For 12-hour duty, you will receive AED 80 to AED 110 per day/);
});

test('duty hours are a list with 12 hour; a 12-hour pick gets the 12-hour sample, then the 24-hour one', async () => {
  const phone = at(STATUS.AWAITING_INTEREST, { interestConfirmed: false });
  await say(phone, button(BUTTON_IDS.INTEREST_YES));
  const list = toHer(phone).filter((m) => m.kind === 'list').pop();
  assert.deepEqual(list.sections[0].rows.map((r) => r.title), ['8 hour', '12 hour', '24 hour', 'Any duty']);
  assert.match(lastToHer(phone).body, /12 hour - AED 80 to AED 110 per day/);
  await say(phone, row(BUTTON_IDS.DUTY_HOUR_12));
  assert.equal(records.get(phone).dutyHourPreference, '12_hour');
  const before = toHer(phone).length;
  await say(phone, button(BUTTON_IDS.SAMPLE_DUTY_YES));
  const after = toHer(phone).slice(before);
  assert.ok(after.some((m) => /Duty: 12 hours/.test(m.body) && /AED 90 per day/.test(m.body)), '12-hour sample');
  await say(phone, button(BUTTON_IDS.SAMPLE_DUTY_YES));
  assert.ok(toHer(phone).some((m) => /Duty: 24-hour care/.test(String(m.body))), 'then the 24-hour one');
  assert.equal(lastToHer(phone).kind, 'list', 'final choice is the same list');
  await say(phone, row(BUTTON_IDS.DUTY_HOUR_12));
  assert.equal(records.get(phone).dutyHourPreference, '12_hour');
});

test('a caregiver gets the certificate photo step (never the DHA licence); no certificate goes to the name', async () => {
  const phone = at(STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION, { qualification: 'hca' });
  await say(phone, button(BUTTON_IDS.EXPECTED_DUTIES_YES));
  assert.equal(records.get(phone).status, STATUS.AWAITING_CERTIFICATE);
  assert.equal(lastToHer(phone).body, 'Please send a clear photo of your *HCA (Home Care Assistant) course certificate*.\n\nNot your CV or resume — we need the certificate itself.\nDo not send your Emirates ID or passport.');
  assert.ok(!toHer(phone).some((m) => /DHA/.test(String(m.body))), 'no DHA words for a caregiver');

  const none = at(STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION, { qualification: 'no_certificate' });
  await say(none, button(BUTTON_IDS.EXPECTED_DUTIES_YES));
  assert.equal(records.get(none).status, STATUS.AWAITING_NAME);
});

test('a nurse is asked "Do you have a DHA nursing licence?" — Yes: number, then nursing certificate', async () => {
  const phone = at(STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION, { qualification: 'gnm' });
  await say(phone, button(BUTTON_IDS.EXPECTED_DUTIES_YES));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DHA_LICENCE_HAS);
  assert.equal(lastToHer(phone).body, 'Do you have a DHA nursing licence?');
  assert.deepEqual(lastToHer(phone).buttons.map((b) => b.title), ['Yes', 'Not yet']);
  await say(phone, button(BUTTON_IDS.DHA_HAS_YES));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DHA_LICENCE);
  assert.equal(lastToHer(phone).body, 'Type your DHA licence number.\nOnly the number. Do not send ID cards or your passport here.');
  await say(phone, text('Amana Healthcare staff ID 45213'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DHA_LICENCE, 'a company and staff ID is not a licence');
  await say(phone, text('DHA-P-0457712'));
  const p = records.get(phone);
  assert.equal(p.dhaLicenceNumber, 'DHA-P-0457712');
  assert.equal(p.status, STATUS.AWAITING_CERTIFICATE);
  assert.equal(lastToHer(phone).body, 'Please send a clear photo of your nursing certificate.\nDo not send your Emirates ID or passport.');
});

test('a nurse with no licence yet joins as a caregiver and sends the nursing certificate', async () => {
  const phone = at(STATUS.AWAITING_DHA_LICENCE_HAS, { qualification: 'bsc_nursing' });
  await say(phone, button(BUTTON_IDS.DHA_HAS_NOT_YET));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_CERTIFICATE);
  assert.equal(p.uaeNurseWithoutLicence, true);
  assert.equal(p.careTier, 'gda');
  assert.match(lastToHer(phone).body, /^No problem\. You can join Pulso as a caregiver now/);
  assert.equal(flow.rateBandFor(p, {}), 'gda', 'caregiver band');
});

test('the emirate comes before the area: Sharjah is her area; Dubai opens the Dubai list', async () => {
  const phone = at(STATUS.AWAITING_WEIGHT, { fullName: 'Rini', sex: 'Female', heightRange: 'h_5_3_5_5' });
  await say(phone, text('60'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_EMIRATE);
  assert.equal(lastToHer(phone).body, 'Which emirate do you live in?');
  await say(phone, row('emirate_sharjah'));
  let p = records.get(phone);
  assert.equal(p.emirate, 'Sharjah');
  assert.equal(p.district, 'Sharjah');
  assert.equal(p.status, STATUS.AWAITING_LOGIN_PHONE);

  const dxb = at(STATUS.AWAITING_EMIRATE, { fullName: 'Rini', sex: 'Female' });
  await say(dxb, row('emirate_dubai'));
  p = records.get(dxb);
  assert.equal(p.emirate, 'Dubai');
  assert.equal(p.status, STATUS.AWAITING_DISTRICT);
  await say(dxb, row('district_dxb_al_qusais'));
  assert.equal(records.get(dxb).district, 'Al Qusais');
});

test('Correct sends her for review (no terms); the reviewer alert carries visa, emirate and licence', async () => {
  const phone = at(STATUS.AWAITING_LOGIN_PHONE, {
    fullName: 'Anju Thomas', sex: 'Female', qualification: 'gnm', district: 'Sharjah', emirate: 'Sharjah',
    uaeVisaType: 'family', dhaLicenceNumber: 'DHA-P-0457712',
    documents: { certificateAttachments: [{ id: 'c1', cloudArchived: true, cloudStorageUrl: 'https://x/c1' }] }
  });
  await say(phone, button(BUTTON_IDS.LOGIN_PHONE_SAME));
  const check = lastToHer(phone).body;
  assert.match(check, /Visa: Husband \/ family visa/);
  assert.match(check, /DHA licence: DHA-P-0457712/);
  assert.match(check, /Area: Sharjah/);
  assert.doesNotMatch(check, /Emirate:/, 'the emirate is the area here');
  sent.length = 0;
  await say(phone, button(BUTTON_IDS.DETAILS_CORRECT));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.VERIFICATION_PENDING);
  assert.equal(p.verification.status, 'pending');
  assert.ok(!toHer(phone).some((m) => m.body === EN.termsIntro), 'no terms before the review');
  assert.equal(lastToHer(phone).body, EN.verificationPending);
  const alert = sent.filter((m) => m.to !== phone).map((m) => String(m.body)).join('\n');
  assert.match(alert, /Visa: Husband \/ family visa/);
  assert.match(alert, /DHA licence: DHA-P-0457712 \(check on Sheryan\)/);
});

test('approve: "certificate verified" (no experience certificate), then the terms; Accept sends the app message', async () => {
  const phone = at(STATUS.VERIFICATION_PENDING, {
    fullName: 'Rini Raju', sex: 'Female', qualification: 'hca', district: 'Al Qusais', emirate: 'Dubai',
    uaeVisaType: 'family', detailsConfirmedAt: new Date().toISOString(), verification: { status: 'pending' }
  });
  sent.length = 0;
  await bot.approveCertificate(phone, 'ops-team', '', 'hca', []);
  const mine = toHer(phone);
  assert.equal(mine[0].body, 'Your certificate has been verified.\nYou are eligible to join Pulso.');
  assert.equal(mine[1].body, EN.termsIntro);
  assert.equal(mine[2].kind, 'buttons');
  assert.equal(records.get(phone).status, STATUS.AWAITING_TERMS_ACCEPTANCE);

  sent.length = 0;
  await say(phone, button(BUTTON_IDS.TERMS_ACCEPT));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.COMPLETED);
  assert.equal(p.subscriptionFee, undefined, 'never due in the UAE');
  const after = toHer(phone);
  assert.equal(after[0].body, 'Thank you. Your onboarding is complete.');
  assert.match(after[1].body, /Keep the app notifications ON\. Duty offers from agencies will come in the app\.$/);
  assert.doesNotMatch(after[1].body, /DHA|photo/);
  const payload = synced[synced.length - 1];
  assert.equal(payload.region, 'uae');
  assert.equal(payload.uaeVisaType, 'family');
  assert.equal(payload.emirate, 'Dubai');
  assert.equal(payload.verification.status, 'verified');
});

test('a UAE nurse is approved as nurse or as caregiver; no number means caregiver', async () => {
  const withNo = at(STATUS.VERIFICATION_PENDING, { qualification: 'gnm', dhaLicenceNumber: 'DHA-P-1', verification: { status: 'pending' } });
  await bot.approveCertificate(withNo, 'ops', '', 'gnm', [], { approveAs: 'nurse' });
  assert.equal(records.get(withNo).careTier, null);
  assert.equal(records.get(withNo).uaeApprovedAs, 'nurse');

  const notActive = at(STATUS.VERIFICATION_PENDING, { qualification: 'gnm', dhaLicenceNumber: 'DHA-P-2', verification: { status: 'pending' } });
  await bot.approveCertificate(notActive, 'ops', '', 'gnm', [], { approveAs: 'caregiver' });
  assert.equal(records.get(notActive).careTier, 'gda');

  const notYet = at(STATUS.VERIFICATION_PENDING, { qualification: 'bsc_nursing', uaeNurseWithoutLicence: true, careTier: 'gda', verification: { status: 'pending' } });
  await bot.approveCertificate(notYet, 'ops', '', 'bsc_nursing', []);
  assert.equal(records.get(notYet).careTier, 'gda');
  assert.equal(synced.length >= 0, true);
});

test('a Basic caregiver reads her AED rate after approval, before the terms', async () => {
  const phone = at(STATUS.VERIFICATION_PENDING, { fullName: 'Anu', sex: 'Female', qualification: 'no_certificate', verification: { status: 'pending' } });
  sent.length = 0;
  await bot.approveCertificate(phone, 'ops', '', 'basic_caregiver', ['no_course_certificate']);
  const bodies = toHer(phone).map((m) => m.body);
  assert.ok(bodies.includes('Because you have no Nursing/Caregiving course certificate, you have been selected as a Basic Caregiver.\n\nDuty pay: 8 hours AED 60/day, 24 hours AED 80/day.'));
});

test('changing the area at the details check starts with the emirate list', async () => {
  const phone = at(STATUS.AWAITING_DETAILS_CONFIRMATION, { fullName: 'Rini', sex: 'Female', district: 'Al Qusais', emirate: 'Dubai' });
  await say(phone, button(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_DISTRICT));
  assert.equal(lastToHer(phone).body, 'Which emirate do you live in?');
  await say(phone, row('emirate_ajman'));
  const p = records.get(phone);
  assert.equal(p.district, 'Ajman');
  assert.equal(p.emirate, 'Ajman');
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
});

test('app reminders: 2 hours after Accept (links), 22 hours after (Need help); none once signed in', async () => {
  const done = Date.parse('2026-10-27T03:00:00Z');
  const phone = at(STATUS.COMPLETED, {
    fullName: 'Rini Raju', appLoginPhone: '971542498583', completedAt: new Date(done).toISOString(),
    pulsoAppActivationStatus: 'link_sent', verification: { status: 'verified' },
    history: [{ at: new Date(done).toISOString(), type: 'inbound_message', payload: {} }]
  });
  const run = (h) => bot.runUaeAppReminderSweep({ now: done + h * 3600e3, providers: [records.get(phone)], skipHub: true });
  let r = await run(1);
  assert.equal(r.scanned, 0, 'not yet');
  r = await run(2.1);
  assert.equal(r.reminded1, 1);
  assert.match(lastToHer(phone).body, /^Hi Rini, one step left\. Install the Pulso app and sign in with \+971 54 249 8583\./);
  r = await run(3);
  assert.equal(r.scanned, 0, 'one first reminder');
  r = await run(22.5);
  assert.equal(r.reminded2, 1);
  assert.equal(lastToHer(phone).body, 'Hi Rini, duty offers start only after you sign in to the Pulso app. It takes 2 minutes.');
  assert.equal(lastToHer(phone).buttons[0].id, BUTTON_IDS.PULSO_APP_NEED_HELP);

  const signedIn = at(STATUS.COMPLETED, { completedAt: new Date(done).toISOString(), pulsoAppActivationStatus: 'verified', verification: { status: 'verified' } });
  assert.equal(bot.uaeReminderDue(records.get(signedIn), done + 3 * 3600e3), null);
  const legacy = at(STATUS.COMPLETED, { completedAt: new Date(done).toISOString(), verification: { status: 'verified', method: 'uae_app_licence' } });
  assert.equal(bot.uaeReminderDue(records.get(legacy), done + 3 * 3600e3), null, 'old app-licence records left alone');
});

test('the UAE sandbox (+971 50 000 01xx) never alerts the real reviewers', async () => {
  const phone = '971500000101';
  records.set(phone, { ...blank(phone), region: 'uae', flowId: 'uae_english', language: 'en', status: STATUS.AWAITING_LOGIN_PHONE,
    qualification: 'hca', age: 30, fullName: 'TEST', sex: 'Female', district: 'Deira', emirate: 'Dubai', interestConfirmed: true,
    documents: { certificateAttachments: [{ id: 'c1', cloudArchived: true, cloudStorageUrl: 'https://x/c1' }] },
    history: [{ at: new Date().toISOString(), type: 'inbound_message', payload: {} }] });
  await say(phone, button(BUTTON_IDS.LOGIN_PHONE_SAME));
  sent.length = 0;
  await say(phone, button(BUTTON_IDS.DETAILS_CORRECT));
  assert.equal(records.get(phone).status, STATUS.VERIFICATION_PENDING);
  assert.equal(sent.filter((m) => m.to !== phone).length, 0, 'nothing to the reviewers');
});
