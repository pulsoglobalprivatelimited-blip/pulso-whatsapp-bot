'use strict';
// The "No certificate" route, 27 Sep 2026. "None of these" was the one row in
// the qualification list that refused the person it was shown to; it is gone,
// and someone with no certificate now walks the ordinary path, reads the Basic
// rate band, is never asked for a document, and is told a call is coming.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';

const flow = require('../src/flow');
const ML = flow.FLOWS.kerala_malayalam;
const EN = flow.FLOWS.kerala_english;
const { parseQualification } = require('../src/services/messageParser');
const { tierForQualification, DEFAULTS } = require('../src/services/providerTiersConfig');

const utf16 = (s) => Buffer.from(String(s), 'utf16le').length / 2;

// ---- the row ---------------------------------------------------------------

test('"None of these" is gone from both lists and "No certificate" ends them', () => {
  for (const list of [ML.QUALIFICATIONS, EN.QUALIFICATIONS]) {
    const ids = list.map((r) => r.id);
    assert.ok(!ids.includes('qualification_none_of_these'), 'none_of_these must not be offered');
    assert.equal(ids[ids.length - 1], flow.BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE);
  }
  assert.equal(flow.BUTTON_IDS.QUALIFICATION_NONE_OF_THESE, undefined);
  assert.equal(flow.BUTTON_IDS.QUALIFICATION_GO_BACK, undefined, 'go-back only existed for the refusal');
});

test("the row carries the founder's words and fits WhatsApp's list limits", () => {
  const ml = ML.QUALIFICATIONS[ML.QUALIFICATIONS.length - 1];
  const en = EN.QUALIFICATIONS[EN.QUALIFICATIONS.length - 1];
  assert.equal(ml.title, 'സർട്ടിഫിക്കറ്റ് ഇല്ല');
  assert.equal(ml.description, 'caregiver ജോലി ചെയ്യാൻ താൽപര്യമുണ്ട്');
  assert.equal(en.title, 'No certificate');
  assert.equal(en.description, 'Interested in caregiving work');
  for (const row of [...ML.QUALIFICATIONS, ...EN.QUALIFICATIONS]) {
    assert.ok(utf16(row.title) <= 24, `title too long: ${row.title}`);
    if (row.description) assert.ok(utf16(row.description) <= 72, `description too long: ${row.description}`);
  }
});

test('the refusal and its go-back are gone from every message set', () => {
  for (const messages of [ML.MESSAGES, EN.MESSAGES]) {
    assert.equal(messages.qualificationCertificateRequired, undefined);
    assert.equal(messages.qualificationGoBack, undefined);
  }
});

// ---- reading the answer -----------------------------------------------------

const tap = (id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'x' } } });
const typed = (body) => ({ type: 'text', text: { body } });

test('tapping the row, or typing its words in either script, is "no_certificate"', () => {
  assert.equal(parseQualification(tap(flow.BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE)), 'no_certificate');
  for (const words of ['No certificate', 'no cert', 'certificate illa', 'സർട്ടിഫിക്കറ്റ് ഇല്ല', 'Certificate ഇല്ല']) {
    assert.equal(parseQualification(typed(words)), 'no_certificate', words);
  }
});

test('someone who types what the list used to say lands on the same row', () => {
  for (const words of ['ഇവയൊന്നുമല്ല', 'none of these', 'ivayonnumalla']) {
    assert.equal(parseQualification(typed(words)), 'no_certificate', words);
  }
});

test('the other qualifications still read as before', () => {
  assert.equal(parseQualification(typed('GDA')), 'gda');
  assert.equal(parseQualification(typed('I have experience in caregiving')), 'other_caregiving');
  assert.equal(parseQualification(typed('hello')), null);
});

// ---- the typed-answer messages ---------------------------------------------

test('a typed answer the reader cannot place is told about the new row, not refused', () => {
  assert.match(ML.MESSAGES.notEligible, /"സർട്ടിഫിക്കറ്റ് ഇല്ല"/);
  assert.match(ML.MESSAGES.qualificationRetry, /സർട്ടിഫിക്കറ്റ് ഇല്ല\.$/);
  assert.match(EN.MESSAGES.notEligible, /"No certificate"/);
  assert.match(EN.MESSAGES.qualificationRetry, /No certificate\.$/);
  assert.doesNotMatch(ML.MESSAGES.notEligible, /മാത്രമാണ്/, 'no longer says "only these are onboarded"');
  assert.doesNotMatch(EN.MESSAGES.notEligible, /only/i);
});

// ---- the waiting message ---------------------------------------------------

test('she has her own waiting message, and it does not mention a certificate being sent', () => {
  assert.match(ML.MESSAGES.verificationPendingNoCertificate, /ഫോൺ സംഭാഷണത്തിനു ശേഷം/);
  assert.match(EN.MESSAGES.verificationPendingNoCertificate, /call you for a short talk/);
  assert.doesNotMatch(EN.MESSAGES.verificationPendingNoCertificate, /certificate has been sent/);
});

// ---- the pay bands ----------------------------------------------------------

const LIVE = { basic: { payout24h: 750, payout8h: 600 }, gda: { payout24h: 1000, payout8h: 900 }, nurse: { payout24h: 1800, payout8h: 1500 } };

test('no_certificate and basic_caregiver are the Basic band; other_caregiving is not', () => {
  assert.equal(flow.rateBandFor('no_certificate'), 'basic');
  assert.equal(flow.rateBandFor('basic_caregiver'), 'basic');
  assert.equal(flow.rateBandFor('other_caregiving'), 'gda');
  assert.equal(flow.rateBandFor('gda'), 'gda');
  assert.equal(flow.rateBandFor('gnm'), 'nurse');
});

test('the working model quotes Basic flat, GDA as a range, in both languages', async () => {
  await flow.runWithFlow('kerala_malayalam', async () => {
    const basic = flow.getWorkingModelFor('no_certificate', LIVE);
    assert.match(basic, /8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹600 ലഭിക്കും/);
    assert.match(basic, /24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹750 ലഭിക്കും/);
    assert.doesNotMatch(basic, /₹900|₹1200|₹1000/, 'a Basic caregiver must never read a GDA figure');
    const gda = flow.getWorkingModelFor('gda', LIVE);
    assert.match(gda, /₹600 മുതൽ ₹900 വരെ/);
    assert.match(gda, /₹750 മുതൽ ₹1000 വരെ/);
    assert.doesNotMatch(gda, /₹1200 വരെ ലഭിക്കും/, 'the ₹1,200 over-promise is gone');
    const nurse = flow.getWorkingModelFor('gnm', LIVE);
    assert.match(nurse, /₹900 മുതൽ ₹1200 വരെ/);
    assert.match(nurse, /₹1200 മുതൽ ₹2200 വരെ/);
  });
  await flow.runWithFlow('kerala_english', async () => {
    const basic = flow.getWorkingModelFor('basic_caregiver', LIVE);
    assert.match(basic, /For 8-hour duty, you will receive Rs 600 per day/);
    assert.match(basic, /For 24-hour duty, you will receive Rs 750 per day/);
    assert.match(flow.getWorkingModelFor('hca', LIVE), /Rs 600 to Rs 900 per day[\s\S]*Rs 750 to Rs 1000 per day/);
    assert.match(flow.getWorkingModelFor('bsc_nursing', LIVE), /Rs 900 to Rs 1200 per day/);
  });
});

test('the figures come from the tier settings, with the live matrix as fallback', async () => {
  await flow.runWithFlow('kerala_english', async () => {
    const repriced = flow.getWorkingModelFor('no_certificate', { basic: { payout8h: 650, payout24h: 800 } });
    assert.match(repriced, /Rs 650 per day[\s\S]*Rs 800 per day/);
    const fallback = flow.getWorkingModelFor('gda', null);
    assert.match(fallback, /Rs 600 to Rs 900 per day[\s\S]*Rs 750 to Rs 1000 per day/);
  });
});

test('the duty-hours summary follows the same bands', async () => {
  await flow.runWithFlow('kerala_malayalam', async () => {
    assert.equal(flow.getDutyHourPaymentSummaryFor('no_certificate', LIVE), '8 hour - ദിവസത്തിൽ ₹600\n24 hour - ദിവസത്തിൽ ₹750');
    assert.equal(flow.getDutyHourPaymentSummaryFor('gda', LIVE), '8 hour - ദിവസത്തിൽ ₹600 മുതൽ ₹900 വരെ\n24 hour - ദിവസത്തിൽ ₹750 മുതൽ ₹1000 വരെ');
    assert.equal(flow.getDutyHourPaymentSummaryFor('gnm', LIVE), ML.MESSAGES.dutyHourPaymentSummaryNurse);
  });
  await flow.runWithFlow('kerala_english', async () => {
    assert.equal(flow.getDutyHourPaymentSummaryFor('basic_caregiver', LIVE), '8 hour - Rs 600 per day\n24 hour - Rs 750 per day');
    assert.equal(flow.getDutyHourPaymentSummaryFor('anm', LIVE), '8 hour - Rs 600 to Rs 900 per day\n24 hour - Rs 750 to Rs 1000 per day');
  });
});

// ---- the tier the record lands in -----------------------------------------------

test('no_certificate is the Basic tier; the fallback GDA pay matches live', () => {
  assert.equal(tierForQualification('no_certificate'), 'basic');
  assert.equal(tierForQualification('basic_caregiver'), 'basic');
  assert.equal(tierForQualification('other_caregiving'), 'gda');
  assert.equal(DEFAULTS.gda.payout24h, 1000);
});
