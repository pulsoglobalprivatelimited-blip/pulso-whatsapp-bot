'use strict';
// The support number's routing with care coordinator requests in place
// (docs/coordinator_booking_request_plan.md): the coordinators' "request", the
// reviewers' note buttons (before the calling bot), the admin bot's "booking",
// and everyone else's support chat exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.WHATSAPP_DRY_RUN = 'true';
process.env.PARTNER_HELP_ENABLED = 'false';
delete process.env.ADMIN_BOOKING_BOT_PHONES;
delete process.env.COORDINATOR_PHONES;
delete process.env.COORDINATOR_REVIEWER_PHONES;
delete process.env.AGENCY_CALL_BOT_PHONES;

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
  sendContacts: async (to) => supportSent.push({ to, kind: 'contacts' }),
  sendTemplate: async () => ({}),
  isAppMediaId: () => false
});

// The calling bot, reduced to its trigger: it takes "call" (priority) and
// nothing else. Its own routing is in agencyCallRouting.test.js.
const callBotTurns = [];
stub('agencyCallService', {
  maybeHandleAgencyCall: async (phone, message) => {
    const said = message && message.text && message.text.body;
    if (said !== 'call') return false;
    callBotTurns.push(phone);
    return true;
  }
});

const adminBooking = require('../src/services/adminBookingFlow');
const coord = require('../src/services/coordinatorRequestFlow');
const { processProviderSupportMessage } = require('../src/services/providerSupportFlow');

const hubCalls = [];
const botSent = [];
const send = {
  text: async (to, body) => botSent.push({ to, body }),
  buttons: async (to, body, buttons) => botSent.push({ to, body, buttons }),
  list: async (to, body) => botSent.push({ to, body }),
  template: async (to, name) => botSent.push({ to, template: name })
};
const hub = {
  call: async (phone, action) => {
    hubCalls.push({ phone, action });
    if (action === 'whoami') {
      return phone === '916238378859'
        ? { ok: true, role: 'coordinator', coordinator: { name: 'Afiq' } }
        : { ok: true, role: 'admin', admin: { uid: 'u1', name: 'Anu' } };
    }
    if (action === 'listAgencies') return { ok: true, agencies: [] };
    return { ok: false, message: 'not in this test' };
  }
};
const adminFlow = adminBooking.createAdminBookingFlow({ hub, store: adminBooking.memoryDraftStore(), send });
adminBooking._setDefaultFlow(adminFlow);
const requests = coord.memoryRequestStore();
coord._setDefault(
  coord.createCoordinatorRequests({
    hub,
    send,
    adminFlow,
    requests,
    chats: coord.memoryChatStore(),
    draftStore: adminBooking.memoryDraftStore()
  })
);

const text = (body) => ({ id: `m${Math.random()}`, type: 'text', text: { body } });
const btn = (id) => ({ id: `m${Math.random()}`, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });

function reset() {
  supportSent.length = 0;
  botSent.length = 0;
  hubCalls.length = 0;
}

test('the defaults: coordinators 7736108778 and 6238378859; reviewers 9446600809, 8714105666, 7736108778; template off', () => {
  const config = require('../src/config');
  assert.deepEqual(config.coordinatorPhones, ['7736108778', '6238378859']);
  assert.deepEqual(config.coordinatorReviewerPhones, ['9446600809', '8714105666', '7736108778']);
  assert.equal(config.coordinatorReviewTemplateEnabled, false);
  assert.equal(config.coordinatorReviewTemplateName, 'coordinator_booking_review');
});

test('a caregiver typing "request" or tapping a request button gets the support chat, unchanged', async () => {
  reset();
  await processProviderSupportMessage('919000000001', text('request'));
  await processProviderSupportMessage('919000000001', btn('coordreq_book_R-1001'));
  assert.equal(hubCalls.length, 0);
  assert.equal(botSent.length, 0);
  assert.ok(supportSent.length > 0);
  assert.equal([...docs.keys()].filter((k) => k.startsWith('coordinator')).length, 0, 'nothing read or written for her');
});

test('Afiq: "request" opens the request chat; "booking" and "hi" reach the support chat', async () => {
  reset();
  await processProviderSupportMessage('916238378859', text('Request'));
  assert.deepEqual(hubCalls.map((c) => c.action), ['whoami', 'listAgencies']);
  assert.match(botSent[0].body, /^New booking request\./);
  assert.equal(supportSent.length, 0);
  reset();
  await processProviderSupportMessage('916238378859', text('cancel'));
  assert.equal(botSent[0].body, 'Request cancelled. Type request to start again.');
  reset();
  await processProviderSupportMessage('916238378859', text('booking'));
  assert.equal(hubCalls.length, 0);
  assert.ok(supportSent.length > 0);
});

test('an admin who is not a coordinator: "booking" as before, "request" is the support chat', async () => {
  reset();
  await processProviderSupportMessage('919446600809', text('booking'));
  assert.match(botSent[0].body, /^New booking\. Which agency/);
  await processProviderSupportMessage('919446600809', text('cancel'));
  reset();
  await processProviderSupportMessage('919446600809', text('request'));
  assert.equal(botSent.length, 0);
  assert.ok(supportSent.length > 0);
});

test('7736108778: "request" and "booking" each open their own chat; "call" still reaches the calling bot', async () => {
  reset();
  await processProviderSupportMessage('917736108778', text('request'));
  assert.match(botSent[0].body, /^New booking request\./);
  reset();
  await processProviderSupportMessage('917736108778', text('booking'));
  assert.match(botSent[0].body, /^New booking\. Which agency/);
  reset();
  await processProviderSupportMessage('917736108778', text('call'));
  assert.equal(botSent.length, 0, 'neither booking chat answered "call"');
  assert.deepEqual(callBotTurns, ['917736108778'], 'the calling bot answered');
  await processProviderSupportMessage('917736108778', text('cancel'));
});

test('a reviewer\'s tap on a request note is answered before any other bot', async () => {
  requests.docs.set('R-1001', { id: 'R-1001', status: 'rejected', rejectedBy: '918714105666', rejectedAtMillis: Date.UTC(2026, 9, 6, 10, 42), coordinatorPhone: '916238378859', answers: {}, thread: [] });
  reset();
  await processProviderSupportMessage('919446600809', btn('coordreq_book_R-1001'));
  assert.deepEqual(botSent.map((m) => m.body), ['R-1001: already rejected by 8714105666 at 4:12 pm, 6 Oct.']);
  assert.equal(supportSent.length, 0);
});
