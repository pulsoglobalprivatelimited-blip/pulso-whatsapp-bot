'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://whatsapp.pulso.co.in';

const { compareProvidersByName } = require('../src/services/vcardService');
const { buildProviderContactLink } = require('../src/services/opsNotifications');

/* ---- the bulk file's ordering ----------------------------------------- */

// Two of 491 completed providers never gave a name. Their cards are just a
// phone number, and an empty string sorts first - so the file opened with the
// two least useful entries.
test('a provider with no name sorts after everyone who has one', () => {
  const named = { fullName: 'Abraham Jose' };
  const nameless = { fullName: '' };
  assert.ok(compareProvidersByName(named, nameless) < 0);
  assert.ok(compareProvidersByName(nameless, named) > 0);
});

test('a whitespace-only name counts as no name, not as a name that sorts first', () => {
  assert.ok(compareProvidersByName({ fullName: '   ' }, { fullName: 'Adarsh au' }) > 0);
});

test('two named providers still sort alphabetically', () => {
  assert.ok(compareProvidersByName({ fullName: 'Abraham Jose' }, { fullName: 'Adarsh au' }) < 0);
  assert.ok(compareProvidersByName({ fullName: 'Zara K' }, { fullName: 'Adarsh au' }) > 0);
});

test('two nameless providers compare equal rather than flapping', () => {
  assert.equal(compareProvidersByName({ fullName: '' }, { fullName: '' }), 0);
});

test('a whole list puts the nameless at the very end', () => {
  const list = [
    { fullName: '' },
    { fullName: 'Adarsh au' },
    { fullName: '' },
    { fullName: 'Abraham Jose' },
  ];
  const sorted = [...list].sort(compareProvidersByName).map((p) => p.fullName);
  assert.deepEqual(sorted, ['Abraham Jose', 'Adarsh au', '', '']);
});

test('a missing or malformed provider does not throw the sort', () => {
  assert.doesNotThrow(() => [null, { fullName: 'A' }, undefined, {}].sort(compareProvidersByName));
});

/* ---- the link in the completion alert ---------------------------------- */

test('the link points at the contact file for that provider', () => {
  assert.equal(
    buildProviderContactLink('919746185168'),
    'https://whatsapp.pulso.co.in/admin/providers/919746185168/contact.vcf'
  );
});

// Every stored phone is already in full international form - 486 of 491 are 12
// digits, the other 5 are Gulf numbers at 11 - so the link only ever has to pass
// the stored value through, stripped of any formatting, for getProvider to find
// the same record the alert is about.
test('formatting is stripped and the stored number passes through unchanged', () => {
  assert.equal(
    buildProviderContactLink('+91 97461 85168'),
    'https://whatsapp.pulso.co.in/admin/providers/919746185168/contact.vcf'
  );
  assert.equal(
    buildProviderContactLink('97156473475'),
    'https://whatsapp.pulso.co.in/admin/providers/97156473475/contact.vcf'
  );
});

// Better no link than a dead one: a reviewer who taps a broken URL learns
// nothing, and trusts the next alert less.
test('no phone means no link at all', () => {
  assert.equal(buildProviderContactLink(''), null);
  assert.equal(buildProviderContactLink(null), null);
});

test('a base url with a trailing slash does not produce a double slash', () => {
  const saved = process.env.PUBLIC_BASE_URL;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/opsNotifications')];
  process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in/';
  const ops = require('../src/services/opsNotifications');
  assert.equal(
    ops.buildProviderContactLink('919746185168'),
    'https://whatsapp.pulso.co.in/admin/providers/919746185168/contact.vcf'
  );
  process.env.PUBLIC_BASE_URL = saved;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/opsNotifications')];
});
