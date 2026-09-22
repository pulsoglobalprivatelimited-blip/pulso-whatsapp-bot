/* Is this webhook really from Meta?

   `POST /webhook` used to act on anything posted to it. The callback URL is a
   conventional path on a public host and is printed in the service's own
   status output, so it is not a secret — which meant anyone holding it could
   post a Meta-shaped body and have the bot believe it. `message.from` is taken
   at face value, so that is enough to impersonate any caregiver, to fill the
   review queue with people who do not exist, and — the one that actually costs
   something — to make Pulso's own WhatsApp number send a real reply to any
   number they cared to name. Meta treats that as spam, and the number the ads
   point at is the one that gets restricted.

   Meta already signs every delivery: `X-Hub-Signature-256: sha256=<hex>`, an
   HMAC-SHA256 of the exact request body keyed on the app secret. Checking it
   costs a hash. The whole trick is having the raw bytes to hash — see the
   `verify` hook on express.json in server.js, because a parsed-and-restringified
   body is not the same bytes and will never match.

   Deliberately DOM-free of Express: it takes a header and a buffer and answers
   a question, so it can be tested without standing up a server. */

const crypto = require('crypto');

const HEADER = 'x-hub-signature-256';
const PREFIX = 'sha256=';

/**
 * @param {Buffer} rawBody   exactly the bytes Meta sent
 * @param {string} header    the X-Hub-Signature-256 value
 * @param {string} secret    the Meta app secret
 * @returns {{ ok: boolean, reason: string }}
 *   `reason` is for the log, never for the response: telling an unauthenticated
 *   caller which part of their forgery was wrong is free help.
 */
function verifySignature(rawBody, header, secret) {
  if (!secret) {
    return { ok: false, reason: 'no_secret_configured' };
  }

  if (!Buffer.isBuffer(rawBody) || !rawBody.length) {
    return { ok: false, reason: 'no_raw_body' };
  }

  const provided = String(header || '').trim();
  if (!provided) {
    return { ok: false, reason: 'missing_header' };
  }

  if (!provided.startsWith(PREFIX)) {
    return { ok: false, reason: 'unexpected_algorithm' };
  }

  const providedDigest = provided.slice(PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(providedDigest)) {
    return { ok: false, reason: 'malformed_digest' };
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  /* Both are 64 hex characters by the time we get here, so the buffers are
     always the same length and timingSafeEqual cannot throw. Comparing with
     === would leak, byte by byte, how much of a guess was right. */
  const ok = crypto.timingSafeEqual(
    Buffer.from(providedDigest.toLowerCase(), 'hex'),
    Buffer.from(expected, 'hex')
  );

  return ok ? { ok: true, reason: 'valid' } : { ok: false, reason: 'mismatch' };
}

/**
 * The decision, given how the service is configured.
 *
 * Three outcomes, not two:
 *   allow     it checked out, or there is nothing to check with
 *   observe   it failed, but we are only watching — let it through and say so
 *   reject    it failed and we are enforcing
 *
 * `observe` is what makes this safe to deploy. A wrong secret that rejected
 * everything would take the bot silent, and nobody would know until caregivers
 * stopped being answered, so the check is shipped watching first and switched
 * to enforcing once real Meta traffic has been seen to pass.
 *
 * When no secret is set at all the request is allowed — the same rule the IVR
 * webhook already follows, so adding this file changes nothing until someone
 * configures it.
 */
function decideWebhook(rawBody, header, options) {
  const settings = options || {};
  const secret = settings.secret || '';
  const enforce = Boolean(settings.enforce);

  if (!secret) {
    return { action: 'allow', reason: 'no_secret_configured', ok: false };
  }

  const result = verifySignature(rawBody, header, secret);
  if (result.ok) {
    return { action: 'allow', reason: result.reason, ok: true };
  }

  return { action: enforce ? 'reject' : 'observe', reason: result.reason, ok: false };
}

module.exports = { HEADER, PREFIX, verifySignature, decideWebhook };
