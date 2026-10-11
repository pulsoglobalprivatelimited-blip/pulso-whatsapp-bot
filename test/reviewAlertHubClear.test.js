'use strict';
// 11 Oct 2026: the hub kept showing "certificate waiting for review" after the
// reviewer had read and acted, because a delivery receipt never reached it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';

function stub(rel, impl) {
  const file = require.resolve(path.join('../src/services', rel));
  const fallback = async () => null;
  require.cache[file] = {
    id: file, filename: file, loaded: true,
    exports: new Proxy(impl, { get: (t, k) => (k in t ? t[k] : fallback) })
  };
}

const synced = [];
let outcome = null;
let stored = null;
stub('reviewAlertDelivery', { applyReviewAlertStatus: async () => outcome });
stub('storage', { getProvider: async () => stored, saveProvider: async () => null });
stub('pulsoHubSyncService', {
  syncProviderToPulsoHub: async (p) => { synced.push(p.phone); return { ok: true }; },
  reportCertificateReviewAlertFailure: async (p) => { synced.push('fail:' + p.phone); return { ok: true }; }
});

const { handleReviewAlertStatus } = require('../src/services/reviewAlertEscalation');

function reset(previousAlert) {
  synced.length = 0;
  stored = { phone: '918111063304', verification: { reviewAlert: { delivered: true, failed: false } } };
  outcome = {
    providerPhone: '918111063304',
    provider: { phone: '918111063304', verification: { reviewAlert: previousAlert } },
    becameFailed: false,
    becameDelivered: true
  };
}

test('a receipt for an alert the hub was told had failed clears it on the hub', async () => {
  reset({ failed: true, delivered: false, alertedAt: '2026-10-11T07:47:56.431Z' });
  await handleReviewAlertStatus({ id: 'w', status: 'read' });
  assert.deepEqual(synced, ['918111063304']);
});

test('a receipt for an alert the hub never heard about sends nothing', async () => {
  reset({ failed: false, delivered: false });
  await handleReviewAlertStatus({ id: 'w', status: 'delivered' });
  assert.deepEqual(synced, []);
});

test('a second receipt after delivery sends nothing more', async () => {
  reset({ failed: false, delivered: true, alertedAt: '2026-10-11T07:47:56.431Z' });
  outcome.becameDelivered = false;
  await handleReviewAlertStatus({ id: 'w', status: 'read' });
  assert.deepEqual(synced, []);
});
