'use strict';
// The admin booking bot's Pulso Hub client: the URL follows the sync URL (with
// the function's real, case-sensitive name), the secret goes in the header,
// and a business refusal comes back as data, not as an exception.
const test = require('node:test');
const assert = require('node:assert/strict');

const HUB = 'https://us-central1-pulso-hub.cloudfunctions.net';

function loadClient(env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/adminBookingHubClient')];
  const client = require('../src/services/adminBookingHubClient');
  return {
    client,
    restore() {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      delete require.cache[require.resolve('../src/config')];
      delete require.cache[require.resolve('../src/services/adminBookingHubClient')];
    }
  };
}

test('the URL is derived from the sync URL, keeping adminBookingFromBot as deployed', () => {
  const { client, restore } = loadClient({
    PULSO_HUB_ADMIN_BOOKING_URL: undefined,
    PULSO_HUB_BOT_SYNC_URL: `${HUB}/syncProviderOnboardingFromBot`
  });
  try {
    assert.equal(client.adminBookingUrl(), `${HUB}/adminBookingFromBot`);
  } finally {
    restore();
  }
});

test('an explicit URL wins', () => {
  const { client, restore } = loadClient({
    PULSO_HUB_ADMIN_BOOKING_URL: 'https://adminbookingfrombot-abc.a.run.app',
    PULSO_HUB_BOT_SYNC_URL: `${HUB}/syncProviderOnboardingFromBot`
  });
  try {
    assert.equal(client.adminBookingUrl(), 'https://adminbookingfrombot-abc.a.run.app');
  } finally {
    restore();
  }
});

test('posts { adminPhone, action, data } with the secret and a 20 s timeout; ok:false is returned', async () => {
  const { client, restore } = loadClient({
    PULSO_HUB_ADMIN_BOOKING_URL: undefined,
    PULSO_HUB_BOT_SYNC_URL: `${HUB}/syncProviderOnboardingFromBot`,
    PULSO_HUB_BOT_SYNC_SECRET: 'shh'
  });
  try {
    const posts = [];
    const post = async (url, body, options) => {
      posts.push({ url, body, options });
      return { data: { ok: false, error: 'agency_blocked', message: 'This agency is blocked.' } };
    };
    const result = await client.callAdminBooking('919446600809', 'create', { days: 10 }, { post });
    assert.deepEqual(result, { ok: false, error: 'agency_blocked', message: 'This agency is blocked.' });
    assert.equal(posts[0].url, `${HUB}/adminBookingFromBot`);
    assert.deepEqual(posts[0].body, { adminPhone: '919446600809', action: 'create', data: { days: 10 } });
    assert.equal(posts[0].options.headers['x-pulso-bot-secret'], 'shh');
    assert.equal(posts[0].options.timeout, 20000);
  } finally {
    restore();
  }
});

test('a transport failure throws; not configured throws 503', async () => {
  let { client, restore } = loadClient({
    PULSO_HUB_ADMIN_BOOKING_URL: undefined,
    PULSO_HUB_BOT_SYNC_URL: `${HUB}/syncProviderOnboardingFromBot`,
    PULSO_HUB_BOT_SYNC_SECRET: 'shh'
  });
  try {
    const post = async () => {
      const e = new Error('timeout of 20000ms exceeded');
      throw e;
    };
    await assert.rejects(client.callAdminBooking('919446600809', 'whoami', {}, { post }), /timeout/);
  } finally {
    restore();
  }
  ({ client, restore } = loadClient({ PULSO_HUB_ADMIN_BOOKING_URL: undefined, PULSO_HUB_BOT_SYNC_URL: undefined, PULSO_HUB_BOT_SYNC_SECRET: 'shh' }));
  try {
    await assert.rejects(client.callAdminBooking('919446600809', 'whoami', {}, { post: async () => ({}) }), (e) => e.statusCode === 503);
  } finally {
    restore();
  }
});
