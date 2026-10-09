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

// The founder's 29 Sep 2026 matrix. Every band moved; nurse is a flat
// figure rather than the hand-written ₹900-₹2200 range it used to carry.
const LIVE = { basic: { payout24h: 600, payout8h: 500 }, gda: { payout24h: 700, payout8h: 600 }, nurse: { payout24h: 1400, payout8h: 1200 } };

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
    assert.match(basic, /8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹650 ലഭിക്കും/);
    assert.match(basic, /24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹750 ലഭിക്കും/);
    // ₹600 is Basic's own 24-hour rate *and* GDA's 8-hour rate after the
    // 28 Sep 2026 reprice, so the bands no longer separate by figure alone.
    // What still separates them is shape: Basic is quoted flat, GDA as a
    // range. Both halves are asserted, because either alone would pass on
    // a message that quoted the wrong band.
    assert.doesNotMatch(basic, /₹700|₹1200|₹1400/, 'a Basic caregiver must never read a GDA or nurse figure');
    assert.doesNotMatch(basic, /ദിവസത്തിൽ ₹\d+ മുതൽ/, 'Basic is a flat rate, never a range');
    const gda = flow.getWorkingModelFor('gda', LIVE);
    // The band is quoted the range agencies really pay, not the ₹700 floor.
    assert.match(gda, /₹800 മുതൽ ₹900 വരെ/);
    assert.match(gda, /₹900 മുതൽ ₹1200 വരെ/);
    assert.doesNotMatch(gda, /₹600 മുതൽ ₹700 വരെ/, 'the floor is not the wage');
    const nurse = flow.getWorkingModelFor('gnm', LIVE);
    assert.match(nurse, /₹1200 ലഭിക്കും/);
    assert.match(nurse, /₹1400 ലഭിക്കും/);
    assert.doesNotMatch(nurse, /₹2200/, 'the old hand-written nurse range is gone');
  });
  await flow.runWithFlow('kerala_english', async () => {
    const basic = flow.getWorkingModelFor('basic_caregiver', LIVE);
    assert.match(basic, /For 8-hour duty, you will receive Rs 650 per day/);
    assert.match(basic, /For 24-hour duty, you will receive Rs 750 per day/);
    assert.match(flow.getWorkingModelFor('hca', LIVE), /Rs 800 to Rs 900 per day[\s\S]*Rs 900 to Rs 1200 per day/);
    assert.match(flow.getWorkingModelFor('bsc_nursing', LIVE), /Rs 1200 per day[\s\S]*Rs 1400 per day/);
  });
});

test('the figures come from the tier settings, with the live matrix as fallback', async () => {
  await flow.runWithFlow('kerala_english', async () => {
    // Basic is told ₹650/₹750 (founder, 3 Oct 2026) whatever the payout floor
    // says; the told figures are overridable on their own.
    const floorMoved = flow.getWorkingModelFor('no_certificate', { basic: { payout8h: 550, payout24h: 650 } });
    assert.match(floorMoved, /Rs 650 per day[\s\S]*Rs 750 per day/);
    const repriced = flow.getWorkingModelFor('no_certificate', { basic: { payout8h: 500, payout24h: 600, shown8h: 700, shown24h: 800 } });
    assert.match(repriced, /Rs 700 per day[\s\S]*Rs 800 per day/);
    const fallback = flow.getWorkingModelFor('gda', null);
    assert.match(fallback, /Rs 800 to Rs 900 per day[\s\S]*Rs 900 to Rs 1200 per day/);
    // Each shown figure is overridable on its own, like every other rate.
    const wider = flow.getWorkingModelFor('gda', { gda: { shownTo24h: 1500 } });
    assert.match(wider, /Rs 900 to Rs 1500 per day/);
  });
});

test('the duty-hours summary follows the same bands', async () => {
  // Every band's block ends with the same growth line (9 Oct 2026): the figure
  // is a starting point, more days and good ratings can lift it.
  const ML_TAIL = '\n\nPulso-യിൽ കൂടുതൽ ദിവസങ്ങൾ duty ചെയ്യുകയും നല്ല rating നേടുകയും ചെയ്താൽ, പിന്നീട് വേതനം കൂടാൻ അവസരമുണ്ട്.';
  const EN_TAIL = '\n\nWith more days of duty and good ratings on Pulso, you may be offered higher pay later.';
  await flow.runWithFlow('kerala_malayalam', async () => {
    assert.equal(flow.getDutyHourPaymentSummaryFor('no_certificate', LIVE), '8 hour - ദിവസത്തിൽ ₹650\n24 hour - ദിവസത്തിൽ ₹750' + ML_TAIL);
    assert.equal(flow.getDutyHourPaymentSummaryFor('gda', LIVE), '8 hour - ദിവസത്തിൽ ₹800 മുതൽ ₹900 വരെ\n24 hour - ദിവസത്തിൽ ₹900 മുതൽ ₹1200 വരെ' + ML_TAIL);
    assert.equal(flow.getDutyHourPaymentSummaryFor('gnm', LIVE), '8 hour - ദിവസത്തിൽ ₹1200\n24 hour - ദിവസത്തിൽ ₹1400' + ML_TAIL);
  });
  await flow.runWithFlow('kerala_english', async () => {
    assert.equal(flow.getDutyHourPaymentSummaryFor('basic_caregiver', LIVE), '8 hour - Rs 650 per day\n24 hour - Rs 750 per day' + EN_TAIL);
    assert.equal(flow.getDutyHourPaymentSummaryFor('anm', LIVE), '8 hour - Rs 800 to Rs 900 per day\n24 hour - Rs 900 to Rs 1200 per day' + EN_TAIL);
  });
});

test('the growth line sits beside the money in the working model too, for every band', async () => {
  await flow.runWithFlow('kerala_malayalam', async () => {
    for (const q of ['no_certificate', 'gda', 'gnm']) {
      const text = flow.getWorkingModelFor(q, LIVE);
      const line8 = text.split('\n').find((l) => l.startsWith('8. '));
      assert.match(line8, /വേതനം കൂടാൻ അവസരമുണ്ട്/, `${q}: on line 8, next to the 24-hour figure`);
      assert.match(text, /\n9\. Payment daily/, `${q}: the founder's numbering after it is untouched`);
    }
  });
  await flow.runWithFlow('kerala_english', async () => {
    assert.match(flow.getWorkingModelFor('hca', LIVE), /per day\. With more days of duty and good ratings on Pulso/);
  });
});

test('the sample duty offer is priced for the band reading it', async () => {
  /* The sample quoted ₹1200 a day to everyone — the GDA rate retired on
     26 Sep 2026 — while the pay summary sent moments earlier told a Basic
     caregiver ₹750. She was promised ₹36,000 a month against a real ₹22,500.
     The month is derived from the rate here, because ₹36000 was typed once
     and survived two repricings. */
  await flow.runWithFlow('kerala_malayalam', async () => {
    const basic = flow.getSampleDutyOfferFor('no_certificate', LIVE, '24_hour');
    assert.match(basic, /₹ 750 per day × 30 days/);
    assert.match(basic, /₹ 22500 total/, 'the total is the rate × 30, not a written figure');

    const gda = flow.getSampleDutyOfferFor('gda', LIVE, '24_hour');
    // The sample sits inside the quoted range, below its top, and its month
    // total is the ₹30,000 the recruitment poster promises.
    assert.match(gda, /₹ 1000 per day × 30 days/);
    assert.match(gda, /₹ 30000 total/);

    const nurse = flow.getSampleDutyOfferFor('gnm', LIVE, '24_hour');
    assert.match(nurse, /₹ 1400 per day × 30 days/);
    assert.match(nurse, /₹ 42000 total/);

    // The figure the bug was made of must not reach anyone: ₹1,200 a day is
    // the top of the GDA range now, but the SAMPLE must never quote it, and
    // ₹36,000 must never appear at all.
    for (const text of [basic, gda, nurse]) assert.doesNotMatch(text, /36000/);
    for (const text of [basic, gda]) assert.doesNotMatch(text, /1200/);

    assert.match(flow.getSampleDutyOfferFor('gda', LIVE, '8_hour'), /₹800 per day/);
    assert.match(flow.getSampleDutyOfferFor('no_certificate', LIVE, '8_hour'), /₹650 per day/);
    assert.match(flow.getSampleDutyOfferFor('gnm', LIVE, '8_hour'), /₹1200 per day/);
    assert.equal(flow.getSampleDutyOfferFor('gda', LIVE, 'both'), null, '"both" is sent as two messages, not one');
  });
});

test('an unreadable tier config still quotes a real rate, never ₹0', async () => {
  // A message quoting ₹0 a day is worse than no message, because she accepts
  // against it. tierFigures substitutes the shipped matrix for anything zero
  // or unparseable, so the sample falls back rather than going out blank.
  await flow.runWithFlow('kerala_malayalam', async () => {
    const broken = flow.getSampleDutyOfferFor('gda', { gda: { sample24h: 0, sample8h: 'abc' } }, '24_hour');
    assert.match(broken, /₹ 1000 per day/, 'falls back to the shipped GDA sample figure');
    assert.doesNotMatch(broken, /₹ ?0 |₹ ?0$|NaN/);
    assert.match(flow.getSampleDutyOfferFor('gnm', null, '24_hour'), /₹ 1400 per day/, 'a missing config falls back too');
  });
});

test('age decides the band before the certificate does, and careTier beats both', async () => {
  const T = { ...LIVE, basicTierAgeThreshold: 45 };
  assert.equal(flow.rateBandFor({ qualification: 'gnm', age: 52 }, T), 'basic');
  assert.equal(flow.rateBandFor({ qualification: 'gnm', age: 30 }, T), 'nurse');
  assert.equal(flow.rateBandFor({ qualification: 'gda', age: 48 }, T), 'basic');

  // "above 45" — 45 itself is not above it.
  assert.equal(flow.rateBandFor({ qualification: 'gnm', age: 45 }, T), 'nurse');
  assert.equal(flow.rateBandFor({ qualification: 'gnm', age: 46 }, T), 'basic');

  // No age yet: she is quoted her claim, which is all we know.
  assert.equal(flow.rateBandFor({ qualification: 'gnm' }, T), 'nurse');

  // A stored decision wins over both, so an admin correction sticks.
  assert.equal(flow.rateBandFor({ qualification: 'gnm', age: 30, careTier: 'basic' }, T), 'basic');
  assert.equal(flow.rateBandFor({ qualification: 'no_certificate', careTier: 'gda' }, T), 'gda');

  // The threshold is config, not code.
  assert.equal(flow.rateBandFor({ qualification: 'gnm', age: 48 }, { ...LIVE, basicTierAgeThreshold: 55 }), 'nurse');
});

test('the age notice goes only to someone whose certificate would have earned more', async () => {
  const T = { ...LIVE, basicTierAgeThreshold: 45 };
  await flow.runWithFlow('kerala_english', async () => {
    const nurse = flow.getBasicTierAgeNoticeFor({ qualification: 'gnm', age: 52 }, T);
    assert.match(nurse, /above 45/);
    assert.match(nurse, /8 hours ₹650\/day, 24 hours ₹750\/day/);

    /* She is on the Basic rate because she has no course certificate, not
       because of her age. An age rule would be irrelevant and unkind. */
    assert.equal(flow.getBasicTierAgeNoticeFor({ qualification: 'no_certificate', age: 52 }, T), null);
    assert.equal(flow.getBasicTierAgeNoticeFor({ qualification: 'gnm', age: 30 }, T), null);
    assert.equal(flow.getBasicTierAgeNoticeFor({ qualification: 'gnm' }, T), null);
  });
});

test('a qualified caregiver on the Basic rate is never told she has no certificate', async () => {
  const T = { ...LIVE, basicTierAgeThreshold: 45 };
  await flow.runWithFlow('kerala_english', async () => {
    const nurse = { qualification: 'gnm', age: 52, careTier: 'basic' };

    // Her certificate was verified, so she gets the ordinary approval line.
    assert.match(flow.getCertificateApprovedFor(nurse), /certificate has been verified/);
    assert.doesNotMatch(flow.getCertificateApprovedFor(nurse), /Basic Caregiver/);

    const line = flow.getTermsRateFor(nurse, T);
    assert.match(line, /certificate has been checked and approved/);
    assert.match(line, /above 45/);
    assert.doesNotMatch(line, /no Nursing\/Caregiving course certificate/);
    assert.match(line, /8 hours ₹650\/day, 24 hours ₹750\/day/);

    // And the person who really has no course certificate still gets that sentence.
    const basic = flow.getTermsRateFor({ qualification: 'basic_caregiver' }, T);
    assert.match(basic, /no Nursing\/Caregiving course certificate/);

    // Everyone else gets no rate line at all.
    assert.equal(flow.getTermsRateFor({ qualification: 'gnm', age: 30 }, T), null);

    // The age she reads is the configured one, not a number typed into the copy.
    const at50 = flow.getTermsRateFor({ qualification: 'gda', age: 55 }, { ...LIVE, basicTierAgeThreshold: 50 });
    assert.match(at50, /above 50/);
    assert.doesNotMatch(at50, /45|\{\{/);
  });
});

// ---- the tier the record lands in -----------------------------------------------

test('no_certificate is the Basic tier; the fallback GDA pay matches live', () => {
  assert.equal(tierForQualification('no_certificate'), 'basic');
  assert.equal(tierForQualification('basic_caregiver'), 'basic');
  assert.equal(tierForQualification('other_caregiving'), 'gda');
  assert.equal(DEFAULTS.gda.payout24h, 700);
});

test('a GDA range whose ends meet is said as one figure, never "₹750 മുതൽ ₹750 വരെ"', async () => {
  // The founder dropped the GDA range on 9 Oct 2026 by setting top = bottom
  // in config. The words must follow, in both places the money is shown.
  const FLAT = { ...LIVE, gda: { payout24h: 750, payout8h: 650, shownFrom24h: 750, shownTo24h: 750, shownFrom8h: 650, shownTo8h: 650 } };
  await flow.runWithFlow('kerala_malayalam', async () => {
    const wm = flow.getWorkingModelFor('gda', FLAT);
    assert.match(wm, /7\. 8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹650 ലഭിക്കും/);
    assert.match(wm, /8\. 24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹750 ലഭിക്കും\./);
    assert.doesNotMatch(wm, /മുതൽ ₹750 വരെ|മുതൽ ₹650 വരെ/);
    const block = flow.getDutyHourPaymentSummaryFor('gda', FLAT);
    assert.match(block, /^8 hour - ദിവസത്തിൽ ₹650\n24 hour - ദിവസത്തിൽ ₹750\n/);
    // Setting them apart again brings the range back without a deploy.
    assert.match(flow.getDutyHourPaymentSummaryFor('gda', LIVE), /₹800 മുതൽ ₹900 വരെ/);
  });
  await flow.runWithFlow('kerala_english', async () => {
    assert.match(flow.getWorkingModelFor('hca', FLAT), /Rs 650 per day[\s\S]*Rs 750 per day\. With more days/);
    assert.match(flow.getDutyHourPaymentSummaryFor('anm', FLAT), /^8 hour - Rs 650 per day\n24 hour - Rs 750 per day\n/);
  });
});
