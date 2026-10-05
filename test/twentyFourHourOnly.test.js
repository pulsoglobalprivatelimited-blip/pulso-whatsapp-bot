'use strict';
// 24-hour only (founder, 5 Oct 2026): the onboarding chat never mentions
// 8-hour duty again. One message with one button where the three-way question
// was, the 24-hour pay line and sample only, and the working model and Basic
// closing messages carry only 24-hour lines. Saved answer: '24_hour'.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.WHATSAPP_DRY_RUN = 'true';
process.env.OWNER_NOTIFICATION_PHONE = '919446600809';
process.env.AGENT_HELP_WHATSAPP_NUMBER = '919446600809';
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';

// ---- fakes: no Firestore, no WhatsApp ---------------------------------------
const sent = [];
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
stub('metaClient', {
  sendText: async (to, body) => { sent.push({ to, kind: 'text', body }); return { messages: [{ id: 'w' }] }; },
  sendButtons: async (to, body, buttons) => { sent.push({ to, kind: 'buttons', body, buttons }); return { messages: [{ id: 'w' }] }; },
  sendList: async (to, body, list) => { sent.push({ to, kind: 'list', body, list }); return { messages: [{ id: 'w' }] }; },
  sendTemplate: async (to, name, lang, components) => { sent.push({ to, kind: 'template', name, components }); return { messages: [{ id: 'w' }] }; },
  isAppMediaId: () => false
});
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => records.get(phone) || null,
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone), patch)); return records.get(phone); },
  appendHistory: async () => null,
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()]
});
// The live matrix as the founder set it on 4 Oct 2026.
const TIERS = {
  basicTierAgeThreshold: 45,
  basic: { payout24h: 750, payout8h: 650 },
  gda: { payout24h: 900, payout8h: 800 },
  nurse: { payout24h: 1400, payout8h: 1200 }
};
stub('providerTiersConfig', { getProviderTiers: async () => TIERS });

const onboarding = require('../src/services/onboardingFlow');
const flow = require('../src/flow');
const { STATUS, BUTTON_IDS } = flow;

const EIGHT_HOUR = /8[ -]hours?\b|8 മണിക്കൂർ|8:00 AM|8 am to|payout8h|രണ്ടും|\bBoth\b/i;
const tap = (id) => ({ type: 'interactive', interactive: { button_reply: { id } } });
const text = (body) => ({ id: 'm', type: 'text', text: { body } });
const toWho = (who) => sent.filter((m) => m.to === who);
const everyString = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => everyString(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => everyString(v, out));
  return out;
};

test('no message, button title or sample in any flow mentions 8-hour duty', () => {
  for (const id of Object.keys(flow.FLOWS)) {
    const cfg = flow.getFlowConfig(id);
    for (const s of everyString([cfg.MESSAGES, cfg.UI_TEXT])) {
      assert.doesNotMatch(s, EIGHT_HOUR, `${id}: ${s.slice(0, 80)}`);
    }
    assert.equal(cfg.MESSAGES.sampleDutyOffer8Hour, undefined, `${id} still carries the 8-hour sample`);
    assert.equal(cfg.MESSAGES.dutyHourPreference8HourNotice, undefined);
    assert.equal(cfg.MESSAGES.sampleDutyFinalChoiceQuestion, undefined);
    assert.equal(cfg.UI_TEXT.dutyBothTitle, undefined);
  }
});

test('the working model and the Basic closing lines carry the 24-hour figure only, every band, both languages', async () => {
  for (const flowId of ['kerala_malayalam', 'karnataka_english']) {
    await flow.runWithFlow(flowId, async () => {
      for (const q of ['no_certificate', 'gda', 'gnm']) {
        const wm = flow.getWorkingModelFor(q, TIERS);
        assert.doesNotMatch(wm, EIGHT_HOUR, `${flowId}/${q} working model`);
        assert.match(wm, /24/);
        const summary = flow.getDutyHourPaymentSummaryFor(q, TIERS);
        assert.doesNotMatch(summary, EIGHT_HOUR);
        assert.doesNotMatch(summary, /\n/, 'one line, not two');
        assert.match(summary, /^24 hour - /);
      }
      // Duty details went from 11 lines to 8: the 8-hour timing, no-stay and pay
      // lines are gone and the list is renumbered.
      const wm = flow.getWorkingModelFor('gda', TIERS);
      assert.match(wm, /\n8\. /);
      assert.doesNotMatch(wm, /\n9\. /);
      for (const subject of [{ qualification: 'basic_caregiver' }, { qualification: 'gnm', age: 52, careTier: 'basic' }]) {
        const line = flow.getTermsRateFor(subject, TIERS);
        assert.match(line, /24/);
        assert.doesNotMatch(line, EIGHT_HOUR);
      }
      const notice = flow.getBasicTierAgeNoticeFor({ qualification: 'gnm', age: 52 }, TIERS);
      assert.match(notice, /₹750/);
      assert.doesNotMatch(notice, EIGHT_HOUR);
    });
  }
});

test('the Basic rate line needs only the 24-hour figure to be configured', async () => {
  await flow.runWithFlow('kerala_english', async () => {
    const line = flow.getTermsRateFor({ qualification: 'basic_caregiver' }, { basic: { payout24h: 750 } });
    assert.match(line, /24 hours ₹750\/day/);
    assert.throws(() => flow.getTermsRateFor({ qualification: 'basic_caregiver' }, { basic: { payout8h: 650 } }), /not configured/);
  });
});

test('after "interested": one message, one button, the 24-hour pay line, then the sample question', async () => {
  sent.length = 0;
  const phone = '919000000601';
  records.set(phone, { phone, qualification: 'no_certificate', status: STATUS.AWAITING_INTEREST, currentStep: 4, flowId: 'kerala_malayalam' });

  await onboarding.processIncomingMessage(phone, tap(BUTTON_IDS.INTEREST_YES));
  const mine = toWho(phone);
  const buttons = mine.find((m) => m.kind === 'buttons');
  assert.ok(buttons, 'the duty-hours message went out');
  assert.equal(buttons.body, 'Duty hours: 24 hour. Patient-ന്റെ വീട്ടിൽ stay ചെയ്യണം. Stay-യും food-ും ലഭിക്കും.');
  assert.deepEqual(buttons.buttons, [{ id: BUTTON_IDS.DUTY_HOUR_24, title: '24 hour' }]);
  const pay = mine.find((m) => m.kind === 'text');
  assert.equal(pay.body, '24 hour - ദിവസത്തിൽ ₹750');
  assert.equal(records.get(phone).status, STATUS.AWAITING_DUTY_HOUR_PREFERENCE);

  sent.length = 0;
  await onboarding.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_24));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE);
  assert.equal(p.dutyHourPreference, '24_hour');
  const ask = toWho(phone).find((m) => m.kind === 'buttons');
  assert.equal(ask.body, 'ഒരു sample duty offer എങ്ങനെയിരിക്കും എന്ന് കാണണോ?');
  assert.deepEqual(ask.buttons.map((b) => b.title), ['കാണാം', 'വേണ്ട']);

  // Yes: the 24-hour sample at her rate, then straight on to the expected duties.
  sent.length = 0;
  await onboarding.processIncomingMessage(phone, tap(BUTTON_IDS.SAMPLE_DUTY_YES));
  const after = toWho(phone);
  assert.match(after[0].body, /Duty: 24-hour care/);
  assert.match(after[0].body, /₹ 750 per day × 30 days/);
  assert.match(after[0].body, /₹ 22500 total/);
  assert.equal(records.get(phone).status, STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION);
  assert.equal(records.get(phone).dutyHourPreference, '24_hour');
  assert.equal(records.get(phone).sampleDutyState, null);
  const lastButtons = after.filter((m) => m.kind === 'buttons').pop();
  assert.equal(lastButtons.body, 'മുകളിലെ duty responsibilities ചെയ്യാൻ താങ്കൾക്ക് തയ്യാറാണോ?');
  // Nothing sent in the whole exchange mentioned 8-hour duty or offered the other sample.
  for (const m of after) assert.doesNotMatch(m.body, EIGHT_HOUR);
  assert.ok(!after.some((m) => /കാണണോ\?$/.test(m.body) && /24 hour duty/.test(m.body)), 'no "see the other sample?" step');
});

test('an old 8 hour / both tap, or typed text, still moves her on as 24 hour', async () => {
  for (const [i, reply] of [tap(BUTTON_IDS.DUTY_HOUR_8), tap(BUTTON_IDS.DUTY_HOUR_BOTH), text('8 hour'), text('ok')].entries()) {
    sent.length = 0;
    const phone = `91900000061${i}`;
    records.set(phone, { phone, qualification: 'gda', status: STATUS.AWAITING_DUTY_HOUR_PREFERENCE, currentStep: 5, flowId: 'kerala_malayalam' });
    await onboarding.processIncomingMessage(phone, reply);
    assert.equal(records.get(phone).status, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE, `reply ${i}`);
    assert.equal(records.get(phone).dutyHourPreference, '24_hour', `reply ${i}`);
    for (const m of toWho(phone)) assert.doesNotMatch(m.body, EIGHT_HOUR);
  }
});

test('someone left mid-way in the old sample steps is asked the one open question, and "no" skips the sample', async () => {
  sent.length = 0;
  const phone = '919000000620';
  // The old flow stored this after "8 hour" + "see sample": waiting for "see the 24-hour one too?"
  records.set(phone, {
    phone, qualification: 'gda', status: STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE, currentStep: 6, flowId: 'kerala_malayalam',
    dutyHourPreference: '8_hour', sampleDutyState: { stage: 'other_prompt', initialChoice: '8_hour', alternateChoice: '24_hour' }
  });
  await onboarding.processIncomingMessage(phone, tap(BUTTON_IDS.DUTY_HOUR_8));
  const retry = toWho(phone);
  assert.equal(retry[0].body, 'ദയവായി താഴെയുള്ള options-ിൽ നിന്നും ഒരു മറുപടി തിരഞ്ഞെടുക്കുക.');
  assert.equal(retry[1].body, 'ഒരു sample duty offer എങ്ങനെയിരിക്കും എന്ന് കാണണോ?');
  assert.equal(records.get(phone).status, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE);

  sent.length = 0;
  await onboarding.processIncomingMessage(phone, tap(BUTTON_IDS.SAMPLE_DUTY_NO));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION);
  assert.equal(p.dutyHourPreference, '24_hour', 'the old 8-hour answer is replaced');
  assert.equal(p.sampleDutyState, null);
  assert.ok(!toWho(phone).some((m) => /Duty: 24-hour care/.test(m.body)), 'no sample on "no"');
  for (const m of toWho(phone)) assert.doesNotMatch(m.body, EIGHT_HOUR);
});

test('the English flow says the same with one button', async () => {
  sent.length = 0;
  const phone = '919000000630';
  records.set(phone, { phone, qualification: 'gda', status: STATUS.AWAITING_INTEREST, currentStep: 4, flowId: 'karnataka_english' });
  await onboarding.processIncomingMessage(phone, tap(BUTTON_IDS.INTEREST_YES));
  const buttons = toWho(phone).find((m) => m.kind === 'buttons');
  assert.equal(buttons.body, "Duty hours: 24 hour. You stay at the patient's home. Stay and food are given.");
  assert.deepEqual(buttons.buttons.map((b) => b.title), ['24 hour']);
  assert.equal(toWho(phone).find((m) => m.kind === 'text').body, '24 hour - Rs 900 to Rs 1200 per day');
});
