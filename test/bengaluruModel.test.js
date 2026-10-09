'use strict';
// Bengaluru (Oct 2026): a caregiver who picks Karnataka reads the agency
// working model — the agency fixes the rate and pays her directly, Pulso holds
// no money — while a Kerala caregiver reads exactly what she read before.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';

const flow = require('../src/flow');
const { DEFAULTS } = require('../src/services/providerTiersConfig');

const KA_EN = flow.FLOWS.karnataka_english;
const KA_ML = flow.FLOWS.karnataka_malayalam;
const KL_EN = flow.FLOWS.kerala_english;
const KL_ML = flow.FLOWS.kerala_malayalam;

test('Bengaluru English: the agency pays directly, the rate is on the offer, no daily credit by Pulso', () => {
  const wm = KA_EN.MESSAGES.workingModel;
  assert.match(wm, /Duty location can be anywhere in Bengaluru/);
  assert.match(wm, /The agency fixes the rate for each duty\. The rate is on every offer\. You get the full amount/);
  assert.match(wm, /The agency pays you directly, by cash or UPI\. Fix the payment day with the agency before you start/);
  assert.match(wm, /4-digit PIN/);
  assert.match(wm, /Check in every day from the app with a selfie$/m);
  assert.doesNotMatch(wm, /uniform/i);
  assert.doesNotMatch(wm, /credited daily/);
  assert.doesNotMatch(wm, /office team will call you/);
  // the range lines stay, because the band substitution keys on them
  assert.match(wm, /For 8-hour duty, you will receive Rs 600 to Rs 900 per day/);
  assert.match(wm, /For 24-hour duty, you will receive Rs 750 to Rs 1000 per day/);
});

test('Bengaluru English terms: no uniform kit, nothing deducted, agency pays on the agreed day', () => {
  const t = KA_EN.MESSAGES.termsIntro;
  assert.doesNotMatch(t, /uniform|Rs 1999|deduct/i);
  assert.match(t, /^Before joining Pulso[\s\S]*\n1\. Please note:/);
  assert.match(t, /\n2\. We will share available duty offers/);
  assert.match(t, /the agency pays you for the days you work, directly, by cash or UPI, on the day you and the agency agree/);
  assert.match(t, /Pulso does not collect or hold your pay/);
  assert.doesNotMatch(t, /Payment for completed work will be given daily/);
  assert.match(t, /may be blocked from accepting future duty offers/);
});

test('Bengaluru English samples: booked by an agency, agency verified, agency pays', () => {
  for (const key of ['sampleDutyOffer24Hour', 'sampleDutyOffer8Hour']) {
    const s = KA_EN.MESSAGES[key];
    assert.match(s, /^Booked by: Sahaya Home Care \(home-care agency\)/);
    assert.match(s, /Location: Jayanagar, Bengaluru/);
    assert.match(s, /fixed by the agency/);
    assert.match(s, /The agency pays you directly/);
    assert.match(s, /Agency verified by Pulso/);
    assert.doesNotMatch(s, /Family verified|Payment guaranteed/);
  }
  assert.match(KA_EN.MESSAGES.sampleDutyOffer24Hour, /\{\{payout24h\}\}.*\n.*\{\{total24h\}\}/);
  assert.match(KA_EN.MESSAGES.sampleDutyOffer8Hour, /\{\{payout8h\}\}/);
});

test('Bengaluru Malayalam: the same four texts carry the agency model; the rest is the Kerala Malayalam set', () => {
  const wm = KA_ML.MESSAGES.workingModel;
  assert.match(wm, /Duty area Bengaluru-വിൽ എവിടെയും ആയിരിക്കാം/);
  assert.match(wm, /Agency നേരിട്ട് നിങ്ങൾക്ക് payment നൽകും/);
  assert.match(wm, /4-digit PIN/);
  assert.doesNotMatch(wm, /Payment daily നിങ്ങളുടെ account/);
  assert.match(wm, /8 മണിക്കൂർ ഡ്യൂട്ടിക്ക് ദിവസത്തിൽ ₹600 മുതൽ ₹900 വരെ ലഭിക്കും/);
  assert.doesNotMatch(KA_ML.MESSAGES.termsIntro, /യൂണിഫോം|₹1999|₹500 വീതവും/);
  assert.doesNotMatch(wm, /uniform/i);
  for (const key of ['sampleDutyOffer24Hour', 'sampleDutyOffer8Hour']) {
    const s = KA_ML.MESSAGES[key];
    assert.match(s, /^Booked by: Sahaya Home Care/);
    assert.match(s, /Jayanagar, Bengaluru/);
    assert.match(s, /Agency verified by Pulso/);
    assert.doesNotMatch(s, /Family verified|Payment guaranteed/);
  }
  assert.equal(KA_ML.MESSAGES.certificateRequest, KL_ML.MESSAGES.certificateRequest, 'everything else is the Kerala Malayalam text');
});

test('Kerala, both languages, reads exactly what it read before', () => {
  assert.match(KL_EN.MESSAGES.workingModel, /Duty location can be anywhere in Kerala/);
  assert.match(KL_EN.MESSAGES.workingModel, /Payment will be credited daily to your account/);
  assert.match(KL_EN.MESSAGES.workingModel, /the office team will call you for verification/);
  assert.match(KL_EN.MESSAGES.termsIntro, /deduction from your first 4 days of duty payment/);
  assert.match(KL_EN.MESSAGES.termsIntro, /uniform kit worth Rs 1999/);
  assert.match(KL_EN.MESSAGES.sampleDutyOffer24Hour, /Location: Vennala, Ernakulam/);
  assert.match(KL_EN.MESSAGES.sampleDutyOffer24Hour, /Family verified/);
  assert.match(KL_ML.MESSAGES.workingModel, /Duty area കേരളത്തിൽ എവിടെയും ആയിരിക്കാം/);
  assert.match(KL_ML.MESSAGES.workingModel, /Payment daily നിങ്ങളുടെ account-ിൽ credit ആവുന്നതാണ്/);
  assert.match(KL_ML.MESSAGES.termsIntro, /₹500 വീതവും/);
  assert.doesNotMatch(KL_ML.MESSAGES.sampleDutyOffer24Hour, /Booked by/);
});

test('the per-band rate lines still swap into the Bengaluru working model, both languages', () => {
  const tiers = { tiers: DEFAULTS };
  for (const id of ['karnataka_english', 'karnataka_malayalam']) {
    for (const q of ['gda', 'gnm', 'no_certificate']) {
      const text = flow.runWithFlow(id, () => flow.getWorkingModelFor(q, tiers));
      assert.ok(text && text.length > 500, `${id}/${q} produced a working model`);
      assert.doesNotMatch(text, /Rs 600 to Rs 900 per day|₹600 മുതൽ ₹900 വരെ/, `${id}/${q}: the marker line was replaced`);
    }
  }
});
