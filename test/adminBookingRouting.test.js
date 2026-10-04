'use strict';
// Admin booking bot routing on the support number: the three admin phones get
// the booking chat on "booking"/"book" or an open draft; every other message,
// from them or anyone else, reaches the support chat exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.WHATSAPP_DRY_RUN = 'true';
process.env.PARTNER_HELP_ENABLED = 'false';
delete process.env.ADMIN_BOOKING_BOT_PHONES; // the defaults

// ---- a tiny in-memory Firestore and a recording Meta client ----
const docs = new Map();
const fakeDb = {
  collection: (c) => ({
    doc: (id) => ({
      get: async () => ({ exists: docs.has(`${c}/${id}`), data: () => docs.get(`${c}/${id}`) }),
      set: async (v, opts) => {
        docs.set(`${c}/${id}`, opts && opts.merge ? { ...(docs.get(`${c}/${id}`) || {}), ...v } : v);
      },
      delete: async () => docs.delete(`${c}/${id}`),
      collection: () => ({ add: async () => ({}) })
    })
  })
};
const supportSent = [];
function stub(rel, impl) {
  const file = require.resolve(path.join('../src/services', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: new Proxy(impl, { get: (t, k) => (k in t ? t[k] : async () => null) }) };
}
stub('storage', { getFirestore: () => fakeDb });
stub('metaClient', {
  sendText: async (to, body) => supportSent.push({ to, kind: 'text', body }),
  sendButtons: async (to, body) => supportSent.push({ to, kind: 'buttons', body }),
  sendList: async (to, body) => supportSent.push({ to, kind: 'list', body }),
  sendTemplate: async () => ({}),
  isAppMediaId: () => false
});

const adminBookingFlow = require('../src/services/adminBookingFlow');
const { processProviderSupportMessage } = require('../src/services/providerSupportFlow');

const hubCalls = [];
const bookingSent = [];
adminBookingFlow._setDefaultFlow(
  adminBookingFlow.createAdminBookingFlow({
    hub: {
      call: async (phone, action) => {
        hubCalls.push({ phone, action });
        if (action === 'whoami') return { ok: true, admin: { uid: 'u1', name: 'Anu' } };
        if (action === 'listAgencies') return { ok: true, agencies: [] };
        return { ok: false, message: 'not in this test' };
      }
    },
    store: adminBookingFlow.memoryDraftStore(),
    send: {
      text: async (to, body) => bookingSent.push({ to, body }),
      buttons: async (to, body) => bookingSent.push({ to, body }),
      list: async (to, body) => bookingSent.push({ to, body })
    }
  })
);

const text = (body) => ({ id: `m${Math.random()}`, type: 'text', text: { body } });

function reset() {
  supportSent.length = 0;
  bookingSent.length = 0;
  hubCalls.length = 0;
}

test('the admin list defaults to the three numbers, as 91XXXXXXXXXX', () => {
  const config = require('../src/config');
  assert.deepEqual(config.adminBookingBotPhones, ['8714105666', '9446600809', '7736108778']);
  assert.equal(adminBookingFlow.normalizePhone('8714105666'), '918714105666');
  assert.equal(adminBookingFlow.normalizePhone('+91 87141 05666'), '918714105666');
  assert.equal(adminBookingFlow.normalizePhone('08714105666'), '918714105666');
});

test('a caregiver typing "booking" gets the support chat, unchanged', async () => {
  reset();
  await processProviderSupportMessage('919000000001', text('booking'));
  assert.equal(hubCalls.length, 0);
  assert.equal(bookingSent.length, 0);
  assert.ok(supportSent.length > 0, 'the support chat answered');
  assert.ok(supportSent.every((m) => m.to === '919000000001'));
});

test('an admin without a draft who does not type the start word gets the support chat', async () => {
  reset();
  await processProviderSupportMessage('919446600809', text('hi'));
  assert.equal(hubCalls.length, 0);
  assert.equal(bookingSent.length, 0);
  assert.ok(supportSent.length > 0);
});

test('an admin typing "Book" gets the booking chat, and the support chat says nothing', async () => {
  reset();
  await processProviderSupportMessage('917736108778', text('Book'));
  assert.deepEqual(hubCalls.map((c) => c.action), ['whoami', 'listAgencies']);
  assert.equal(hubCalls[0].phone, '917736108778');
  assert.equal(supportSent.length, 0);
  assert.match(bookingSent[0].body, /^New booking\. Which agency is it for\?/);

  // With the draft open, the next message stays in the booking chat.
  reset();
  await processProviderSupportMessage('917736108778', text('grace'));
  assert.equal(supportSent.length, 0);
  assert.deepEqual(hubCalls.map((c) => c.action), ['listAgencies']);

  // Cancel closes it; after that the support chat answers again.
  reset();
  await processProviderSupportMessage('917736108778', text('cancel'));
  assert.equal(bookingSent[0].body, 'Booking cancelled. Type booking to start again.');
  reset();
  await processProviderSupportMessage('917736108778', text('hi'));
  assert.equal(bookingSent.length, 0);
  assert.ok(supportSent.length > 0);
});
