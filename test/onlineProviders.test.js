'use strict';
// "Active providers (online now)" on the desk (founder, 7 Oct 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.PULSO_HUB_BOT_SYNC_URL = 'https://syncprovideronboardingfrombot-abc123-uc.a.run.app';
process.env.PULSO_HUB_BOT_SYNC_SECRET = 'shh';
const svc = require('../src/services/onlineProvidersService');

test('asks the hub function next to the sync one, with the shared secret, and caches a minute', async () => {
  svc.resetOnlineProvidersCache();
  assert.equal(svc.onlineUrl(), 'https://onlineProvidersFromBot-abc123-uc.a.run.app');
  const calls = [];
  const post = async (url, body, opts) => {
    calls.push({ url, secret: opts.headers['x-pulso-bot-secret'] });
    return { data: { ok: true, at: 1, phones: ['919000000801', '919000000802'] } };
  };
  const first = await svc.getOnlineProviderPhones({ now: 1000, post });
  assert.deepEqual(first.phones, ['919000000801', '919000000802']);
  assert.equal(calls[0].secret, 'shh');
  await svc.getOnlineProviderPhones({ now: 50000, post });
  assert.equal(calls.length, 1, 'within a minute: cached');
  await svc.getOnlineProviderPhones({ now: 62000, post });
  assert.equal(calls.length, 2, 'after a minute: asked again');
});

const root = path.join(__dirname, '..', 'src');
const dashboard = fs.readFileSync(path.join(root, 'public/assets/dashboard.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');

test('desk counts joined providers who are online, and shows a dash when the app cannot be reached', () => {
  const src = dashboard.match(/function isCompletedOnline\(provider\) \{[\s\S]*?\n\}/)[0];
  const make = (phones) => new Function('getDashboardStatus', 'onlinePhones', `${src}; return isCompletedOnline;`)(
    (p) => (p && p.termsAccepted ? 'completed' : 'pending'), phones);
  const fn = make(new Set(['919000000801']));
  assert.equal(fn({ phone: '919000000801', termsAccepted: true }), true);
  assert.equal(fn({ phone: '+91 90000 00801', termsAccepted: true }), true);
  assert.equal(fn({ phone: '919000000802', termsAccepted: true }), false);
  assert.equal(fn({ phone: '919000000801', termsAccepted: false }), false);
  assert.equal(make(null)({ phone: '919000000801', termsAccepted: true }), false);
  assert.match(dashboard, /onlinePhones \? metricProviders\.filter\(isCompletedOnline\)\.length : '–'/);
  const basic = html.indexOf('id="completed-basic-metric"');
  const online = html.indexOf('id="online-metric"');
  assert.ok(basic > 0 && online > basic);
  assert.match(html, /<label>Active providers \(online now\)<\/label>/);
});
