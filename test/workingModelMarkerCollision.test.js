'use strict';
// 10 Oct 2026: the card was set to GDA 24h 750–1000, the exact figures the
// working-model markers carry. The one-pass swap then replaced both points
// with the 8-hour line. Both languages, both regions, must show the 24-hour
// range on point 7 and the 8-hour figure on point 8.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';
const flow = require('../src/flow');
const { normalize } = require('../src/services/providerTiersConfig');

const CARD = normalize({ tiers: {
  basic: { payout24h: 750, payout8h: 650 },
  gda: { payout24h: 750, payout8h: 650, shownFrom24h: 750, shownTo24h: 1000, sample24h: 1000, shownFrom8h: 650, shownTo8h: 650, sample8h: 650 },
  nurse: { payout24h: 1400, payout8h: 1200 },
} });

test('GDA: a 24-hour range equal to the marker figures still lands once, on its own point', () => {
  for (const id of ['karnataka_english', 'kerala_english']) {
    const wm = flow.runWithFlow(id, () => flow.getWorkingModelFor('gda', CARD));
    const p7 = wm.split('\n').find((l) => l.startsWith('7. '));
    const p8 = wm.split('\n').find((l) => l.startsWith('8. '));
    assert.match(p7, /^7\. For 24-hour duty, you will receive Rs 750 to Rs 1000 per day$/, id);
    assert.match(p8, /^8\. For 8-hour duty, you will receive Rs 650 per day\. /, id);
    assert.equal((wm.match(/For 8-hour duty, you will receive/g) || []).length, 1, `${id}: one 8-hour rate line`);
    assert.equal((wm.match(/For 24-hour duty, you will receive/g) || []).length, 1, `${id}: one 24-hour rate line`);
  }
  for (const id of ['karnataka_malayalam', 'kerala_malayalam']) {
    const wm = flow.runWithFlow(id, () => flow.getWorkingModelFor('gda', CARD));
    assert.equal((wm.match(/24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ/g) || []).length, 1, `${id}: one 24-hour rate line`);
    assert.equal((wm.match(/[^0-9]8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ/g) || []).length, 1, `${id}: one 8-hour rate line`);
    assert.match(wm, /24 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹750 മുതൽ ₹1000 വരെ/, id);
  }
});

test('the sample duty for a GDA is ₹1,000 a day, ₹30,000 a month, from the card', () => {
  const s = flow.runWithFlow('karnataka_english', () => flow.getSampleDutyOfferFor('gda', CARD, '24_hour'));
  assert.match(s, /Rs 1000 per day/);
  assert.match(s, /Rs 30000/);
});
