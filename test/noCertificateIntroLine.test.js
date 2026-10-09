'use strict';
// Founder, 9 Oct 2026: keep the "GDA staff and nurses can join" line and add,
// for No certificate applicants only, option B right under it — verbatim.
const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../src/flow');

const TIERS = { basicTierAgeThreshold: 45, basic: { payout8h: 650, payout24h: 750 }, gda: { payout8h: 800, payout24h: 900 }, nurse: { payout8h: 1200, payout24h: 1400 } };
const ML = 'Caregiving / Nursing certificate ഇല്ലാത്തവർക്കും, പ്രായമായവരെ പരിചരിച്ച മുൻപരിചയം ഉണ്ടെങ്കിൽ Basic Caregiver ആയി ഞങ്ങളോടൊപ്പം join ചെയ്യാം. ഒരു ചെറിയ ഫോൺ സംഭാഷണത്തിന് ശേഷം തീരുമാനം അറിയിക്കും. നിങ്ങൾ interested ആണെങ്കിൽ ഞങ്ങൾ നിങ്ങൾക്ക് Pulso App വഴി duty offers അയച്ചു തരും.';
const EN = 'People without a caregiving or nursing certificate can also join us as Basic Caregivers if they have experience caring for the elderly. We will decide after a short phone call. If you are interested, we will send you duty offers through the Pulso App.';
const GDA_ML = 'GDA (General Duty Assistant) staff-നും nurse-നും ഞങ്ങളോടൊപ്പം join ചെയ്യാൻ കഴിയും.';

test('Malayalam: No certificate keeps the GDA line and gets the new paragraph right under it', () => {
  flow.runWithFlow('kerala_malayalam', () => {
    const text = flow.getWorkingModelFor({ qualification: 'no_certificate', age: 35 }, TIERS);
    const gda = text.indexOf(GDA_ML);
    const added = text.indexOf(ML);
    const details = text.indexOf('**Duty details:**');
    assert.ok(gda > 0 && added > gda && details > added, 'order: GDA line, new line, Duty details');
    assert.equal(text.split(ML).length - 1, 1, 'once');
    assert.match(text.slice(gda, details), /തരും\.\n\nCaregiving \/ Nursing/);
  });
});

test('English: same paragraph for No certificate', () => {
  flow.runWithFlow('kerala_english', () => {
    const text = flow.getWorkingModelFor({ qualification: 'no_certificate', age: 35 }, TIERS);
    assert.ok(text.includes('GDA staff, caregivers, and nurses can join Pulso.'));
    assert.ok(text.indexOf(EN) > text.indexOf('GDA staff, caregivers, and nurses can join Pulso.'));
    assert.ok(text.indexOf(EN) < text.indexOf('Duty details:'));
  });
});

test('everyone else reads the intro exactly as before', () => {
  for (const q of ['gda', 'gnm', 'hca', 'nursing_student', 'basic_caregiver', 'other_caregiving']) {
    flow.runWithFlow('kerala_malayalam', () => {
      assert.ok(!flow.getWorkingModelFor({ qualification: q, age: 30 }, TIERS).includes(ML), q);
    });
    flow.runWithFlow('kerala_english', () => {
      assert.ok(!flow.getWorkingModelFor({ qualification: q, age: 30 }, TIERS).includes(EN), q);
    });
  }
});
