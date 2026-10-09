const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('../src/services/agencyCallFlow');

const AGENCY = {
  agency: 'Benevolent Home Care & Care Home Facility',
  district: 'Ernakulam',
  phone: '+91 89219 51119',
  messagedOn: '2026-10-03',
  repliedToBroadcast: true,
};

test('the three buttons record the outcome they name', () => {
  assert.deepEqual(f.parseCommand({ buttonId: f.BUTTON_IDS.interested }), { kind: 'outcome', outcome: 'interested' });
  assert.deepEqual(f.parseCommand({ buttonId: f.BUTTON_IDS.later }), { kind: 'outcome', outcome: 'later' });
  assert.deepEqual(f.parseCommand({ buttonId: f.BUTTON_IDS.noAnswer }), { kind: 'outcome', outcome: 'no answer' });
});

test('the typed commands work in any case, with the short forms he will actually use', () => {
  for (const word of ['call', 'CALL', ' Call ', 'next', 'c']) {
    assert.equal(f.parseCommand({ text: word }).kind, 'call', word);
  }
  assert.equal(f.parseCommand({ text: 'Stats' }).kind, 'stats');
  assert.equal(f.parseCommand({ text: 'stop' }).kind, 'stop');
  assert.equal(f.parseCommand({ text: 'skip' }).kind, 'skip');
  assert.equal(f.parseCommand({ text: 'help' }).kind, 'help');
  assert.equal(f.parseCommand({ text: 'no' }).outcome, 'agency not interested');
  assert.equal(f.parseCommand({ text: 'pulso no' }).outcome, 'pulso not interested');
  assert.equal(f.parseCommand({ text: 'wrong' }).outcome, 'wrong number');
  assert.deepEqual(f.parseCommand({ text: 'note owner was driving' }), { kind: 'note', note: 'owner was driving' });
});

test('an outcome is never inferred from a sentence that merely contains the word', () => {
  // "he said he is interested but busy" must not silently record interested —
  // an outcome he did not choose is worse than one he has to retype.
  const got = f.parseCommand({ text: 'he said he is interested but busy' });
  assert.equal(got.kind, 'text');
  assert.equal(got.outcome, undefined);
  assert.equal(f.parseCommand({ text: '' }).kind, null);
});

test('the agency message carries everything he needs before dialling', () => {
  const text = f.agencyMessage(AGENCY, { position: 1, total: 100 });
  assert.match(text, /1 of 100 · Ernakulam/);
  assert.match(text, /Benevolent Home Care/);
  assert.match(text, /\+91 89219 51119/);
  assert.match(text, /Already replied/);
  assert.match(text, /Messaged 2026-10-03/);
});

test('a second attempt says so, so he knows before he dials', () => {
  const text = f.agencyMessage({ ...AGENCY, attempts: 1 }, { position: 9, total: 100 });
  assert.match(text, /Call attempt 2/);
  assert.doesNotMatch(f.agencyMessage(AGENCY, {}), /Call attempt/);
});

test('the contact card dials, with a ten-digit number given its country code', () => {
  const card = f.agencyContactCard(AGENCY);
  assert.equal(card.phones[0].phone, '+918921951119');
  assert.match(card.org.company, /Ernakulam/);
  assert.equal(card.name.formatted_name, AGENCY.agency);
  const bare = f.agencyContactCard({ agency: 'X', phone: '9947444011' });
  assert.equal(bare.phones[0].phone, '+919947444011');
  assert.equal(f.agencyContactCard(null), null);
});

test('no answer comes back in two days, and retires on the third try', () => {
  const now = new Date('2026-10-06T09:00:00Z');
  const first = f.recordFor(f.OUTCOMES.noAnswer, { attempts: 0, now });
  assert.equal(first.status, 'pending');
  assert.equal(first.attempts, 1);
  assert.equal(first.followUpOn, '2026-10-08');
  const third = f.recordFor(f.OUTCOMES.noAnswer, { attempts: 2, now });
  assert.equal(third.status, 'retired', 'three unanswered calls is enough');
  assert.equal(third.followUpOn, null);
});

test('interested and not interested are final; the number is never handed out again', () => {
  for (const outcome of [f.OUTCOMES.interested, f.OUTCOMES.notInterested, f.OUTCOMES.agencyNotInterested, f.OUTCOMES.pulsoNotInterested, f.OUTCOMES.wrongNumber]) {
    const got = f.recordFor(outcome, { attempts: 0 });
    assert.equal(got.status, 'done', outcome);
    assert.equal(got.followUpOn, null, outcome);
  }
});

test('later keeps the date he gave', () => {
  const got = f.recordFor(f.OUTCOMES.later, { attempts: 0, followUpOn: '2026-10-13' });
  assert.equal(got.status, 'pending');
  assert.equal(got.followUpOn, '2026-10-13');
});

test('a follow-up date is read the way he will type it', () => {
  const now = new Date('2026-10-06T09:00:00Z');      // a Tuesday
  assert.equal(f.parseFollowUpDate('1 week', now), '2026-10-13');
  assert.equal(f.parseFollowUpDate('3 days', now), '2026-10-09');
  assert.equal(f.parseFollowUpDate('tomorrow', now), '2026-10-07');
  assert.equal(f.parseFollowUpDate('2026-10-20', now), '2026-10-20');
  assert.equal(f.parseFollowUpDate('12/10', now), '2026-10-12');
  assert.equal(f.parseFollowUpDate('rubbish', now), null);
  assert.equal(f.parseFollowUpDate('', now), null);
});

test('a weekday always means the NEXT one, never today', () => {
  // "monday" on a Monday means next Monday: a callback booked for the hour
  // that has already passed is a callback that never happens.
  const monday = new Date('2026-10-05T09:00:00Z');
  assert.equal(f.parseFollowUpDate('monday', monday), '2026-10-12');
  assert.equal(f.parseFollowUpDate('friday', monday), '2026-10-09');
});

test('only "later" asks for a date, and only "interested" asks what they need', () => {
  assert.equal(f.asksFollowUp(f.OUTCOMES.later), true);
  assert.equal(f.asksFollowUp(f.OUTCOMES.noAnswer), false);
  assert.equal(f.asksNote(f.OUTCOMES.interested), true);
  assert.equal(f.asksNote(f.OUTCOMES.notInterested), false);
  assert.equal(f.asksNote(f.OUTCOMES.agencyNotInterested), true);
  assert.equal(f.asksNote(f.OUTCOMES.pulsoNotInterested), true);
  assert.equal(f.asksNote(f.OUTCOMES.wrongNumber), false);
});

test('the outcome list has all six, within WhatsApp limits, and each row parses to its outcome', () => {
  const rows = f.outcomeRows();
  assert.deepEqual(rows.map((r) => r.title), ['Interested', 'Not sure', 'Later', 'No answer', 'Agency not interested', 'Pulso not interested', 'Wrong number']);
  assert.ok(rows.length <= 10);
  for (const r of rows) {
    assert.ok(r.title.length <= 24, r.title);
    assert.ok(r.description.length <= 72, r.description);
  }
  const outcomes = rows.map((r) => f.parseCommand({ buttonId: r.id }).outcome);
  assert.deepEqual(outcomes, ['interested', 'not sure', 'later', 'no answer', 'agency not interested', 'pulso not interested', 'wrong number']);
});

test('stats add up and name what is next', () => {
  const text = f.statsMessage({
    total: 100, interested: 6, later: 4, noAnswer: 9, notInterested: 5, wrongNumber: 0,
    dueToday: 2, nextDistrict: 'Thrissur',
  });
  assert.match(text, /Called 24 of 100/);
  assert.match(text, /Interested: 6/);
  assert.match(text, /Agency not interested: 5/);
  assert.match(text, /Pulso not interested: 0/);
  assert.match(text, /2 follow-ups due today/);
  assert.match(text, /Next up: Thrissur/);
});

test('the help text names every command the parser accepts', () => {
  for (const word of ['call', 'skip', 'stats', 'stop', 'note']) {
    assert.ok(f.MESSAGES.help.includes(word), word);
  }
});

test('stats: old "not interested" records count as the agency\'s, Pulso\'s are separate', () => {
  const text = f.statsMessage({ total: 50, notInterested: 2, agencyNotInterested: 3, pulsoNotInterested: 4 });
  assert.match(text, /Called 9 of 50/);
  assert.match(text, /Agency not interested: 5/);
  assert.match(text, /Pulso not interested: 4/);
});

test('call again: three buttons within WhatsApp limits, each read as a date', () => {
  const buttons = f.followUpButtons();
  assert.deepEqual(buttons.map((b) => b.title), ['Tomorrow', 'In 3 days', 'In 1 week']);
  for (const b of buttons) assert.ok(b.title.length <= 20, b.title);
  const now = new Date('2026-10-09T05:30:00Z');
  const dates = buttons.map((b) => f.parseFollowUpDate(f.followUpTextFor(b.id), now));
  assert.deepEqual(dates, [f.toDayKey(new Date('2026-10-10T05:30:00Z')), f.toDayKey(new Date('2026-10-12T05:30:00Z')), f.toDayKey(new Date('2026-10-16T05:30:00Z'))]);
  assert.equal(f.followUpTextFor('agency_call_interested'), '');
  // A button tap goes ahead of an open booking draft, like the outcome buttons.
  for (const b of buttons) assert.equal(f.takesPriority({ buttonId: b.id }), true);
});

test('Not sure: asks for a note, is final, and is counted', () => {
  assert.equal(f.parseCommand({ text: 'not sure' }).outcome, 'not sure');
  assert.equal(f.asksNote(f.OUTCOMES.notSure), true);
  assert.equal(f.asksFollowUp(f.OUTCOMES.notSure), false);
  assert.equal(f.recordFor(f.OUTCOMES.notSure).status, 'done');
  const text = f.statsMessage({ total: 10, notSure: 2, interested: 1 });
  assert.match(text, /Not sure: 2/);
  assert.match(text, /Called 3 of 10/);
});
