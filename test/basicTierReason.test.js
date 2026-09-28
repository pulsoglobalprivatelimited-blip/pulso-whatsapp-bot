'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* Why someone is on the Basic rate is recorded, not inferred, for two reasons.
   The sentence she reads before accepting the terms depends on it — a nurse
   must never be told she has no course certificate. And if the age on file is
   a typo, this is the only record of what the decision was actually made on. */

const { normalizeBasicTierReasons, BASIC_TIER_REASONS } = require('../src/services/onboardingFlow');

test('the two reasons are the only two, and both can be true at once', () => {
  assert.deepEqual(BASIC_TIER_REASONS, ['age_over_threshold', 'no_course_certificate']);
  assert.deepEqual(
    normalizeBasicTierReasons(['age_over_threshold', 'no_course_certificate']),
    ['age_over_threshold', 'no_course_certificate'],
    'over the age and holding no course certificate is one person, not two'
  );
});

test('a single reason may be passed bare, as the WhatsApp buttons send it', () => {
  assert.deepEqual(normalizeBasicTierReasons('age_over_threshold'), ['age_over_threshold']);
  assert.deepEqual(normalizeBasicTierReasons(['AGE_OVER_THRESHOLD']), ['age_over_threshold']);
});

test('anything that is not a reason is dropped rather than stored', () => {
  // A reason nobody recognises is worse than none: it reads as an explanation
  // on the record while explaining nothing.
  assert.deepEqual(normalizeBasicTierReasons(['nonsense', 'no_course_certificate']), ['no_course_certificate']);
  assert.deepEqual(normalizeBasicTierReasons(['', null, undefined, 0, {}]), []);
});

test('repeats collapse, so a double tap does not record the reason twice', () => {
  assert.deepEqual(
    normalizeBasicTierReasons(['age_over_threshold', 'age_over_threshold']),
    ['age_over_threshold']
  );
});

test('nothing given is nothing stored', () => {
  for (const empty of [null, undefined, [], '']) {
    assert.deepEqual(normalizeBasicTierReasons(empty), [], String(empty));
  }
});
