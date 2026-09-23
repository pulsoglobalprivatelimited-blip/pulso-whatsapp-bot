'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* PulsoDesk is browser code with no module system, so it is loaded the way the
   page loads it: run the file with a window to hang the global on. */
function loadDesk() {
  const path = require.resolve('../src/public/assets/desk-ui.js');
  delete require.cache[path];
  global.window = { PulsoDesk: null };
  require(path);
  return global.window.PulsoDesk;
}

const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();

/* Two rows that disagree about which should come first: one has been waiting
   three days for a decision, the other arrived a minute ago and is finished.
   Queue order and latest order are the two defensible answers, and the desks
   need to be able to ask for either. */
const stuckOld = { id: 'stuck-3d', tone: 'stuck', at: hoursAgo(72) };
const doneNew = { id: 'done-now', tone: 'done', at: hoursAgo(0.01) };
const needsMid = { id: 'needs-5h', tone: 'needs', at: hoursAgo(5) };
const undated = { id: 'no-date', tone: 'waiting', at: null };

const opts = (mode) => ({ mode, toneOf: (r) => r.tone, timeOf: (r) => r.at });
const ids = (rows) => rows.map((r) => r.id);

test('queue order puts the decision first, however new the finished row is', () => {
  const out = loadDesk().sortRows([doneNew, stuckOld, needsMid], opts('queue'));
  assert.deepEqual(ids(out), ['stuck-3d', 'needs-5h', 'done-now']);
});

test('queue order serves the longest wait first within a tone', () => {
  const older = { id: 'older', tone: 'needs', at: hoursAgo(9) };
  const newer = { id: 'newer', tone: 'needs', at: hoursAgo(2) };
  const out = loadDesk().sortRows([newer, older], opts('queue'));
  assert.deepEqual(ids(out), ['older', 'newer']);
});

test('finished rows still read newest first — they are a record, not work', () => {
  const older = { id: 'older', tone: 'done', at: hoursAgo(9) };
  const newer = { id: 'newer', tone: 'done', at: hoursAgo(2) };
  const out = loadDesk().sortRows([older, newer], opts('queue'));
  assert.deepEqual(ids(out), ['newer', 'older']);
});

test('latest order ignores urgency entirely', () => {
  const out = loadDesk().sortRows([stuckOld, doneNew, needsMid], opts('latest'));
  assert.deepEqual(ids(out), ['done-now', 'needs-5h', 'stuck-3d']);
});

/* timeValue returns 0 for a missing date, which would put undated rows at the
   top of a descending sort if it were not thought about. */
test('a row with no date sorts last in both orders, never first', () => {
  const Desk = loadDesk();
  assert.equal(ids(Desk.sortRows([undated, doneNew], opts('latest'))).at(-1), 'no-date');
  assert.equal(ids(Desk.sortRows([undated, needsMid], opts('queue'))).at(-1), 'no-date');
});

test('sorting does not disturb the caller’s array', () => {
  const input = [doneNew, stuckOld];
  loadDesk().sortRows(input, opts('latest'));
  assert.deepEqual(ids(input), ['done-now', 'stuck-3d']);
});

/* The headings have to follow the order, or they interleave down the list. */
test('headings are tone in queue order and date in latest order', () => {
  const Desk = loadDesk();
  assert.equal(Desk.groupFor('queue', 'stuck', hoursAgo(72)), 'Waiting longest');
  assert.equal(Desk.groupFor('queue', 'done', hoursAgo(1)), 'Done');
  assert.equal(Desk.groupFor('latest', 'stuck', hoursAgo(1)), 'Today');
  assert.equal(Desk.groupFor('latest', 'done', hoursAgo(1)), 'Today');
});
