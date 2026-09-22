'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { verifySignature, decideWebhook } = require('../src/services/webhookSignature');

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const BODY = Buffer.from(
  JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: '918086748323', type: 'text' }] } }] }]
  })
);

function sign(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

/* ---- the signature itself ---------------------------------------------- */

test('a delivery Meta actually signed is accepted', () => {
  const result = verifySignature(BODY, sign(BODY, SECRET), SECRET);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'valid');
});

test('a body changed after signing is rejected', () => {
  // The forgery this exists to stop: a real signature lifted off a real
  // delivery, pasted onto a body naming somebody else's number.
  const header = sign(BODY, SECRET);
  const tampered = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: '919999999999' }] } }] }] }));
  assert.equal(verifySignature(tampered, header, SECRET).ok, false);
});

test('a signature made with the wrong secret is rejected', () => {
  const result = verifySignature(BODY, sign(BODY, 'not-the-app-secret'), SECRET);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mismatch');
});

test('no signature header at all is rejected', () => {
  assert.equal(verifySignature(BODY, '', SECRET).reason, 'missing_header');
  assert.equal(verifySignature(BODY, undefined, SECRET).reason, 'missing_header');
});

test('a header that is not sha256 is rejected rather than trusted', () => {
  const sha1 = `sha1=${crypto.createHmac('sha1', SECRET).update(BODY).digest('hex')}`;
  assert.equal(verifySignature(BODY, sha1, SECRET).reason, 'unexpected_algorithm');
});

test('a digest that is not 64 hex characters never reaches timingSafeEqual', () => {
  // timingSafeEqual throws on length mismatch, and an uncaught throw inside the
  // webhook would be a 500 that Meta retries.
  assert.equal(verifySignature(BODY, 'sha256=abc', SECRET).reason, 'malformed_digest');
  assert.equal(verifySignature(BODY, `sha256=${'z'.repeat(64)}`, SECRET).reason, 'malformed_digest');
});

test('a case-different digest still matches, because hex has no case', () => {
  const header = sign(BODY, SECRET).toUpperCase().replace('SHA256=', 'sha256=');
  assert.equal(verifySignature(BODY, header, SECRET).ok, true);
});

test('an empty body is rejected rather than hashed to a constant', () => {
  assert.equal(verifySignature(Buffer.alloc(0), sign(BODY, SECRET), SECRET).reason, 'no_raw_body');
  assert.equal(verifySignature(undefined, sign(BODY, SECRET), SECRET).reason, 'no_raw_body');
});

/* ---- what the server does about it -------------------------------------- */

test('with no secret configured the webhook is left exactly as it was', () => {
  // The same rule the IVR webhook follows: an unconfigured guard does not lock
  // the door. This is what lets the check ship before the secret is set.
  const decision = decideWebhook(BODY, '', { secret: '', enforce: true });
  assert.equal(decision.action, 'allow');
  assert.equal(decision.reason, 'no_secret_configured');
});

test('while watching, a bad signature is let through and reported', () => {
  const decision = decideWebhook(BODY, sign(BODY, 'wrong'), { secret: SECRET, enforce: false });
  assert.equal(decision.action, 'observe');
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, 'mismatch');
});

test('while enforcing, a bad signature is rejected', () => {
  const decision = decideWebhook(BODY, sign(BODY, 'wrong'), { secret: SECRET, enforce: true });
  assert.equal(decision.action, 'reject');
});

test('a good signature passes whether we are watching or enforcing', () => {
  const header = sign(BODY, SECRET);
  [false, true].forEach((enforce) => {
    const decision = decideWebhook(BODY, header, { secret: SECRET, enforce });
    assert.equal(decision.action, 'allow');
    assert.equal(decision.ok, true);
  });
});

test('an unsigned request while enforcing is rejected, not observed', () => {
  // The plain case: somebody who found the URL and posted a Meta-shaped body.
  const decision = decideWebhook(BODY, '', { secret: SECRET, enforce: true });
  assert.equal(decision.action, 'reject');
  assert.equal(decision.reason, 'missing_header');
});
