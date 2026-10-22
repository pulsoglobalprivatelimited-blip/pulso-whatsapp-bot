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
  assert.ok(paragraphs[1].startsWith('1. Pulso-യിൽ അംഗമാകുന്നതിനായി ഒറ്റത്തവണ ₹500 (tax included) സബ്സ്ക്രിപ്ഷൻ ഫീസ് അടയ്ക്കണം.'));
  assert.ok(paragraphs[2].startsWith('Pulso ആപ്പിലൂടെ 180 ദിവസത്തെ ജോലി'));
  assert.ok(paragraphs[3].startsWith('2. ഡ്യൂട്ടി ലഭ്യത മാർക്കറ്റ് ആവശ്യകത'));
  assert.ok(paragraphs[3].includes('കേരളത്തിൽ'));
  assert.ok(text.includes('\n\n3. ഡ്യൂട്ടി സ്വീകരിച്ച ശേഷം, ₹1499'));
  assert.ok(text.includes('\n\n4. ദയവായി ശ്രദ്ധിക്കുക'));
  assert.ok(text.includes('\n\n5. അടുത്ത ലഭ്യമായ ഡ്യൂട്ടി'));
  assert.ok(!text.includes('\n\n1. ഡ്യൂട്ടി സ്വീകരിച്ച'));
  // English mirror
  const en = fee.termsIntroFor({ ...kerala, flowId: 'kerala_english' }, EN, NOW);
  assert.ok(en.includes('\n\n1. To become a Pulso member, you pay a one-time subscription fee of ₹500 (tax included).'));
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

test('the working model drops "no registration fee" for a fee-payer only', () => {
  const ml = fee.applyWorkingModelFeeLine(ML.workingModel, kerala, ML, NOW);
  assert.ok(!ml.includes('registration fee ഒന്നും നൽകേണ്ടതില്ല'));
  assert.ok(ml.includes(ML.workingModelFeeLine));
  const en = fee.applyWorkingModelFeeLine(EN.workingModel, { ...kerala, flowId: 'kerala_english' }, EN, NOW);
  assert.ok(!en.includes('There is no registration fee to join Pulso'));
  assert.ok(en.includes(EN.workingModelFeeLine));
  const old = { ...kerala, createdAt: new Date(START - DAY).toISOString() };
  assert.equal(fee.applyWorkingModelFeeLine(ML.workingModel, old, ML, NOW), ML.workingModel);
});

test('the record written at Accept, and a paid one is never overwritten', () => {
  const r = fee.dueRecord(kerala, '2026-11-02T10:00:00.000Z');
  assert.deepEqual(r, { required: true, status: 'due', amount: 500, dueSince: '2026-11-02T10:00:00.000Z', remindersSent: 0 });
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
  assert.ok(deps.calls.texts[0].body.startsWith('നന്ദി! ₹500'));
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
