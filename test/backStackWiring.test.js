'use strict';
// Every console page is wired to the back stack (docs/easy_back_plan.md): the
// script is on the page, the old Back buttons are gone, and each layer opens
// through PulsoBack so the phone's back and the round arrow agree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'public', p), 'utf8');

test('every admin page loads the back stack and has no old Back buttons', () => {
  for (const page of ['index', 'inbox', 'booking-inbox', 'booking-dashboard', 'provider-support', 'admins']) {
    const html = read(`admin/${page}.html`);
    assert.match(html, /back-stack\.js\?v=/, page);
    assert.match(html, /back-stack\.css\?v=/, page);
    assert.doesNotMatch(html, /Back to list|thread-back/, page);
  }
});

test('layers open and close through the stack', () => {
  const shell = read('assets/desk-shell.js');
  assert.match(shell, /PulsoBack\.push\('sheet', hideSheet\)/);
  assert.match(shell, /PulsoBack\.dismiss\('sheet'\)/);
  assert.match(shell, /PulsoBack\.push\('doc', hideDocument\)/);
  assert.doesNotMatch(shell, /event\.key === 'Escape'\) closeSheet/);

  const inbox = read('assets/inbox.js');
  assert.match(inbox, /Back\.push\('chat', hideThread, \{ url: Back\.withParam\('chat', phone\) \}\)/);
  assert.match(inbox, /Back\.dismiss\('chat'\)/);
  assert.match(inbox, /Back\.param\('chat'\)/);

  const bookingInbox = read('assets/booking-inbox.js');
  assert.match(bookingInbox, /Back\.push\('chat', hideThread/);
  assert.match(bookingInbox, /Back\.push\('viewer', hideViewer\)/);
  assert.match(bookingInbox, /Back\.push\('callsheet', hideSheet\)/);
  assert.doesNotMatch(bookingInbox, /event\.key === 'Escape'/);

  const providers = read('assets/dashboard.js');
  assert.match(providers, /Back\.push\('detail', hideMobileDetail, \{ url: Back\.withParam\('phone', provider\.phone\) \}\)/);
  assert.equal((providers.match(/Back\.drop\('detail'\)/g) || []).length, 2);

  const boards = read('assets/booking-dashboard.js');
  assert.match(boards, /Back\.push\(`detail-\$\{mode\}`, hideMobileDetail/);
  assert.match(boards, /Back\.dismiss\(`detail-\$\{mode\}`\)/);
  assert.match(boards, /sideParam === mode/);

  const support = read('assets/provider-support-dashboard.js');
  assert.match(support, /Back\.push\('detail', hideMobileDetail/);
  assert.match(support, /Back\.dismiss\('detail'\)/);

  const sides = read('assets/admin-sides.js');
  assert.match(sides, /history\.pushState\(\{ pulsoSide: side, sideDepth \}/);
  assert.match(sides, /PulsoBack\.setRoot\(/);
});

test('the service worker cache was bumped so old scripts are dropped', () => {
  assert.match(read('admin/sw.js'), /pulso-admin-v22/);
});
