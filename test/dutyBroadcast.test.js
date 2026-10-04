'use strict';
// Duty broadcast (founder, 4 Oct 2026): one template per caregiver, once per
// broadcast; "I'm interested" goes to ONE number only; STOP opts out.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.WHATSAPP_DRY_RUN = 'true';
process.env.DUTY_BROADCAST_ENABLED = 'true';
process.env.DUTY_INTEREST_PHONE = '918714105333';
process.env.OWNER_NOTIFICATION_PHONE = '919446600809';
process.env.NO_CERTIFICATE_REVIEWER_PHONE = '916238378859';
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';

// ---- a tiny in-memory Firestore ----
const store = new Map();
function deepMerge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v;
  }
  return out;
}
const fakeDb = {
  collection: (c) => ({
    doc: (id) => ({
      get: async () => { const v = store.get(`${c}/${id}`); return { exists: v !== undefined, data: () => v }; },
      set: async (v, opts) => { store.set(`${c}/${id}`, opts && opts.merge ? deepMerge(store.get(`${c}/${id}`), v) : v); }
    })
  })
};
const sent = [];
function stub(rel, impl) {
  const file = require.resolve(path.join('../src/services', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: new Proxy(impl, { get: (t, k) => (k in t ? t[k] : async () => null) }) };
}
stub('storage', { getFirestore: () => fakeDb });
stub('metaClient', {
  sendTemplate: async (to, name, lang, components) => { sent.push({ to, kind: 'template', name, lang, components }); return { messages: [{ id: 'w' }] }; },
  sendText: async (to, body) => { sent.push({ to, kind: 'text', body }); return { messages: [{ id: 'w' }] }; },
  sendButtons: async (to, body) => { sent.push({ to, kind: 'buttons', body }); return {}; },
  isAppMediaId: () => false
});

const bc = require('../src/services/dutyBroadcast');
const duty = { place: 'Kakkanad, Ernakulam', hours: '24h', startLabel: '6 Oct', days: 10, pay: 750 };
const tap = (payload) => ({ type: 'button', button: { payload } });

test('each caregiver gets one template in her language, with both reply payloads', async () => {
  store.set('providers/919000000801', { flowId: 'kerala_malayalam', fullName: 'Asha', district: 'Ernakulam' });
  store.set('providers/919000000802', { flowId: 'kerala_english', fullName: 'Bindu', district: 'Ernakulam' });
  sent.length = 0;
  const r = await bc.sendDutyBroadcast({
    broadcastId: 'REQ0001', duty, bookingLabel: "Amma Test's booking",
    recipients: [{ phone: '9000000801' }, { phone: '919000000802' }, { phone: '9000000801' }]
  });
  assert.equal(r.sent, 2);
  const t = sent.filter((m) => m.kind === 'template');
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((m) => m.lang).sort(), ['en', 'ml']);
  const ml = t.find((m) => m.lang === 'ml');
  assert.deepEqual(ml.components[0].parameters.map((p) => p.text), ['Kakkanad, Ernakulam', '24 മണിക്കൂർ', '6 Oct', '10', '750']);
  assert.equal(ml.components[1].parameters[0].payload, 'dutybc_interest_REQ0001');
  assert.equal(ml.components[2].parameters[0].payload, 'dutybc_notnow_REQ0001');
});

test('sending again skips everyone already sent', async () => {
  sent.length = 0;
  const r = await bc.sendDutyBroadcast({ broadcastId: 'REQ0001', duty, recipients: [{ phone: '919000000801' }, { phone: '919000000802' }] });
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 2);
  assert.equal(sent.length, 0);
});

test("I'm interested: she is thanked, and ONLY the interest number is told", async () => {
  sent.length = 0;
  assert.equal(await bc.handleDutyBroadcastReply('919000000801', tap('dutybc_interest_REQ0001')), true);
  assert.deepEqual([...new Set(sent.map((m) => m.to))].sort(), ['918714105333', '919000000801']);
  assert.ok(!sent.some((m) => ['919446600809', '916238378859'].includes(m.to)), 'no owner, no second reviewer');
  const toHer = sent.find((m) => m.to === '919000000801');
  assert.equal(toHer.body, 'നന്ദി. Pulso team ഉടൻ വിളിക്കും.');
  const toSanju = sent.find((m) => m.to === '918714105333');
  assert.equal(toSanju.kind, 'template');
  assert.deepEqual(toSanju.components[0].parameters.map((p) => p.text), ['Asha', '919000000801', 'Ernakulam', "Amma Test's booking, Kakkanad, Ernakulam"]);
  const status = await bc.getDutyBroadcastStatus('REQ0001');
  assert.equal(status.interested, 1);
});

test('a second tap on interested does not tell Sanju twice', async () => {
  sent.length = 0;
  await bc.handleDutyBroadcastReply('919000000801', tap('dutybc_interest_REQ0001'));
  assert.equal(sent.filter((m) => m.to === '918714105333').length, 0);
});

test('Not now is only noted: nothing is sent to anyone', async () => {
  sent.length = 0;
  await bc.handleDutyBroadcastReply('919000000802', tap('dutybc_notnow_REQ0001'));
  assert.equal(sent.length, 0);
  assert.equal((await bc.getDutyBroadcastStatus('REQ0001')).notNow, 1);
});

test('Send again to unanswered reaches only those with no answer, once', async () => {
  store.set('providers/919000000803', { flowId: 'kerala_malayalam', fullName: 'Chitra' });
  await bc.sendDutyBroadcast({ broadcastId: 'REQ0002', duty, recipients: [{ phone: '919000000801' }, { phone: '919000000803' }] });
  await bc.handleDutyBroadcastReply('919000000801', tap('dutybc_interest_REQ0002'));
  sent.length = 0;
  const r = await bc.sendDutyBroadcast({ broadcastId: 'REQ0002', duty, recipients: [{ phone: '919000000801' }, { phone: '919000000803' }], onlyUnanswered: true });
  assert.equal(r.sent, 1);
  assert.equal(sent[0].to, '919000000803');
  const again = await bc.sendDutyBroadcast({ broadcastId: 'REQ0002', duty, recipients: [{ phone: '919000000803' }], onlyUnanswered: true });
  assert.equal(again.sent, 0, 'one reminder at most');
});

test('typed words are forwarded to the interest number; STOP opts her out', async () => {
  sent.length = 0;
  assert.equal(await bc.handleDutyBroadcastReply('919000000803', { type: 'text', text: { body: 'What time should I come?' } }), false);
  assert.match(sent.find((m) => m.to === '918714105333').body, /What time should I come\?/);
  sent.length = 0;
  assert.equal(await bc.handleDutyBroadcastReply('919000000803', { type: 'text', text: { body: 'STOP' } }), true);
  const r = await bc.sendDutyBroadcast({ broadcastId: 'REQ0003', duty, recipients: [{ phone: '919000000803' }] });
  assert.equal(r.optedOut, 1);
  assert.equal(r.sent, 0);
});

test('someone with no broadcast is untouched (her chat goes on as normal)', async () => {
  sent.length = 0;
  assert.equal(await bc.handleDutyBroadcastReply('919000000899', { type: 'text', text: { body: 'hi' } }), false);
  assert.equal(sent.length, 0);
});

test('refuses to send before the templates are approved, and refuses a bad duty', async () => {
  const config = require('../src/config');
  config.dutyBroadcastEnabled = false;
  await assert.rejects(() => bc.sendDutyBroadcast({ broadcastId: 'REQ0004', duty, recipients: [] }), /not approved/);
  config.dutyBroadcastEnabled = true;
  await assert.rejects(() => bc.sendDutyBroadcast({ broadcastId: 'REQ0004', duty: { ...duty, hours: '12h' }, recipients: [] }), /24h or 8h/);
});
