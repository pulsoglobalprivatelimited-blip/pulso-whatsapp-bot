const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * Where the calling bot's answers go, and when it may go before the booking bot.
 *
 * Both were broken on the first day live: every reply left from the onboarding
 * number (so the agency landed in another chat and its buttons did nothing),
 * and an admin with a half-finished booking could never reach the list at all.
 */

const SUPPORT_ID = 'support-number-id';
const ADMIN = '917736108778';
const STRANGER = '919876543210';

const sent = [];
const storeCalls = [];
let callerState = { state: 'idle', inHand: null };

const fakeStore = {
  isCallAdmin: async (phone) => String(phone).replace(/\D/g, '').slice(-10) === ADMIN.slice(-10),
  getCaller: async () => callerState,
  setCaller: async (_phone, patch) => { callerState = { ...callerState, ...patch }; },
  claimNextAgency: async () => ({
    agency: { id: '919000000001', agency: 'Test Home Care', phone: '+91 90000 00001', district: 'Kakkanad' },
    position: 1,
    total: 1,
  }),
  statsFor: async () => ({ total: 1, dueToday: 1 }),
  recordOutcome: async (id, outcome, extra) => { storeCalls.push({ fn: 'recordOutcome', id, outcome, note: extra && extra.note }); },
  releaseAgency: async () => {},
  skipAgency: async (id) => { storeCalls.push({ fn: 'skipAgency', id }); },
  addNote: async () => {},
};

const record = (kind) => async (to, _body, options) => { sent.push({ kind, to, options }); };
const fakeMeta = {
  sendText: record('text'),
  sendButtons: async (to, _body, _buttons, options) => { sent.push({ kind: 'buttons', to, options }); },
  sendContacts: record('contacts'),
};

const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './agencyCallStore') return fakeStore;
  if (request === './metaClient') return fakeMeta;
  if (request === '../config' && parent && /agencyCallService/.test(parent.filename)) {
    const real = realLoad(request, parent, isMain);
    return new Proxy(real, {
      get: (target, key) => (key === 'providerSupportPhoneNumberId' ? SUPPORT_ID : target[key]),
    });
  }
  return realLoad(request, parent, isMain);
};

const { maybeHandleAgencyCall } = require('../src/services/agencyCallService');
const flow = require('../src/services/agencyCallFlow');

test.after(() => { Module._load = realLoad; });
test.beforeEach(() => {
  sent.length = 0;
  storeCalls.length = 0;
  callerState = { state: 'idle', inHand: null };
});

const textMessage = (body) => ({ type: 'text', text: { body } });
const buttonMessage = (id) => ({ type: 'interactive', interactive: { button_reply: { id } } });

test('every reply to "call" leaves from the support number', async () => {
  assert.equal(await maybeHandleAgencyCall(ADMIN, textMessage('call')), true);
  assert.deepEqual(sent.map((s) => s.kind), ['text', 'contacts', 'buttons']);
  for (const s of sent) {
    assert.equal(s.to, ADMIN);
    assert.deepEqual(s.options, { phoneNumberId: SUPPORT_ID }, `${s.kind} must not fall back to onboarding`);
  }
});

test('"call" goes ahead of an open booking draft', async () => {
  assert.equal(await maybeHandleAgencyCall(ADMIN, textMessage(' Call '), { priorityOnly: true }), true);
  assert.ok(sent.length > 0);
});

test('our outcome buttons go ahead of an open booking draft', async () => {
  callerState = { state: 'awaiting_outcome', inHand: '919000000001' };
  const handled = await maybeHandleAgencyCall(ADMIN, buttonMessage(flow.BUTTON_IDS.noAnswer), { priorityOnly: true });
  assert.equal(handled, true);
});

test('the follow-up date we asked for goes ahead of an open booking draft', async () => {
  callerState = { state: 'awaiting_follow_up', inHand: '919000000001', pendingOutcome: 'later' };
  assert.equal(await maybeHandleAgencyCall(ADMIN, textMessage('tomorrow'), { priorityOnly: true }), true);
});

test('words that may be booking answers stay with the booking draft', async () => {
  for (const word of ['yes', 'no', 'c', 'next', 'Kakkanad']) {
    callerState = { state: 'awaiting_outcome', inHand: '919000000001' };
    sent.length = 0;
    assert.equal(await maybeHandleAgencyCall(ADMIN, textMessage(word), { priorityOnly: true }), false, word);
    assert.equal(sent.length, 0, `${word} must not be answered by the calling bot`);
  }
});

test('a stranger typing "call" is never answered, priority or not', async () => {
  assert.equal(await maybeHandleAgencyCall(STRANGER, textMessage('call'), { priorityOnly: true }), false);
  assert.equal(await maybeHandleAgencyCall(STRANGER, textMessage('call')), false);
  assert.equal(await maybeHandleAgencyCall(STRANGER, buttonMessage(flow.BUTTON_IDS.interested), { priorityOnly: true }), false);
  assert.equal(sent.length, 0);
});

test('takesPriority is pure and narrow', () => {
  assert.equal(flow.takesPriority({ text: 'call' }), true);
  assert.equal(flow.takesPriority({ text: 'CALL' }), true);
  assert.equal(flow.takesPriority({ buttonId: flow.BUTTON_IDS.later }), true);
  assert.equal(flow.takesPriority({ text: 'note', state: 'awaiting_note' }), true);
  assert.equal(flow.takesPriority({ text: 'call me later' }), false);
  assert.equal(flow.takesPriority({ text: 'yes', state: 'awaiting_outcome' }), false);
  assert.equal(flow.takesPriority({ buttonId: 'ab_cancel' }), false);
  assert.equal(flow.takesPriority({}), false);
});

test('"skip" at the note question saves Interested with no note, and keeps the agency', async () => {
  callerState = { state: 'awaiting_note', inHand: '919000000001', pendingOutcome: 'interested' };
  assert.equal(await maybeHandleAgencyCall(ADMIN, textMessage('skip')), true);
  assert.deepEqual(storeCalls[0], { fn: 'recordOutcome', id: '919000000001', outcome: 'interested', note: '' });
  assert.ok(!storeCalls.some((c) => c.fn === 'skipAgency'), 'an Interested agency must not go to the back of the list');
});

test('a note at the note question is saved with Interested', async () => {
  callerState = { state: 'awaiting_note', inHand: '919000000001', pendingOutcome: 'interested' };
  assert.equal(await maybeHandleAgencyCall(ADMIN, textMessage('Needs 2 GDAs in Aluva, call Monday')), true);
  assert.equal(storeCalls[0].note, 'Needs 2 GDAs in Aluva, call Monday');
});

test('"skip" with an agency in hand still skips it', async () => {
  callerState = { state: 'awaiting_outcome', inHand: '919000000001' };
  assert.equal(await maybeHandleAgencyCall(ADMIN, textMessage('skip')), true);
  assert.equal(storeCalls[0].fn, 'skipAgency');
});

test('the note question comes with a Skip button, from the support number', async () => {
  callerState = { state: 'awaiting_outcome', inHand: '919000000001' };
  assert.equal(await maybeHandleAgencyCall(ADMIN, buttonMessage(flow.BUTTON_IDS.interested)), true);
  assert.deepEqual(sent.map((s) => s.kind), ['buttons']);
  assert.deepEqual(sent[0].options, { phoneNumberId: SUPPORT_ID });
  assert.equal(callerState.state, 'awaiting_note');
});

test('tapping Skip saves Interested with no note, even with a booking open', async () => {
  callerState = { state: 'awaiting_note', inHand: '919000000001', pendingOutcome: 'interested' };
  const tap = buttonMessage(flow.BUTTON_IDS.skipNote);
  assert.equal(await maybeHandleAgencyCall(ADMIN, tap, { priorityOnly: true }), true);
  assert.deepEqual(storeCalls[0], { fn: 'recordOutcome', id: '919000000001', outcome: 'interested', note: '' });
  assert.ok(!storeCalls.some((c) => c.fn === 'skipAgency'));
});

test('a Skip tapped on an old note question does nothing to the agency in hand', async () => {
  callerState = { state: 'awaiting_outcome', inHand: '919000000002' };
  assert.equal(await maybeHandleAgencyCall(ADMIN, buttonMessage(flow.BUTTON_IDS.skipNote)), true);
  assert.equal(storeCalls.length, 0, 'the next agency must not be skipped or recorded');
  assert.equal(sent.length, 0);
});
