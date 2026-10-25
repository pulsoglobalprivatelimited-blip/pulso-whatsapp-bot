const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/services/offerFeedback');

const NOW = Date.parse('2026-10-26T05:00:00Z');
const SENT = { sentAt: '2026-10-26T04:30:00Z', name: 'Anjana' };
const tap = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id } } });
const pick = (id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id } } });
const tplTap = (payload) => ({ type: 'button', button: { payload, text: 'x' } });
const text = (body) => ({ type: 'text', text: { body } });

test('WhatsApp limits: buttons 20, list titles 24, descriptions 72, list button 20', () => {
  for (const b of [...f.TEXT.templateButtons, ...f.PAY_BUTTONS.map((x) => x.title), ...f.WHEN_BUTTONS.map((x) => x.title)]) {
    assert.ok(b.length <= 20, `${b} is ${b.length}`);
  }
  for (const row of f.LIST_ROWS) {
    assert.ok(row.title.length <= 24, `${row.title} is ${row.title.length}`);
    if (row.description) assert.ok(row.description.length <= 72, row.description);
  }
  assert.ok(f.TEXT.listButton.length <= 20);
  assert.equal(f.LIST_ROWS.length, 6);
});

test('the template body keeps the name variable away from the start and end', () => {
  assert.ok(!f.TEXT.templateBody.startsWith('{{1}}'));
  assert.ok(!f.TEXT.templateBody.trim().endsWith('}}'));
  const comps = f.templateComponents('Anjana');
  assert.equal(comps[0].parameters[0].text, 'Anjana');
  assert.deepEqual(comps.slice(1).map((c) => c.parameters[0].payload), [f.ID.NOT_SEEN, f.ID.PAY, f.ID.OTHER]);
});

test('Didn\'t see offers → the notifications help, reason saved', () => {
  const p = f.decide(SENT, tplTap(f.ID.NOT_SEEN), NOW);
  assert.equal(p.replies[0].body, f.TEXT.notSeen);
  assert.equal(p.patch.reason, 'not_seen');
  assert.equal(p.hub.reason, 'not_seen');
});

test('Pay too low → pay buttons → the chosen pay is saved', () => {
  const q = f.decide(SENT, tplTap(f.ID.PAY), NOW);
  assert.equal(q.replies[0].kind, 'buttons');
  assert.deepEqual(q.replies[0].body.buttons.map((b) => b.title), ['₹700', '₹800', '₹900+']);
  const a = f.decide({ ...SENT, state: 'awaiting_pay' }, tap(f.ID.PAY_800), NOW);
  assert.equal(a.replies[0].body, f.TEXT.payThanks);
  assert.equal(a.hub.expectedPay, 800);
});

test('Other reason → the list of six', () => {
  const p = f.decide(SENT, tplTap(f.ID.OTHER), NOW);
  assert.equal(p.replies[0].kind, 'list');
  assert.equal(p.replies[0].body.sections[0].rows.length, 6);
});

test('Too far → asks the place, then saves what she types', () => {
  const q = f.decide(SENT, pick(f.ID.FAR), NOW);
  assert.equal(q.patch.state, 'awaiting_place');
  const a = f.decide({ ...SENT, state: 'awaiting_place' }, text('Aluva'), NOW);
  assert.equal(a.replies[0].body, f.TEXT.farThanks);
  assert.equal(a.hub.preferredArea, 'Aluva');
  assert.equal(a.patch.state, '');
});

test('8-hour only → saved, and her duty hours become 8_hour', () => {
  const p = f.decide(SENT, pick(f.ID.EIGHT_HOUR), NOW);
  assert.equal(p.replies[0].body, f.TEXT.eightHour);
  assert.equal(p.dutyHours, '8_hour');
});

test('Working elsewhere → when free → saved', () => {
  const q = f.decide(SENT, pick(f.ID.WORKING), NOW);
  assert.deepEqual(q.replies[0].body.buttons.map((b) => b.title), ['ഈ ആഴ്ച', 'അടുത്ത മാസം', 'ഇപ്പോൾ വേണ്ട']);
  const a = f.decide({ ...SENT, state: 'awaiting_when' }, tap(f.ID.WHEN_MONTH), NOW);
  assert.equal(a.hub.freeWhen, 'next_month');
});

test('Family / health → FREE later alerts the team', () => {
  const q = f.decide(SENT, pick(f.ID.FAMILY), NOW);
  assert.equal(q.replies[0].body, f.TEXT.family);
  assert.equal(q.alert, undefined);
  const a = f.decide({ ...SENT, state: 'awaiting_free' }, text('FREE'), NOW);
  assert.equal(a.replies[0].body, f.TEXT.freeNow);
  assert.equal(a.alert, 'free_now');
});

test('Free now → thanks and an alert', () => {
  const p = f.decide(SENT, pick(f.ID.FREE_NOW), NOW);
  assert.equal(p.replies[0].body, f.TEXT.freeNow);
  assert.equal(p.alert, 'free_now');
});

test('Something else → her own words (or a voice note) are saved', () => {
  const q = f.decide(SENT, pick(f.ID.SOMETHING_ELSE), NOW);
  assert.equal(q.replies[0].body, f.TEXT.somethingElseQuestion);
  const a = f.decide({ ...SENT, state: 'awaiting_words' }, text('പുരുഷ രോഗികൾക്ക് ഡ്യൂട്ടി വേണ്ട'), NOW);
  assert.equal(a.replies[0].body, f.TEXT.somethingElseThanks);
  assert.equal(a.hub.ownWords, 'പുരുഷ രോഗികൾക്ക് ഡ്യൂട്ടി വേണ്ട');
  const v = f.decide({ ...SENT, state: 'awaiting_words' }, { type: 'audio', audio: { id: 'a1' } }, NOW);
  assert.equal(v.hub.ownWords, '(voice message)');
});

test('typed words outside a question → support reply, words kept', () => {
  const p = f.decide(SENT, text('ഞാൻ ഇപ്പോൾ തിരുവനന്തപുരത്താണ്'), NOW);
  assert.equal(p.replies[0].body, f.TEXT.support);
  assert.equal(p.hub.typed, 'ഞാൻ ഇപ്പോൾ തിരുവനന്തപുരത്താണ്');
});

test('STOP opts out, and after that taps are silent', () => {
  const p = f.decide(SENT, text('stop'), NOW);
  assert.equal(p.replies[0].body, f.TEXT.stopped);
  assert.equal(p.patch.optedOut, true);
  const after = f.decide({ ...SENT, optedOut: true }, tplTap(f.ID.PAY), NOW);
  assert.deepEqual(after.replies, []);
});

test('a caregiver we never asked, or asked over a week ago, is left to the normal bot', () => {
  assert.equal(f.decide(null, text('hello'), NOW), null);
  assert.equal(f.decide({ sentAt: '2026-10-10T04:30:00Z' }, text('hello'), NOW), null);
});

test('the founder\'s Malayalam is kept word for word', () => {
  assert.match(f.TEXT.templateBody, /^ഹലോ \{\{1\}\},\nഈ ആഴ്ച Pulso ആപ്പിൽ/);
  assert.equal(f.TEXT.stopped, 'ശരി. ഇനി ഇത്തരം സന്ദേശങ്ങൾ നിങ്ങൾക്ക് ലഭിക്കില്ല.');
  assert.equal(f.LIST_ROWS[5].title, 'മറ്റെന്തെങ്കിലും കാരണം');
});

test('a feedback tap is recognised even for a number on the pre-onboarded list', async () => {
  assert.equal(await f.isOfferFeedbackMessage('919000000001', { type: 'button', button: { payload: 'ofb_pay' } }), true);
});
