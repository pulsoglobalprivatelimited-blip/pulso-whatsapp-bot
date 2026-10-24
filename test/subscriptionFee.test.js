'use strict';
// ₹500 subscription fee (founder, 22 Oct 2026): who pays, what the terms say,
// the reminders, and the "she paid" call from the hub.
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.SUBSCRIPTION_FEE_ENABLED = 'true';
process.env.SUBSCRIPTION_FEE_START_AT = '2026-11-01T00:00:00Z';
process.env.SUBSCRIPTION_FEE_FIRST_REMINDER_HOURS = '24';
process.env.SUBSCRIPTION_FEE_SECOND_REMINDER_HOURS = '72';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FLOWS } = require('../src/flow');
const fee = require('../src/services/subscriptionFee');

const START = Date.parse('2026-11-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const NOW = START + 10 * DAY;
const kerala = { phone: '919876543210', flowId: 'kerala_malayalam', region: 'kerala', fullName: 'Jisha T A', createdAt: new Date(START + DAY).toISOString() };
const ML = FLOWS.kerala_malayalam.MESSAGES;
const EN = FLOWS.kerala_english.MESSAGES;

test('who pays: new Kerala chats only', () => {
  assert.equal(fee.feeAppliesTo(kerala, NOW), true);
  assert.equal(fee.feeAppliesTo({ ...kerala, createdAt: new Date(START - DAY).toISOString() }, NOW), false, 'started before the start date');
  assert.equal(fee.feeAppliesTo({ ...kerala, flowId: 'karnataka_english', region: 'karnataka' }, NOW), false, 'Bengaluru joins free');
  assert.equal(fee.feeAppliesTo({ ...kerala, createdAt: undefined }, NOW), false, 'no creation date: never charged by accident');
  assert.equal(fee.feeAppliesTo({ ...kerala, createdAt: new Date(START - DAY).toISOString(), subscriptionFee: { required: true, status: 'due' } }, NOW), true, 'a decision already taken stands');
  assert.equal(fee.feeAppliesTo({ ...kerala, subscriptionFee: { exempt: true } }, NOW), false);
  assert.equal(fee.feeAppliesTo(kerala, NOW, { ...fee.settings(), enabled: false }), false, 'switched off');
});

test('the uniform kit is ₹1499 now, deducted over three duty days', () => {
  for (const m of [ML, EN]) {
    assert.ok(!m.termsIntro.includes('1999'), 'no ₹1999 left');
  }
  assert.ok(ML.termsIntro.includes('₹1499 വിലയുള്ള യൂണിഫോം കിറ്റ്'));
  assert.ok(ML.termsIntro.includes('ആദ്യ 3 ദിവസത്തെ ഡ്യൂട്ടി പേയ്മെന്റിൽ നിന്ന് ആദ്യ 2 ദിവസങ്ങളിൽ ദിവസവും ₹500 വീതവും 3-ാം ദിവസം ₹499-ഉം'));
  assert.ok(EN.termsIntro.includes('uniform kit worth Rs 1499'));
  assert.ok(EN.termsIntro.includes('first 3 days of duty payment. Rs 500 will be deducted per day for the first 2 duty days, and Rs 499 will be deducted on the 3rd duty day.'));
});

test('a fee-payer reads the fee and market points first; the old points move down', () => {
  const text = fee.termsIntroFor(kerala, ML, NOW);
  const paragraphs = text.split('\n\n');
  assert.equal(paragraphs[0], ML.termsIntro.split('\n\n')[0]);
  assert.ok(paragraphs[1].startsWith('1. Pulso-യിൽ അംഗമാകുന്നതിനായി ഒറ്റത്തവണ ₹499 (tax included) സബ്സ്ക്രിപ്ഷൻ ഫീസ് അടയ്ക്കണം.'));
  assert.ok(paragraphs[1].includes('ആദ്യത്തെ 7 ദിവസം സൗജന്യ ട്രയൽ'), 'the 7-day trial is in point 1 (founder, 24 Oct 2026)');
  assert.ok(paragraphs[2].startsWith('Pulso ആപ്പിലൂടെ 180 ദിവസത്തെ ജോലി'));
  assert.ok(paragraphs[3].startsWith('2. ഡ്യൂട്ടി ലഭ്യത മാർക്കറ്റ് ആവശ്യകത'));
  assert.ok(paragraphs[3].includes('കേരളത്തിൽ'));
  assert.ok(text.includes('\n\n3. ഡ്യൂട്ടി സ്വീകരിച്ച ശേഷം, ₹1499'));
  assert.ok(text.includes('\n\n4. ദയവായി ശ്രദ്ധിക്കുക'));
  assert.ok(text.includes('\n\n5. അടുത്ത ലഭ്യമായ ഡ്യൂട്ടി'));
  assert.ok(!text.includes('\n\n1. ഡ്യൂട്ടി സ്വീകരിച്ച'));
  // English mirror
  const en = fee.termsIntroFor({ ...kerala, flowId: 'kerala_english' }, EN, NOW);
  assert.ok(en.includes('\n\n1. To become a Pulso member, you pay a one-time subscription fee of ₹499 (tax included).'));
  assert.ok(en.includes('\n\n2. Duty availability depends on market requirements'));
  assert.ok(en.includes('\n\n3. After accepting your first duty, you need to collect a uniform kit worth Rs 1499.'));
  assert.ok(en.includes('\n\n5. We will share available duty offers'));
});

test('everyone else reads the terms exactly as before', () => {
  const old = { ...kerala, createdAt: new Date(START - DAY).toISOString() };
  assert.equal(fee.termsIntroFor(old, ML, NOW), ML.termsIntro);
  const blr = { ...kerala, flowId: 'karnataka_english', region: 'karnataka' };
  const BLR = FLOWS.karnataka_english.MESSAGES;
  assert.equal(fee.termsIntroFor(blr, BLR, NOW), BLR.termsIntro);
  assert.ok(!BLR.termsIntro.includes('uniform'), 'Bengaluru terms still have no kit');
  // Both texts count as "already sent"
  assert.deepEqual(fee.termsIntroVariants(ML), [ML.termsIntro, fee.withFeePoints(ML.termsIntro, ML.termsFeePoints)]);
});

test('the working model drops "no registration fee" for a fee-payer, and says nothing about the fee', () => {
  // Founder, 24 Oct 2026: the fee is told only with the terms, after approval.
  const ml = fee.applyWorkingModelFeeLine(ML.workingModel, kerala, ML, NOW);
  assert.ok(!ml.includes('registration fee ഒന്നും നൽകേണ്ടതില്ല'));
  assert.ok(!ml.includes('499'), 'no fee figure before the terms');
  assert.ok(!ml.includes('സബ്സ്ക്രിപ്ഷൻ'));
  assert.ok(!/\n\n\n|\n\s*\n- *\n/.test(ml), 'no empty line left where the line was');
  assert.ok(ml.includes('- ഇഷ്ടമുള്ള duty-കൾ മാത്രം സ്വീകരിച്ചാൽ മതി\n\n'), 'the list before it ends cleanly');
  const en = fee.applyWorkingModelFeeLine(EN.workingModel, { ...kerala, flowId: 'kerala_english' }, EN, NOW);
  assert.ok(!en.includes('There is no registration fee to join Pulso'));
  assert.ok(!en.includes('499') && !/subscription/i.test(en));
  const old = { ...kerala, createdAt: new Date(START - DAY).toISOString() };
  assert.equal(fee.applyWorkingModelFeeLine(ML.workingModel, old, ML, NOW), ML.workingModel);
});

test('the record written at Accept, and a paid one is never overwritten', () => {
  // Pay-first shape (trial switched off), as before 24 Oct 2026.
  const r = fee.dueRecord(kerala, '2026-11-02T10:00:00.000Z', { ...fee.settings(), trialDays: 0 });
  assert.deepEqual(r, { required: true, status: 'due', amount: 499, dueSince: '2026-11-02T10:00:00.000Z', remindersSent: 0 });
  // With the 7-day trial (the default now): `trial`, no dates until the hub stamps the first sign-in.
  const t = fee.dueRecord(kerala, '2026-11-02T10:00:00.000Z');
  assert.deepEqual(t, { required: true, status: 'trial', amount: 499, trialDays: 7, acceptedAt: '2026-11-02T10:00:00.000Z', trialStartsAt: null, trialEndsAt: null, remindersSent: 0 });
  assert.deepEqual(fee.dueRecord({ ...kerala, subscriptionFee: { ...t, trialStartsAt: 'x' } }), { ...t, trialStartsAt: 'x' }, 'a running trial is kept');
  const paid = { required: true, status: 'paid', amount: 500, paidAt: 'x' };
  assert.deepEqual(fee.dueRecord({ ...kerala, subscriptionFee: paid }), paid);
});

test('reminders on day 1 and day 3, then no more; none once paid', () => {
  const due = { ...kerala, subscriptionFee: { status: 'due', dueSince: new Date(NOW).toISOString(), remindersSent: 0 } };
  assert.equal(fee.isReminderDue(due, NOW + 23 * 3600e3), false);
  assert.equal(fee.isReminderDue(due, NOW + 25 * 3600e3), true);
  const once = { ...due, subscriptionFee: { ...due.subscriptionFee, remindersSent: 1 } };
  assert.equal(fee.isReminderDue(once, NOW + 50 * 3600e3), false);
  assert.equal(fee.isReminderDue(once, NOW + 73 * 3600e3), true);
  const twice = { ...due, subscriptionFee: { ...due.subscriptionFee, remindersSent: 2 } };
  assert.equal(fee.isReminderDue(twice, NOW + 30 * DAY), false);
  const paid = { ...due, subscriptionFee: { ...due.subscriptionFee, status: 'paid' } };
  assert.equal(fee.isReminderDue(paid, NOW + 30 * DAY), false);
});

function fakeDeps(provider) {
  const calls = { texts: [], docs: [], templates: [], updates: [], history: [] };
  let record = provider;
  return {
    calls,
    getProvider: async () => record,
    updateProvider: async (phone, patch) => { record = { ...record, ...patch }; calls.updates.push(patch); },
    appendHistory: async (phone, event) => { calls.history.push(event); },
    sendText: async (to, body) => { calls.texts.push({ to, body }); },
    sendDocumentByUrl: async (to, link, filename) => { calls.docs.push({ to, link, filename }); },
    sendTemplate: async (...args) => { calls.templates.push(args); },
  };
}

test('the hub says she paid: record marked, receipt sent, said once', async () => {
  const deps = fakeDeps({ ...kerala, language: 'ml', subscriptionFee: { required: true, status: 'due', dueSince: 'x', remindersSent: 1 } });
  const r = await fee.markPaid({ phone: '+91 98765 43210', uid: 'u1', paymentId: 'pay_1', receiptNo: 'PS/26-27/000001', receiptUrl: 'https://x/r.pdf', amount: 500, paidAt: '2026-11-03T05:00:00Z' }, deps);
  assert.deepEqual(r, { ok: true, known: true, delivered: 'text' });
  assert.equal(deps.calls.updates[0].subscriptionFee.status, 'paid');
  assert.equal(deps.calls.updates[0].subscriptionFee.remindersSent, 1, 'earlier fields kept');
  assert.equal(deps.calls.texts.length, 1);
  assert.ok(deps.calls.texts[0].body.includes('PS/26-27/000001'));
  assert.ok(deps.calls.texts[0].body.startsWith('നന്ദി! ₹499'));
  assert.equal(deps.calls.docs[0].link, 'https://x/r.pdf');
  assert.equal(deps.calls.history.filter((e) => e.event === 'subscription_fee_paid').length, 1);
  // The webhook and the app confirm the same payment: no second message.
  const again = await fee.markPaid({ phone: '919876543210', paymentId: 'pay_1', receiptNo: 'PS/26-27/000001' }, deps);
  assert.equal(again.repeated, true);
  assert.equal(deps.calls.texts.length, 1);
});

test('a number the bot never met is accepted quietly; bad input is refused', async () => {
  const deps = fakeDeps(null);
  assert.deepEqual(await fee.markPaid({ phone: '919000000001' }, deps), { ok: true, known: false, phone: '919000000001' });
  assert.equal(deps.calls.texts.length, 0);
  assert.throws(() => fee.validatePaid({ phone: '123' }), /phone is required/);
  assert.throws(() => fee.validatePaid({ phone: '919000000001', paidAt: 'yesterday' }), /paidAt/);
});

test('8-hour scarcity warning exists in both languages', () => {
  assert.ok(ML.dutyHourPreference8HourScarceNotice.startsWith('ശ്രദ്ധിക്കുക: 8 hour duty വളരെ കുറവാണ്.'));
  assert.ok(EN.dutyHourPreference8HourScarceNotice.startsWith('Please note: 8-hour duties are very few.'));
  assert.ok(FLOWS.karnataka_english.MESSAGES.dutyHourPreference8HourScarceNotice, 'Bengaluru gets the warning too');
});

test('ops waived the fee: reminders stop, she is not messaged', async () => {
  const deps = fakeDeps({ ...kerala, subscriptionFee: { required: true, status: 'due', dueSince: 'x', remindersSent: 1 } });
  const r = await fee.markPaid({ phone: '919876543210', waived: true, note: 'joined at the office' }, deps);
  assert.deepEqual(r, { ok: true, known: true, waived: true });
  assert.equal(deps.calls.updates[0].subscriptionFee.status, 'waived');
  assert.equal(deps.calls.texts.length, 0);
  assert.equal(fee.isReminderDue({ ...kerala, subscriptionFee: deps.calls.updates[0].subscriptionFee }, Date.now() + 10 * DAY), false);
});

// ---- 7-day free trial (founder, 24 Oct 2026) ----------------------------------
test('trial: the words mention 7 days, in the terms and after Accept, both languages', () => {
  for (const m of [ML, EN]) {
    assert.ok(/7 ദിവസം|7 days/.test(m.termsFeePoints[0]), 'terms point 1');
    assert.ok(/7 ദിവസം|7 days/.test(m.termsAcceptedFee), 'after Accept');
    assert.ok(!/അതിനു ശേഷം ഡ്യൂട്ടി ഓഫറുകൾ ലഭിച്ചു തുടങ്ങും|Duty offers start after that/.test(m.termsAcceptedFee), 'no longer "pay first, then offers"');
    assert.ok(m.subscriptionFeeTrialReminder.includes('{{days}}'));
    assert.ok(m.subscriptionFeeTrialOver.includes('499'));
  }
  assert.ok(ML.termsAcceptedFee.startsWith('നന്ദി. Pulso ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്ത്'));
  assert.equal(fee.trialReminderText({ ...kerala, language: 'ml' }, 2), ML.subscriptionFeeTrialReminder.replace('{{days}}', '2'));
  assert.equal(fee.trialOverText({ ...kerala, flowId: 'kerala_english' }), EN.subscriptionFeeTrialOver);
});

test('trial: the hub stamps the first sign-in; the sweep reminds at 2 days and 1 day left, never at night', async () => {
  const accepted = { ...kerala, subscriptionFee: fee.dueRecord(kerala, new Date(NOW).toISOString()) };
  assert.equal(fee.trialStage(accepted, NOW + 10 * DAY), null, 'no clock before the first sign-in');
  assert.equal(fee.isReminderDue(accepted, NOW + 10 * DAY), false, 'and no pay-first reminders either');
  const deps = fakeDeps(accepted);
  const start = new Date(NOW + 2 * DAY).toISOString();
  const r = await fee.markTrialStarted({ phone: '+91 98765 43210', uid: 'u1', trialStartsAt: start, trialEndsAt: new Date(NOW + 9 * DAY).toISOString() }, deps);
  assert.deepEqual(r, { ok: true, known: true });
  const rec = deps.calls.updates[0].subscriptionFee;
  assert.equal(rec.status, 'trial');
  assert.equal(rec.trialStartsAt, start);
  assert.equal(deps.calls.texts.length, 0, 'nothing sent: the app shows the countdown');
  assert.equal((await fee.markTrialStarted({ phone: '919876543210', trialStartsAt: start }, deps)).repeated, true, 'stamped once');
  const inTrial = { ...kerala, subscriptionFee: rec };
  const t0 = NOW + 2 * DAY;
  // 10:00 IST on each day: 04:30 UTC
  const at = (h) => t0 + h * 3600e3;
  assert.equal(fee.trialStage(inTrial, at(119)), null);
  assert.deepEqual(fee.trialStage(inTrial, at(120)), { kind: 'trial_reminder', index: 0, daysLeft: 2 });
  const once = { ...inTrial, subscriptionFee: { ...rec, remindersSent: 1 } };
  assert.equal(fee.trialStage(once, at(130)), null);
  assert.deepEqual(fee.trialStage(once, at(144)), { kind: 'trial_reminder', index: 1, daysLeft: 1 });
  const twice = { ...inTrial, subscriptionFee: { ...rec, remindersSent: 2 } };
  assert.equal(fee.trialStage(twice, at(167)), null, 'no third reminder');
  assert.equal(fee.trialStage(once, at(169)), null, 'past the end: the lock message covers it');
  // Night-time guard (IST 21:00–07:59): 16:00 UTC is 21:30 IST.
  assert.equal(fee.withinSendHours(Date.UTC(2026, 10, 5, 16, 0)), false);
  assert.equal(fee.withinSendHours(Date.UTC(2026, 10, 5, 4, 30)), true);
  assert.equal(fee.withinSendHours(Date.UTC(2026, 10, 5, 2, 0)), false, '07:30 IST');
});

test('trial: the hub locks her; one "trial over" message; paid/waived never locked; pay-first reminders stay out', async () => {
  const rec = { required: true, status: 'trial', amount: 499, trialDays: 7, trialStartsAt: 'a', trialEndsAt: 'b', remindersSent: 2 };
  const deps = fakeDeps({ ...kerala, subscriptionFee: rec });
  const lockedAt = new Date(NOW + 9 * DAY).toISOString();
  assert.deepEqual(await fee.markLocked({ phone: '919876543210', lockedAt }, deps), { ok: true, known: true });
  const locked = deps.calls.updates[0].subscriptionFee;
  assert.equal(locked.status, 'due');
  assert.equal(locked.lockedAt, lockedAt);
  assert.equal(locked.trialDays, 7);
  assert.deepEqual(fee.trialStage({ ...kerala, subscriptionFee: locked }, NOW + 9 * DAY + 3600e3), { kind: 'trial_over' });
  assert.equal(fee.trialStage({ ...kerala, subscriptionFee: { ...locked, trialOverSentAt: 'x' } }, NOW + 20 * DAY), null, 'said once');
  assert.equal(fee.isReminderDue({ ...kerala, subscriptionFee: locked }, NOW + 20 * DAY), false, 'the old day-1/day-3 texts ("offers start after") never go to a trial record');
  assert.equal((await fee.markLocked({ phone: '919876543210', lockedAt }, deps)).repeated, true);
  const paidDeps = fakeDeps({ ...kerala, subscriptionFee: { ...rec, status: 'paid' } });
  assert.equal((await fee.markLocked({ phone: '919876543210' }, paidDeps)).ignored, 'paid');
  assert.equal(paidDeps.calls.updates.length, 0);
  // She pays after the lock: the usual receipt path, record keeps the trial fields.
  const payDeps = fakeDeps({ ...kerala, language: 'ml', subscriptionFee: locked });
  const paid = await fee.markPaid({ phone: '919876543210', paymentId: 'pay_9', receiptNo: 'PS/26-27/000009' }, payDeps);
  assert.equal(paid.delivered, 'text');
  assert.equal(payDeps.calls.updates[0].subscriptionFee.trialDays, 7);
  assert.throws(() => fee.validateTrialStarted({ phone: '123' }), /phone is required/);
  assert.throws(() => fee.validateLocked({ phone: '919000000001', lockedAt: 'soon' }), /lockedAt/);
});
