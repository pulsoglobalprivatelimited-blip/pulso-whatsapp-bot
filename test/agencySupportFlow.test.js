const test = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../src/services/agencySupportFlow');

// 10:30 IST and 21:00 IST on 5 Nov 2026.
const DAY = Date.UTC(2026, 10, 5, 5, 0);
const NIGHT = Date.UTC(2026, 10, 5, 15, 30);

function harness(nowMs = DAY, session = {}) {
  const state = { session: { ...session }, sent: [], events: [], alerts: [] };
  const deps = {
    now: () => nowMs,
    updateSession: async (_phone, patch) => {
      state.session = { ...state.session, ...patch };
      return state.session;
    },
    sendAndLog: async (_phone, kind, body) => state.sent.push({ kind, body }),
    addSessionEvent: async (_phone, event) => state.events.push(event),
    notify: async (session, request) => state.alerts.push({ session, request })
  };
  return { state, deps };
}

const text = (body) => ({ type: 'text', text: { body } });
const button = (id, title = '') => ({ type: 'interactive', interactive: { button_reply: { id, title } } });
const listPick = (id, title = '') => ({ type: 'interactive', interactive: { list_reply: { id, title } } });
const photo = (id, caption = '') => ({ type: 'image', image: { id, caption } });

test('the app message starts it and carries the agency name', () => {
  assert.equal(flow.isStartMessage(text('AGENCY SUPPORT · Grace Home Care')), true);
  assert.equal(flow.isStartMessage(text('agency support')), true);
  assert.equal(flow.isStartMessage(text('hi')), false);
  assert.equal(flow.agencyNameFromText('AGENCY SUPPORT · Grace Home Care'), 'Grace Home Care');
  assert.equal(flow.agencyNameFromText('AGENCY SUPPORT'), '');
});

test('first time: language buttons, then the five topics in that language', async () => {
  const { state, deps } = harness();
  await flow.start(deps, '919000000105', text('AGENCY SUPPORT · Spirit'), {});
  assert.equal(state.session.status, flow.STATUS.LANGUAGE);
  assert.equal(state.session.agencyName, 'Spirit');
  assert.match(state.sent[0].body.body, /Hi Spirit/);
  assert.deepEqual(state.sent[0].body.buttons.map((b) => b.title), ['English', 'മലയാളം']);

  await flow.handle(deps, '919000000105', button(flow.IDS.LANG_ML, 'മലയാളം'), state.session);
  assert.equal(state.session.agencyLanguage, 'ml');
  assert.equal(state.session.status, flow.STATUS.MENU);
  const rows = state.sent[1].body.sections[0].rows.map((r) => r.title);
  assert.deepEqual(rows, flow.TOPICS.map((t) => t.ml));
  assert.ok(rows.every((r) => r.length <= 24), 'WhatsApp list rows are 24 characters at most');
});

test('second time the language is remembered: straight to the menu with a greeting', async () => {
  const { state, deps } = harness(DAY, { agencyLanguage: 'en' });
  await flow.start(deps, '919000000105', text('AGENCY SUPPORT · Spirit'), state.session);
  assert.equal(state.session.status, flow.STATUS.MENU);
  assert.match(state.sent[0].body.body, /^Hi Spirit 👋 This is Pulso support\./);
  assert.deepEqual(state.sent[0].body.sections[0].rows.map((r) => r.title), flow.TOPICS.map((t) => t.en));
});

test('topic, then the problem with a photo: thanks with the 2-hour promise and one alert', async () => {
  const { state, deps } = harness(DAY, { agencyLanguage: 'en', agencyName: 'Spirit', status: flow.STATUS.MENU });
  await flow.handle(deps, '919000000105', listPick(flow.IDS.TOPIC_CAREGIVER), state.session);
  assert.equal(state.session.status, flow.STATUS.ISSUE);
  assert.equal(state.sent.at(-1).body, flow.WORDS.ask.en);

  await flow.handle(deps, '919000000105', photo('media-1', 'OTP shows wrong'), state.session);
  assert.equal(state.session.status, flow.STATUS.OPEN);
  assert.equal(state.sent.at(-1).body, flow.WORDS.thanksDay.en);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].request.topicLabel, 'A caregiver or a duty');
  assert.equal(state.alerts[0].request.text, 'OTP shows wrong');
  assert.deepEqual(state.alerts[0].request.media, [{ id: 'media-1', type: 'image' }]);
});

test('after 7 pm the promise is tomorrow after 9 am', async () => {
  const { state, deps } = harness(NIGHT, { agencyLanguage: 'ml', status: flow.STATUS.ISSUE, agencyTopic: 'payment' });
  await flow.handle(deps, '919000000105', text('ബിൽ തെറ്റാണ്'), state.session);
  assert.equal(state.sent.at(-1).body, flow.WORDS.thanksNight.ml);
  assert.equal(flow.withinReplyHours(DAY), true);
  assert.equal(flow.withinReplyHours(NIGHT), false);
});

test('more lines within 12 hours join the request quietly; no second alert', async () => {
  const { state, deps } = harness(DAY, { agencyLanguage: 'en', status: flow.STATUS.OPEN, agencyRequestOpenedAtMs: DAY - 60 * 60 * 1000 });
  await flow.handle(deps, '919000000105', text('Also the second caregiver'), state.session);
  assert.equal(state.alerts.length, 0);
  assert.equal(state.sent.length, 0);
  assert.equal(state.events.at(-1).event, 'agency_support_followup');
});

test('after 12 hours, or on "menu", the menu comes back', async () => {
  const late = harness(DAY, { agencyLanguage: 'en', status: flow.STATUS.OPEN, agencyRequestOpenedAtMs: DAY - flow.OPEN_WINDOW_MS - 1 });
  await late.deps && flow.handle(late.deps, '919000000105', text('New problem'), late.state.session);
  assert.equal(late.state.session.status, flow.STATUS.MENU);
  const menu = harness(DAY, { agencyLanguage: 'en', status: flow.STATUS.OPEN, agencyRequestOpenedAtMs: DAY });
  await flow.handle(menu.deps, '919000000105', text('menu'), menu.state.session);
  assert.equal(menu.state.session.status, flow.STATUS.MENU);
});

test('typed numbers and unknown answers in the menu', async () => {
  assert.equal(flow.parseTopic(text('3')).key, 'app');
  assert.equal(flow.parseTopic(text('Payments and bills')).key, 'payment');
  const { state, deps } = harness(DAY, { agencyLanguage: 'en', status: flow.STATUS.MENU });
  await flow.handle(deps, '919000000105', text('what?'), state.session);
  assert.equal(state.sent[0].body, flow.WORDS.notUnderstood.en);
  assert.equal(state.session.status, flow.STATUS.MENU);
});

test('no phone number in any agency support words', () => {
  const all = JSON.stringify(flow.WORDS) + JSON.stringify(flow.TOPICS) + flow.WORDS.greet('X');
  assert.doesNotMatch(all, /\d{5}\s?\d{5}/);
});
