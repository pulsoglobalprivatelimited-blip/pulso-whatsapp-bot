'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* The review URL is derived from the sync URL, and the cloudfunctions.net path
   is case-sensitive: a lowercased function name there is a silent 404 that the
   inbox shows as "Request failed with status code 404" on the View button. */
const HUB = 'https://us-central1-pulso-hub.cloudfunctions.net';

function loadReviewUrl(env) {
  const saved = {};
  Object.keys(env).forEach((key) => {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  });
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/partnerReviewService')];
  try {
    return require('../src/services/partnerReviewService').reviewUrl();
  } finally {
    Object.keys(saved).forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/services/partnerReviewService')];
  }
}

test('the derived review URL keeps the function name exactly as deployed', () => {
  const url = loadReviewUrl({
    PULSO_HUB_PARTNER_REVIEW_URL: undefined,
    PULSO_HUB_BOT_SYNC_URL: `${HUB}/syncProviderOnboardingFromBot`
  });
  assert.equal(url, `${HUB}/partnerReviewFromBot`);
});

test('an explicit review URL wins over the derived one', () => {
  const url = loadReviewUrl({
    PULSO_HUB_PARTNER_REVIEW_URL: `${HUB}/partnerReviewFromBot`,
    PULSO_HUB_BOT_SYNC_URL: `${HUB}/syncProviderOnboardingFromBot`
  });
  assert.equal(url, `${HUB}/partnerReviewFromBot`);
});

test('no sync URL means no review URL, so the route answers not-configured', () => {
  const url = loadReviewUrl({
    PULSO_HUB_PARTNER_REVIEW_URL: undefined,
    PULSO_HUB_BOT_SYNC_URL: undefined
  });
  assert.equal(url, '');
});
