'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* Undo exists because approving is one click and the qualification pre-fills,
   so an approval can happen before anyone has decided anything. But it must
   refuse in the two states where rolling the record back would make things
   worse rather than better.

   Once someone accepts the terms, pulso-hub has created their partner account
   and an app login. Reverting here would leave those in place while this desk
   claimed the person was still waiting for review — a lie about somebody who
   is already working. Undo is for a mistake caught in the minutes after it was
   made, not a way to reverse onboarding. */
function guard() {
  return require('../src/services/onboardingFlow').blockUndoReason;
}

const approved = {
  phone: '+918606614839',
  status: 'awaiting_terms_acceptance',
  verification: { status: 'verified', reviewedBy: 'admin' }
};

test('an approved provider who has not accepted yet can be undone', () => {
  assert.equal(guard()(approved), '');
});

test('a provider still awaiting review has nothing to undo', () => {
  const reason = guard()({ ...approved, verification: { status: 'pending' } });
  assert.match(reason, /not approved/i);
});

test('a rejected provider has nothing to undo either', () => {
  assert.notEqual(guard()({ ...approved, verification: { status: 'rejected' } }), '');
});

/* The two that matter. */
test('refuses once the terms have been accepted', () => {
  const reason = guard()({ ...approved, termsAccepted: true });
  assert.match(reason, /already accepted the terms/i);
});

test('refuses once onboarding is complete', () => {
  const reason = guard()({ ...approved, status: 'completed', termsAccepted: false });
  assert.match(reason, /already completed/i);
});

test('a missing provider is reported, not treated as undoable', () => {
  assert.match(guard()(null), /not found/i);
});

/* Whatever it refuses, it says why: the reason goes back to the desk and is
   the only thing telling a reviewer their click did nothing. */
test('every refusal carries a sentence a reviewer can read', () => {
  const blocked = guard();
  for (const provider of [
    null,
    { ...approved, verification: { status: 'pending' } },
    { ...approved, termsAccepted: true },
    { ...approved, status: 'completed' }
  ]) {
    const reason = blocked(provider);
    assert.ok(reason.length > 10, `too terse: "${reason}"`);
  }
});
