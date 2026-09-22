'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* Approving a certificate sends the provider three things: the approval, the
   terms, and a pair of Accept / Decline buttons. Nothing used to stop that
   running twice, so a double-click on the desk — or a reviewer tapping the
   WhatsApp button again because the first tap looked like it did nothing — put
   a second set of terms in front of someone who had already accepted.

   The guard has to answer two questions at once, which is why it is worth
   pinning here: "has this been approved" and "did that approval actually send".
   Checking only the first would break re-approval after a rejection, where the
   verification from the first attempt is still sitting on the record. */

// require the module lazily: pulling in onboardingFlow costs a config load.
function guard() {
  return require('../src/services/onboardingFlow').hasAlreadyBeenApproved;
}

const approvedAndSent = {
  phone: '+919847021884',
  verification: { status: 'verified', reviewedBy: 'ops-team', reviewedAt: '2026-09-21T09:00:00.000Z' },
  termsSentAt: '2026-09-21T09:00:00.000Z'
};

test('a provider whose terms have already gone out is not approved again', () => {
  assert.equal(guard()(approvedAndSent), true);
});

test('a provider waiting for review is approved normally', () => {
  assert.equal(
    guard()({ phone: '+919847021884', verification: { status: 'pending' } }),
    false
  );
});

/* The case a naive `verification.status === 'verified'` check would break: the
   rejection leaves the earlier verification behind, and the fresh approval
   still has to reach the provider. */
test('re-approving after a rejection still sends', () => {
  assert.equal(
    guard()({
      phone: '+919847021884',
      verification: { status: 'rejected', reviewedBy: 'ops-team' },
      termsSentAt: '2026-09-20T09:00:00.000Z'
    }),
    false
  );
});

/* Verified but never sent — an approval that failed part-way through, or a
   record migrated in. It has to be allowed to send. */
test('verified with no terms sent is allowed to send', () => {
  assert.equal(guard()({ phone: '+919847021884', verification: { status: 'verified' } }), false);
});

test('missing or empty records never count as approved', () => {
  const alreadyApproved = guard();
  assert.equal(alreadyApproved(null), false);
  assert.equal(alreadyApproved(undefined), false);
  assert.equal(alreadyApproved({}), false);
  assert.equal(alreadyApproved({ phone: '+919847021884' }), false);
});
