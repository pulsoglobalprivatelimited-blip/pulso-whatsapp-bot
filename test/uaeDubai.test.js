'use strict';
// Dubai caregivers (founder, 26 Oct 2026): the Bengaluru flow same to same,
// with Dubai for Bengaluru, AED for Rs/₹, "cash or bank transfer" for "cash or
// UPI", and a typed DHA licence for the certificate photo.
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.SUBSCRIPTION_FEE_ENABLED = 'true';
process.env.SUBSCRIPTION_FEE_START_AT = '2026-11-01T00:00:00Z';

const test = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../src/flow');
const { FLOWS, BUTTON_IDS } = flow;
const { parseRegion, parseUaeMobile, parseIndianMobile, isDubaiCaregiverText } = require('../src/services/messageParser');
const { parseLicenceAnswer, reviewedMessage, uaeLicenceReviewedHandler, handleLicenceReviewed } = require('../src/services/uaeLicence');
const fee = require('../src/services/subscriptionFee');
const { buildProviderSyncPayload } = require('../src/services/pulsoHubSyncService');
const { normalize } = require('../src/services/providerTiersConfig');
const regionService = require('../src/services/regionService');

const UAE_EN = FLOWS.uae_english;
const UAE_ML = FLOWS.uae_malayalam;
const RUPEE = /₹|\bRs\b|\bUPI\b|Bengaluru|Karnataka/;
// The live India card, as the hub doc would carry it with no UAE block.
const INDIA_TIERS = normalize({
  tiers: { basic: { payout8h: 500, payout24h: 600 }, gda: { payout8h: 600, payout24h: 700 }, nurse: { payout8h: 1200, payout24h: 1400 } }
});

function strings(value, path = '') {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

// ---- the texts ---------------------------------------------------------------

test('two UAE flows, region uae, AED, Dubai areas; the region list and default flow know them', () => {
  for (const f of [UAE_EN, UAE_ML]) {
    assert.equal(f.region, 'uae');
    assert.equal(f.currency, 'AED');
    assert.deepEqual(
      f.DISTRICTS.map((d) => d.title),
      ['Al Barsha', 'Al Nahda', 'Al Qusais', 'Bur Dubai', 'Deira', 'Discovery Gardens', 'International City', 'JLT', 'JVC', 'Jumeirah', 'Karama', 'Marina', 'Mirdif', 'Satwa', 'Silicon Oasis', 'Al Quoz', 'Business Bay', 'Other']
    );
  }
  assert.equal(UAE_EN.language, 'en');
  assert.equal(UAE_ML.language, 'ml');
  // UAE is never in the public region list (27 Oct 2026: a Kerala-ad caregiver picked it).
  assert.deepEqual(flow.REGION_OPTIONS.map((r) => r.title), ['Kerala', 'Karnataka']);
  assert.equal(flow.DEFAULT_FLOW_ID_BY_REGION.uae, 'uae_english');
  assert.equal(flow.getFlowIdFor('uae', 'ml'), 'uae_malayalam');
  assert.equal(regionService.inferRegionFromDistrict('Al Barsha'), 'uae');
  assert.equal(regionService.normalizeRegion('UAE'), 'uae');
});

test('no Rs, ₹, UPI or Bengaluru anywhere in either UAE message set', () => {
  // (The region retry line names all three regions, Karnataka among them.)
  const MONEY_OR_PLACE = /₹|\bRs\b|\bUPI\b|Bengaluru/;
  for (const f of [UAE_EN, UAE_ML]) {
    for (const [key, text] of strings(f.MESSAGES)) {
      assert.doesNotMatch(text, MONEY_OR_PLACE, `${f.id}.${key}`);
    }
  }
});

test('the UAE texts are the Bengaluru texts with Dubai, AED and bank transfer swapped in', () => {
  const en = UAE_EN.MESSAGES;
  const blr = FLOWS.karnataka_english.MESSAGES;
  assert.equal(
    en.workingModel,
    blr.workingModel
      .replace("In Bengaluru we give", 'In the UAE we give')
      .replace('anywhere in Bengaluru', 'anywhere in Dubai')
      .replace('Duty timing may be 8 hours or 24 hours', 'Duty timing may be 8 hours, 12 hours or 24 hours')
      .replace('Rs 600 to Rs 900', 'AED 60 to AED 90')
      .replace('Rs 750 to Rs 1000', 'AED 80 to AED 120')
      .replace('by cash or UPI', 'by cash or bank transfer')
  );
  assert.match(en.termsIntro, /duty offers from home-care agencies in Dubai/);
  assert.match(en.termsIntro, /directly, by cash or bank transfer, on the day you and the agency agree/);
  assert.match(en.sampleDutyOffer24Hour, /Location: Al Barsha, Dubai/);
  assert.match(en.sampleDutyOffer24Hour, /AED \{\{payout24h\}\} per day, fixed by the agency\nAED \{\{total24h\}\} for 30 days/);
  assert.match(UAE_ML.MESSAGES.workingModel, /Duty area Dubai-യിൽ എവിടെയും ആയിരിക്കാം/);
  assert.match(UAE_ML.MESSAGES.workingModel, /cash അല്ലെങ്കിൽ bank transfer/);
  assert.match(UAE_ML.MESSAGES.sampleDutyOffer8Hour, /Agency pays you directly \(cash \/ bank transfer\)/);
  // 27 Oct 2026: nurses only, the founder's lines 1 and 3 word for word.
  assert.equal(en.dhaLicenceRequest, 'Type your DHA licence number.\nOnly the number. Do not send ID cards or your passport here.');
  assert.match(UAE_ML.MESSAGES.dhaLicenceRequest, /DHA licence/);
  assert.doesNotMatch(UAE_ML.MESSAGES.dhaLicenceRequest, /staff ID/);
  assert.equal(en.certificateRequest, 'Please send a clear photo of your certificate.\n\nNot your CV or resume — we need the certificate itself.\nDo not send your Emirates ID or passport.');
  assert.equal(en.certificateApproved, 'Your certificate has been verified.\nYou are eligible to join Pulso.');
  assert.equal(en.dhaHasQuestion, 'Do you have a DHA nursing licence?');
  assert.equal(en.visaQuestion, 'Which visa are you on now?');
  assert.equal(en.emirateQuestion, 'Which emirate do you live in?');
  assert.match(en.uaeAppInstructions, /play\.google\.com.*\n.*apps\.apple\.com\/ae\//);
  assert.match(en.uaeAppInstructions, /Sign in with this WhatsApp number\./);
  assert.match(en.uaeAppInstructions, /Keep the app notifications ON\. Duty offers from agencies will come in the app\.$/);
  assert.doesNotMatch(en.uaeAppInstructions, /DHA|photo/);
  assert.equal(en.experienceCertificateNotice, null, 'Indian company certificate is not offered in Dubai');
  assert.doesNotMatch(en.termsAccepted, /180|experience/i);
  assert.equal(en.agencyQuestion, null, 'the India-only Duty Card question is not asked');
});

// ---- the money -----------------------------------------------------------------

function render(flowId, subject, tiers = INDIA_TIERS) {
  return flow.runWithFlow(flowId, () => ({
    model: flow.getWorkingModelFor(subject, tiers),
    summary: flow.getDutyHourPaymentSummaryFor(subject, tiers),
    s24: flow.getSampleDutyOfferFor(subject, tiers, '24_hour'),
    s8: flow.getSampleDutyOfferFor(subject, tiers, '8_hour'),
    terms: flow.getTermsRateFor(subject, tiers),
    ageNotice: flow.getBasicTierAgeNoticeFor(subject, tiers),
    qualNotice: flow.getBasicQualificationNoticeFor(subject, tiers)
  }));
}

test('nurse: AED 150-250 (24h), AED 100-150 (8h), sample AED 150/day = AED 4,500', () => {
  const r = render('uae_english', { qualification: 'gnm', age: 30 });
  assert.match(r.model, /For 24-hour duty, you will receive AED 150 to AED 250 per day/);
  assert.match(r.model, /For 8-hour duty, you will receive AED 100 to AED 150 per day/);
  assert.equal(r.summary.split('\n\n')[0], '24 hour - AED 150 to AED 250 per day\n8 hour - AED 100 to AED 150 per day');
  assert.match(r.s24, /AED 150 per day, fixed by the agency\nAED 4,500 for 30 days/);
  assert.match(r.s8, /AED 100 per day/);
});

test('GDA: AED 80-120 (24h), AED 80-110 (12h), AED 70-100 (8h), sample AED 100/day = AED 3,000', () => {
  const r = render('uae_english', { qualification: 'gda', age: 30 });
  assert.match(r.model, /7\. For 24-hour duty, you will receive AED 80 to AED 120 per day/);
  assert.match(r.model, /8\. For 12-hour duty, you will receive AED 80 to AED 110 per day/);
  assert.match(r.model, /9\. For 8-hour duty, you will receive AED 70 to AED 100 per day/);
  assert.match(r.model, /13\. There will be no housemaid work/);
  assert.equal(r.summary.split('\n').slice(0, 3).join('|'), '24 hour - AED 80 to AED 120 per day|12 hour - AED 80 to AED 110 per day|8 hour - AED 70 to AED 100 per day');
  const s12 = flow.runWithFlow('uae_english', () => flow.getSampleDutyOfferFor({ qualification: 'gda', age: 30 }, INDIA_TIERS, '12_hour'));
  assert.match(s12, /Duty: 12 hours/);
  assert.match(s12, /AED 90 per day/);
  assert.match(r.s24, /AED 100 per day, fixed by the agency\nAED 3,000 for 30 days/);
  assert.match(r.s8, /AED 70 per day/);
});

test('Basic: flat AED 60 (8h) / AED 80 (24h), in every Basic line', () => {
  const r = render('uae_english', { qualification: 'basic_caregiver', age: 30 });
  assert.match(r.model, /For 24-hour duty, you will receive AED 80 per day/);
  assert.match(r.model, /For 8-hour duty, you will receive AED 60 per day/);
  assert.equal(r.terms, 'Because you have no Nursing/Caregiving course certificate, you have been selected as a Basic Caregiver.\n\nDuty pay: 8 hours AED 60/day, 24 hours AED 80/day.');
  assert.match(r.qualNotice, /8 hours AED 60\/day, 24 hours AED 80\/day/);
  const over = render('uae_english', { qualification: 'gda', age: 55 });
  assert.match(over.ageNotice, /8 hours AED 60\/day, 24 hours AED 80\/day/);
  assert.doesNotMatch(over.terms, /certificate has been checked/, 'no certificate is checked in Dubai');
});

test('every rendered UAE line, both languages, all bands: AED and never a rupee', () => {
  for (const id of ['uae_english', 'uae_malayalam']) {
    for (const subject of [{ qualification: 'gnm', age: 30 }, { qualification: 'gda', age: 30 }, { qualification: 'no_certificate', age: 30 }, { qualification: 'gda', age: 55 }]) {
      for (const [key, text] of Object.entries(render(id, subject))) {
        if (text === null) continue;
        assert.doesNotMatch(text, RUPEE, `${id} ${subject.qualification} ${key}`);
      }
      assert.match(render(id, subject).summary, /AED \d+/);
    }
  }
  const ml = render('uae_malayalam', { qualification: 'gnm', age: 30 });
  assert.match(ml.model, /24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ AED 150 മുതൽ AED 250 വരെ ലഭിക്കും/);
  assert.match(ml.s24, /AED 150 per day × 30 days\n👉 AED 4,500 total/);
});

test('the live doc wins: markets.uae.tiers figures replace the defaults; India is untouched', () => {
  const doc = normalize({
    tiers: { gda: { payout8h: 600, payout24h: 700 } },
    markets: { uae: { tiers: { gda: { sample24h: 110, shownTo24h: 130 }, basic: { payout24h: 85 } } } }
  });
  const r = render('uae_english', { qualification: 'gda', age: 30 }, doc);
  assert.match(r.s24, /AED 110 per day, fixed by the agency\nAED 3,300 for 30 days/);
  assert.match(r.model, /AED 80 to AED 130 per day/);
  assert.match(render('uae_english', { qualification: 'no_certificate' }, doc).model, /receive AED 85 per day/);
  const india = render('karnataka_english', { qualification: 'gda', age: 30 }, doc);
  assert.match(india.summary, /^24 hour - Rs 900 to Rs 1200 per day/);
  assert.match(india.s24, /Rs 1000 per day, fixed by the agency\nRs 30000 for 30 days/);
});

test('no cooking question in Dubai until the doc gives an AED figure for it', () => {
  flow.runWithFlow('uae_english', () => {
    assert.equal(flow.isCookingQuestionFor({ qualification: 'gda' }, INDIA_TIERS), false);
    const withExtra = normalize({ markets: { uae: { supportingCareExtraPerDay: 30 } } });
    assert.equal(flow.isCookingQuestionFor({ qualification: 'gda' }, withExtra), true);
    assert.match(flow.getCookingQuestionFor({ qualification: 'gda' }, withExtra), /AED 90 \+ AED 30 = \*AED 120\/day\*/);
  });
  flow.runWithFlow('karnataka_english', () => {
    assert.equal(flow.isCookingQuestionFor({ qualification: 'gda' }, INDIA_TIERS), true, 'Bengaluru still asked');
  });
});

// ---- the ad's first message --------------------------------------------------

const typed = (body) => ({ type: 'text', text: { body } });
const tap = (id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'x' } } });

test('"DUBAI CAREGIVER" in any case starts region uae; typing Dubai alone does not', () => {
  for (const words of ['DUBAI CAREGIVER', 'dubai caregiver', '  Dubai  Caregiver - I want a job']) {
    assert.equal(isDubaiCaregiverText(words), true, words);
    assert.equal(parseRegion(typed(words)), 'uae', words);
  }
  assert.equal(isDubaiCaregiverText('caregiver in dubai'), false);
  assert.equal(isDubaiCaregiverText('DUBAI AGENCY'), false);
  assert.equal(parseRegion(tap(BUTTON_IDS.REGION_UAE)), 'uae');
  assert.equal(parseRegion(typed('Dubai')), null);
  assert.equal(parseRegion(typed('Uae')), null);
  assert.equal(parseRegion(typed('Kerala')), 'kerala');
});

// ---- the licence answer --------------------------------------------------------

test('a licence number is stored as the licence; anything else as company + staff ID', () => {
  for (const n of ['DHA-12345678', '12345678', 'P 1234567', 'dha-p-0098765']) {
    const r = parseLicenceAnswer(n);
    assert.equal(r.kind, 'licence', n);
    assert.equal(r.dhaLicenceNumber, n);
    assert.equal(r.licenceCompanyName, '');
  }
  const cases = [
    ['Amana Healthcare staff ID 45213', 'Amana Healthcare', '45213'],
    ['Emirates Home Nursing, 7781', 'Emirates Home Nursing', '7781'],
    ['Aster home care EMP-552', 'Aster home care', 'EMP-552'],
    ['NMC 123', 'NMC', '123'],
    ['Al Noor Nursing Services', 'Al Noor Nursing Services', '']
  ];
  for (const [input, company, staff] of cases) {
    const r = parseLicenceAnswer(input);
    assert.equal(r.kind, 'company', input);
    assert.equal(r.licenceCompanyName, company, input);
    assert.equal(r.licenceStaffId, staff, input);
    assert.equal(r.dhaLicenceNumber, '');
    assert.equal(r.licenceText, input);
  }
  assert.equal(parseLicenceAnswer('   '), null);
  assert.equal(parseLicenceAnswer('DHA 1234 5678').kind, 'company', 'two spaces is not a licence number');
});

// ---- the fee -------------------------------------------------------------------

test('the subscription fee is never required in the UAE, whatever the config or record says', () => {
  const START = Date.parse('2026-11-01T00:00:00Z');
  const NOW = START + 10 * 86400000;
  const dubai = { phone: '971501234567', region: 'uae', flowId: 'uae_english', createdAt: new Date(START + 86400000).toISOString() };
  const everywhere = { ...fee.settings(), enabled: true, startAtMs: START, regions: ['kerala', 'karnataka', 'uae'] };
  assert.equal(fee.feeAppliesTo(dubai, NOW, everywhere), false);
  assert.equal(fee.feeAppliesTo({ ...dubai, subscriptionFee: { required: true, status: 'due' } }, NOW, everywhere), false);
  assert.equal(fee.feeAppliesTo({ ...dubai, region: null }, NOW, everywhere), false, 'from the flow alone');
  assert.equal(fee.termsIntroFor(dubai, UAE_EN.MESSAGES, NOW), UAE_EN.MESSAGES.termsIntro);
  assert.equal(fee.feeAppliesTo({ ...dubai, region: 'kerala', flowId: 'kerala_malayalam' }, NOW, everywhere), true, 'Kerala unchanged');
});

// ---- +971 numbers ----------------------------------------------------------------

test('+971 numbers stay +971: typed login numbers, the hub payload, and the Indian parser', () => {
  for (const n of ['050 123 4567', '0501234567', '501234567', '+971 50 123 4567', '971501234567', '00971501234567']) {
    assert.equal(parseUaeMobile(typed(n)), '971501234567', n);
  }
  assert.equal(parseUaeMobile(typed('9876543210')), null);
  assert.equal(parseIndianMobile(typed('+971 50 123 4567')), null, 'never read as an Indian number');
  const payload = buildProviderSyncPayload({
    phone: '971501234567', region: 'uae', flowId: 'uae_english', appLoginPhone: '971507654321',
    dhaLicenceNumber: 'DHA-12345678', status: 'completed', termsAccepted: true
  });
  assert.equal(payload.phone, '971501234567');
  assert.equal(payload.appLoginPhone, '971507654321');
  assert.equal(payload.region, 'uae');
  assert.equal(payload.dhaLicenceNumber, 'DHA-12345678');
  assert.equal(payload.licenceCompanyName, '');
  assert.equal(payload.licenceStaffId, '');
  const india = buildProviderSyncPayload({ phone: '919876543210', region: 'karnataka', flowId: 'karnataka_english' });
  assert.equal('dhaLicenceNumber' in india, false, 'India payload unchanged');
});

// ---- the review route --------------------------------------------------------------

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
function fakeReq(headers, body) {
  return { body, get: (name) => headers[String(name).toLowerCase()] };
}
function fakeDeps(provider, { sendFails = false, inWindow = true } = {}) {
  const sent = [];
  const history = [];
  const patches = [];
  return {
    sent, history, patches,
    getProvider: async (phone) => (provider && provider.phone === phone ? provider : null),
    updateProvider: async (phone, patch) => { patches.push(patch); },
    appendHistory: async (phone, entry) => { history.push(entry); },
    sendText: async (to, body) => { if (sendFails) throw new Error('outside window'); sent.push({ to, body }); },
    sendTemplate: async (to, name) => { sent.push({ to, template: name }); },
    isWithinWhatsappReplyWindow: () => inWindow
  };
}
const PRIYA = { phone: '971501234567', region: 'uae', flowId: 'uae_english', fullName: 'Priya Thomas', district: 'Al Barsha' };

test('the route refuses a missing or wrong secret, and a refused secret sends nothing', async () => {
  const deps = fakeDeps(PRIYA);
  const handler = uaeLicenceReviewedHandler(() => deps, () => 'S3CRET');
  for (const headers of [{}, { 'x-pulso-bot-secret': 'wrong' }]) {
    const res = fakeRes();
    await handler(fakeReq(headers, { phone: PRIYA.phone, action: 'approve' }), res);
    assert.equal(res.statusCode, 401);
  }
  const res = fakeRes();
  await uaeLicenceReviewedHandler(() => deps, () => '')(fakeReq({ 'x-pulso-bot-secret': '' }, {}), res);
  assert.equal(res.statusCode, 401, 'an unset secret refuses everybody');
  assert.equal(deps.sent.length, 0);
});

test('approve / video_call / reject send the founder lines from the caregiver number', async () => {
  const deps = fakeDeps(PRIYA);
  const handler = uaeLicenceReviewedHandler(() => deps, () => 'S3CRET');
  const call = async (body) => {
    const res = fakeRes();
    await handler(fakeReq({ 'x-pulso-bot-secret': 'S3CRET' }, body), res);
    return res;
  };
  let res = await call({ phone: '+971 50 123 4567', action: 'approve', name: 'Priya' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.delivered, 'text');
  assert.deepEqual(deps.sent.pop(), { to: '971501234567', body: '✅ You are verified, Priya.\nKeep the Pulso app notifications ON. Duty offers near Al Barsha will come in the app.' });
  res = await call({ phone: '971501234567', action: 'video_call', name: 'Priya' });
  assert.equal(deps.sent.pop().body, 'Hi Priya, we need to confirm one thing.\nOur team will video-call you for 1 minute today. Please keep your licence card ready.');
  res = await call({ phone: '971501234567', action: 'reject' });
  assert.match(deps.sent.pop().body, /^Hi Priya, we could not check your photos\. Please open the Pulso app and take the 2 photos again/);
  assert.deepEqual(deps.patches.map((p) => p.uaeLicenceReview.action), ['approve', 'video_call', 'reject']);
  res = await call({ phone: '971501234567', action: 'maybe' });
  assert.equal(res.statusCode, 400);
});

test('outside the 24-hour window with no template: reported, not raised; Malayalam for a Malayalam flow', async () => {
  const deps = fakeDeps({ ...PRIYA, flowId: 'uae_malayalam' }, { sendFails: true, inWindow: false });
  const result = await handleLicenceReviewed({ phone: PRIYA.phone, action: 'approve', name: 'Priya' }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.delivered, 'none');
  assert.match(result.text, /^✅ Priya, താങ്കൾ verified ആണ്\./);
  assert.equal(reviewedMessage('approve', { name: 'Anu', area: '', language: 'en' }), '✅ You are verified, Anu.\nKeep the Pulso app notifications ON. Duty offers near you will come in the app.');
});

test('UAE help texts carry no India office line or Kochi address (27 Oct 2026)', () => {
  for (const id of ['uae_english', 'uae_malayalam']) {
    const M = FLOWS[id].MESSAGES;
    assert.doesNotMatch(M.postOnboardingContactSupport, /8714105333/);
    assert.match(M.postOnboardingContactSupport, /77361 29809/);
    assert.doesNotMatch(M.postOnboardingLinks, /Kochi|Ambeel/);
  }
});
