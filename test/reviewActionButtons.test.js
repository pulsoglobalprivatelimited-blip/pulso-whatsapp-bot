'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* The reviewer's screen after a decision.
 *
 * Approving a certificate sends a real WhatsApp message and there is no
 * unsending it, so the desk has to be honest about what it just did and about
 * what is still worth pressing. Both answers are plain functions on purpose -
 * one deciding which buttons a record offers, one saying out loud what
 * happened - so they can be checked here instead of by driving a browser. */

function loadDesk() {
  const path = require.resolve('../src/public/assets/desk-ui.js');
  delete require.cache[path];
  global.window = { PulsoDesk: null };
  require(path);
  return global.window.PulsoDesk;
}

const Desk = loadDesk();

const pending = { verification: { status: 'pending' } };
const rejected = { verification: { status: 'rejected' } };
const verified = { verification: { status: 'verified' } };
const accepted = { verification: { status: 'verified' }, termsAccepted: true };
const finished = { verification: { status: 'verified' }, status: 'completed' };

/* ---- which buttons a record should offer --------------------------------- */

test('a certificate waiting for review offers approve and reject', () => {
  const stage = Desk.reviewStage(pending);
  assert.equal(stage.stage, 'pending');
  assert.equal(stage.approve, true);
  assert.equal(stage.reject, true);
  assert.equal(stage.undo, false);
});

test('an approved record stops offering approve', () => {
  // The bug this exists for: the button that sent the terms stayed on screen,
  // looking exactly like the one that had just worked, on a record where the
  // server now refuses to do anything at all.
  assert.equal(Desk.reviewStage(verified).approve, false);
});

test('an approved record still offers reject', () => {
  // A forged certificate spotted after the fact, once undo is gone, has no
  // other way back.
  assert.equal(Desk.reviewStage(verified).reject, true);
  assert.equal(Desk.reviewStage(accepted).reject, true);
  assert.equal(Desk.reviewStage(finished).reject, true);
});

test('undo is offered only before the provider has acted on the approval', () => {
  assert.equal(Desk.reviewStage(verified).undo, true);
  assert.equal(Desk.reviewStage(accepted).undo, false, 'terms already accepted');
  assert.equal(Desk.reviewStage(finished).undo, false, 'onboarding finished');
});

test('a rejected certificate can be approved when the next one arrives', () => {
  // Matches the server, which allows re-approval after a rejection.
  const stage = Desk.reviewStage(rejected);
  assert.equal(stage.stage, 'rejected');
  assert.equal(stage.approve, true);
});

test('the pinned bar is never left empty', () => {
  // All three buttons share the div that is fixed to the bottom of the phone.
  // If a state hid every one of them the reviewer would get a blank bar across
  // the screen and no way to act.
  [pending, rejected, verified, accepted, finished, {}, null].forEach((record) => {
    const stage = Desk.reviewStage(record);
    assert.ok(
      stage.approve || stage.reject || stage.undo,
      `no button for ${JSON.stringify(record)}`
    );
  });
});

test('a record with no verification block behaves like one waiting for review', () => {
  assert.deepEqual(Desk.reviewStage({}), Desk.reviewStage(pending));
  assert.deepEqual(Desk.reviewStage(null), Desk.reviewStage(pending));
});

/* ---- saying that it happened --------------------------------------------- */

/* desk-shell.js is browser code with no module system. The smallest document
   that lets it load, so the toast can be exercised without a browser. */
function loadShell() {
  const node = () => {
    const classes = new Set();
    return {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
      },
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      textContent: '',
      offsetWidth: 0,
      append() {}
    };
  };

  const appended = [];
  const timers = [];
  const path = require.resolve('../src/public/assets/desk-shell.js');
  delete require.cache[path];

  global.window = {
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    clearTimeout: () => {},
    setTimeout: (fn, ms) => { timers.push(ms); return timers.length; },
    document: {
      body: { append: (n) => appended.push(n), classList: node().classList },
      readyState: 'complete',
      addEventListener() {},
      createElement: node,
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null
    }
  };

  require(path);
  return { shell: global.window.PulsoDeskShell, appended, timers };
}

test('a toast says its message and is made only once', () => {
  const { shell, appended } = loadShell();
  shell.toast('Approved. Terms sent to Sona on WhatsApp.');
  shell.toast('Already approved by Rahoof. Nothing was sent again.');

  assert.equal(appended.length, 1, 'one node reused, not one per message');
  assert.equal(appended[0].textContent, 'Already approved by Rahoof. Nothing was sent again.');
  assert.ok(appended[0].classList.contains('is-open'));
  assert.equal(appended[0].attributes['aria-live'], 'polite');
});

test('an error toast is marked as one and given longer to be read', () => {
  const { shell, appended, timers } = loadShell();
  shell.toast('That did not go through. Try again.', 'error');
  assert.ok(appended[0].classList.contains('is-error'));

  shell.toast('Approved. Terms sent.');
  assert.equal(appended[0].classList.contains('is-error'), false, 'the mark is cleared');
  assert.ok(timers[0] > timers[1], `error ${timers[0]} should outlast success ${timers[1]}`);
});

test('an empty message never opens an empty bar', () => {
  const { shell, appended } = loadShell();
  shell.toast('');
  shell.toast(null);
  shell.toast('   ');
  assert.equal(appended.length, 0);
});
