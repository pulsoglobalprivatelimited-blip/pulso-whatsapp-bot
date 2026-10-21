'use strict';
// Block / unblock notice (founder, 21 Oct 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, sendProviderNotice } = require('../src/services/providerNotice');

function fakeDeps({ exists = true } = {}) {
  const calls = { sent: [], history: [] };
  return {
    calls,
    sendTemplate: async (to, name, lang, components) => { calls.sent.push({ to, name, lang, components }); return { messages: [{ id: 'wamid.X' }] }; },
    getProvider: async () => (exists ? { phone: '919876543210' } : null),
    appendHistory: async (phone, event) => { calls.history.push({ phone, event }); },
  };
}

test('sends the 90-day template with name and date, and logs it in her chat', async () => {
  const deps = fakeDeps();
  const r = await sendProviderNotice({ phone: '+91 98765 43210', templateName: 'provider_blocked_until', languageCode: 'ml', params: ['Jisha', '19 Jan 2027'], kind: 'block_until' }, deps);
  assert.equal(r.messageId, 'wamid.X');
  assert.deepEqual(deps.calls.sent[0], {
    to: '919876543210', name: 'provider_blocked_until', lang: 'ml',
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Jisha' }, { type: 'text', text: '19 Jan 2027' }] }],
  });
  assert.equal(deps.calls.history.length, 1);
  assert.equal(deps.calls.history[0].event.sender, 'pulso');
});

test('no bot record: sends but does not create one in the inbox', async () => {
  const deps = fakeDeps({ exists: false });
  await sendProviderNotice({ phone: '919876543210', templateName: 'provider_unblocked', languageCode: 'en', params: ['Jisha'] }, deps);
  assert.equal(deps.calls.sent.length, 1);
  assert.equal(deps.calls.history.length, 0);
});

test('refuses anything but the three notice templates, the two languages and the right values', () => {
  const ok = { phone: '919876543210', templateName: 'provider_blocked_permanent', languageCode: 'en', params: ['Jisha'] };
  assert.doesNotThrow(() => validate(ok));
  assert.throws(() => validate({ ...ok, templateName: 'caregiver_still_available' }), /unknown template/);
  assert.throws(() => validate({ ...ok, languageCode: 'hi' }), /unknown language/);
  assert.throws(() => validate({ ...ok, params: ['Jisha', 'extra'] }), /wrong template values/);
  assert.throws(() => validate({ ...ok, params: [''] }), /wrong template values/);
  assert.throws(() => validate({ ...ok, phone: '123' }), /phone is required/);
});

test('the founder\'s v2 wording of the 90-day block is allowed', () => {
  assert.doesNotThrow(() => validate({ phone: '919876543210', templateName: 'provider_blocked_until_v2', languageCode: 'ml', params: ['Jisha', '19 January'] }));
});
