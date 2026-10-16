const test = require('node:test');
const assert = require('node:assert');
const { channelInviteText, shouldSendChannelInvite, DEFAULT_CHANNEL_URL } = require('../src/services/channelInvite');

test('invite carries the channel link in Malayalam and English', () => {
  const t = channelInviteText();
  assert.ok(t.includes(DEFAULT_CHANNEL_URL));
  assert.match(t, /ഡ്യൂട്ടി ചാനൽ/);
  assert.match(t, /Follow the Pulso duty channel/);
});

test('Kerala only, and only once', () => {
  assert.strictEqual(shouldSendChannelInvite({ region: 'kerala' }), true);
  assert.strictEqual(shouldSendChannelInvite({}), true);
  assert.strictEqual(shouldSendChannelInvite({ region: 'karnataka' }), false);
  assert.strictEqual(shouldSendChannelInvite({ region: 'kerala', channelInviteSentAt: '2026-10-17T00:00:00Z' }), false);
});
