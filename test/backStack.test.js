'use strict';
// The back stack behind the console's round arrow (docs/easy_back_plan.md,
// founder, 7 Oct 2026): what the phone's back, the arrow and a layer's own
// close control do, against a fake window. Nothing here touches a browser.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackStack } = require('../src/public/assets/back-stack.js');

function fakeWindow(href) {
  const listeners = {};
  const entries = [{ state: null, url: href }];
  let index = 0;
  const win = {
    location: { href, pathname: new URL(href).pathname },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, event) { (listeners[type] || []).forEach((fn) => fn(event)); },
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      pushState(state, _title, url) {
        entries.splice(index + 1);
        entries.push({ state, url: new URL(url, win.location.href).href });
        index += 1;
        win.location.href = entries[index].url;
      },
      replaceState(state, _title, url) {
        entries[index] = { state, url: url ? new URL(url, win.location.href).href : entries[index].url };
        win.location.href = entries[index].url;
      },
      go(delta) {
        index = Math.max(0, Math.min(entries.length - 1, index + delta));
        win.location.href = entries[index].url;
        win.fire('popstate', { state: entries[index].state });
      },
      back() { this.go(-1); }
    },
    entries: () => entries,
    index: () => index
  };
  return win;
}

test('back closes one layer at a time, then nothing', () => {
  const win = fakeWindow('https://x.test/admin');
  const back = createBackStack(win);
  const closed = [];
  back.push('chat', () => closed.push('chat'), { url: '/admin?chat=%2B91' });
  back.push('photo', () => closed.push('photo'));
  assert.equal(win.entries().length, 3);
  assert.equal(win.location.href, 'https://x.test/admin?chat=%2B91');

  back.pop();
  assert.deepEqual(closed, ['photo']);
  assert.equal(back._stack().length, 1);

  back.pop();
  assert.deepEqual(closed, ['photo', 'chat']);
  assert.equal(back._stack().length, 0);
  assert.equal(win.location.href, 'https://x.test/admin');

  // Desk root, no previous tab: nowhere to go, nothing happens.
  assert.equal(back.canGoBack(), false);
  back.pop();
  assert.equal(win.index(), 0);
});

test('the layer\'s own close control and the phone back do the same thing', () => {
  const win = fakeWindow('https://x.test/admin/bookings/inbox');
  const back = createBackStack(win);
  let closes = 0;
  back.push('viewer', () => { closes += 1; });
  assert.equal(back.dismiss('viewer'), true);
  assert.equal(closes, 1, 'closed once, by the history step, not twice');
  assert.equal(back._stack().length, 0);
  assert.equal(back.dismiss('viewer'), false);
});

test('re-opening the layer on top swaps it without adding a step', () => {
  const win = fakeWindow('https://x.test/admin/inbox');
  const back = createBackStack(win);
  const closed = [];
  back.push('chat', () => closed.push('a'), { url: '/admin/inbox?chat=a' });
  back.push('chat', () => closed.push('b'), { url: '/admin/inbox?chat=b' });
  assert.equal(win.entries().length, 2);
  assert.equal(win.location.href, 'https://x.test/admin/inbox?chat=b');
  back.pop();
  assert.deepEqual(closed, ['b']);
  assert.equal(win.location.href, 'https://x.test/admin/inbox');
});

test('a layer that vanished by itself is dropped and the address unwinds', () => {
  const win = fakeWindow('https://x.test/admin');
  const back = createBackStack(win);
  let closes = 0;
  back.push('detail', () => { closes += 1; }, { url: '/admin?phone=p1' });
  assert.equal(back.drop('detail'), true);
  assert.equal(closes, 0, 'already hidden by the page; not closed again');
  assert.equal(back._stack().length, 0);
  assert.equal(win.location.href, 'https://x.test/admin');
});

test('with nothing open, back walks the tabs, then leaves a sub-page for the desk', () => {
  const win = fakeWindow('https://x.test/admin');
  const back = createBackStack(win);
  let depth = 1;
  const popped = [];
  back.setRoot({ canBack: () => depth > 0, onPop: (state) => popped.push(state) });
  win.history.pushState({ pulsoSide: 'agency', sideDepth: 1 }, '', '/admin?side=agency');
  assert.equal(back.canGoBack(), true);
  back.pop();
  assert.equal(popped.length, 1);
  depth = 0;
  assert.equal(back.canGoBack(), false);

  const sub = fakeWindow('https://x.test/admin/inbox');
  const subBack = createBackStack(sub);
  assert.equal(subBack.canGoBack(), true, 'a sub-page can always go back to the desk');
  subBack.pop();
  assert.equal(sub.location.href, '/admin');
});

test('the address helpers keep the chat in the URL', () => {
  const win = fakeWindow('https://x.test/admin/inbox?side=agency');
  const back = createBackStack(win);
  assert.equal(back.withParam('chat', '+91 1'), '/admin/inbox?side=agency&chat=%2B91+1');
  back.remember({ chat: 'p9' });
  assert.equal(back.param('chat'), 'p9');
  back.remember({ chat: '' });
  assert.equal(back.param('chat'), null);
});

test('a pasted number with +91 and spaces finds the stored digits', () => {
  const back = createBackStack(fakeWindow('https://x.test/admin'));
  assert.equal(back.samePhone('919074319853', '+91 90743 19853'), true);
  assert.equal(back.samePhone('+919074319853', '919074319853'), true);
  assert.equal(back.samePhone('919074319853', '919074319854'), false);
  assert.equal(back.samePhone('', ''), false);
});

