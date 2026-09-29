'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// These tests must never reach Google: a save with real credentials creates a
// real contact in the ops phone book. dotenv does not override a variable that
// is already set, so blanking them here beats whatever a local .env holds.
process.env.GOOGLE_CONTACTS_CLIENT_ID = '';
process.env.GOOGLE_CONTACTS_CLIENT_SECRET = '';
process.env.GOOGLE_CONTACTS_REFRESH_TOKEN = '';

const contacts = require('../src/services/googleContactsService');

// Shaped from a real completed provider, so the assertions below describe what
// production actually stores rather than a convenient invention.
const provider = {
  fullName: 'Jisna varghese',
  phone: '919074490963',
  district: 'Ernakulam',
  region: 'kerala',
  sex: 'Female',
  qualification: 'gda',
  dutyHourPreference: '8_hour',
};

test('an 8-hour provider is prefixed P8', () => {
  assert.equal(
    contacts.buildContactName(provider),
    'P8 Jisna varghese GDA Female Ernakulam'
  );
});

test('a 24-hour provider is prefixed P24', () => {
  assert.equal(
    contacts.buildContactName({ ...provider, dutyHourPreference: '24_hour' }),
    'P24 Jisna varghese GDA Female Ernakulam'
  );
});

// The largest group, and the ops phone already had a convention for it: P24&8,
// on 169 hand-entered contacts. Inventing a different one would have split the
// biggest cohort away from the entries already in the phone book.
test('a provider marked both uses the P24&8 the team already uses', () => {
  const name = contacts.buildContactName({ ...provider, dutyHourPreference: 'both' });
  assert.equal(name, 'P24&8 Jisna varghese GDA Female Ernakulam');
  assert.ok(name.startsWith('P24&8'));
});

test('an unknown or missing duty gets no prefix rather than a wrong one', () => {
  assert.equal(
    contacts.buildContactName({ ...provider, dutyHourPreference: '' }),
    'Jisna varghese GDA Female Ernakulam'
  );
  assert.equal(
    contacts.buildContactName({ ...provider, dutyHourPreference: 'weekends' }),
    'Jisna varghese GDA Female Ernakulam'
  );
});

test('a stored 12-digit number becomes dialable, and a 10-digit one gains +91', () => {
  assert.equal(contacts.formatContactPhone('919074490963'), '+91 90744 90963');
  assert.equal(contacts.formatContactPhone('7034894494'), '+91 70348 94494');
});

// Eight completed providers have Gulf numbers. Forcing +91 onto them would make
// every one of those contacts undialable.
test('a non-Indian number keeps its own country code', () => {
  assert.equal(contacts.formatContactPhone('971564734754'), '+971564734754');
  assert.equal(contacts.formatContactPhone(''), '');
});

test('the address reads district then state', () => {
  assert.equal(contacts.buildContactAddress(provider), 'Ernakulam, Kerala');
  assert.equal(
    contacts.buildContactAddress({ ...provider, region: 'karnataka', district: 'Bengaluru Urban' }),
    'Bengaluru Urban, Karnataka'
  );
});

test('an unrecognised region is left off rather than guessed', () => {
  assert.equal(contacts.buildContactAddress({ ...provider, region: 'goa' }), 'Ernakulam');
});

test('a genuine long name is not truncated', () => {
  const { name, truncated } = contacts.sanitizeFullName('Aneena Treesa Jacob p i');
  assert.equal(name, 'Aneena Treesa Jacob p i');
  assert.equal(truncated, false);
});

// One provider answered the name question with a sentence containing a newline
// and a second phone number. A newline in a contact name splits it across lines.
test('a sentence typed into the name field is collapsed and capped', () => {
  const typed = 'Name : Y jenifer \nContact no : +91 76950 20439';
  const { name, truncated } = contacts.sanitizeFullName(typed);
  assert.ok(!name.includes('\n'));
  assert.ok(name.length <= 41);
  assert.equal(truncated, true);
});

test('a truncated name is preserved in full in the notes', () => {
  const typed = 'Pdf ente kayil ippol illa next day l will send you';
  const notes = contacts.buildContactNotes({ ...provider, fullName: typed });
  assert.ok(notes.includes(`Typed name: ${typed}`));
});

test('a name that fits leaves no Typed name note behind', () => {
  assert.equal(contacts.buildContactNotes(provider), 'Female · Duty: 8 hour');
});

test('a nameless provider falls back to the phone number, never blank', () => {
  assert.equal(
    contacts.buildContactName({ ...provider, fullName: '' }),
    'P8 +91 90744 90963 GDA Female Ernakulam'
  );
  assert.equal(contacts.buildContactName({ dutyHourPreference: 'both' }), 'P24&8 Pulso provider');
});

// The name uses the team's shorthand; the card's own job-title field keeps the
// formal wording, so nothing is lost by matching the phone book.
test('the name uses the short qualification, the org title the formal one', () => {
  const p = { ...provider, qualification: 'bsc_nursing', dutyHourPreference: '24_hour' };
  assert.equal(contacts.buildContactName(p), 'P24 Jisna varghese Nurse Female Ernakulam');
  assert.equal(contacts.buildProviderContactBody(p).organizations[0].title, 'BSc Nursing');
  assert.equal(contacts.qualificationShort('other_caregiving'), 'Caregiver');
});

test('the People API body carries name, mobile, org, address and notes', () => {
  const body = contacts.buildProviderContactBody({ ...provider, dutyHourPreference: 'both' });
  assert.equal(
    body.names[0].givenName,
    'P24&8 Jisna varghese GDA Female Ernakulam'
  );
  assert.equal(body.phoneNumbers[0].value, '+91 90744 90963');
  assert.equal(body.phoneNumbers[0].type, 'mobile');
  assert.equal(body.organizations[0].name, 'Pulso');
  assert.equal(body.organizations[0].title, 'GDA');
  assert.equal(body.addresses[0].formattedValue, 'Ernakulam, Kerala');
  assert.equal(body.biographies[0].value, 'Female · Duty: 24 hour or 8 hour');
});

test('an unknown qualification leaves the org title off instead of printing a slug', () => {
  const body = contacts.buildProviderContactBody({ ...provider, qualification: 'physiotherapy' });
  assert.equal(body.organizations[0].name, 'Pulso');
  assert.equal(body.organizations[0].title, undefined);
});

// A failure here must read as skipped, never throw: the caller runs inside a
// finished onboarding, and a missing contact cannot undo a completed signup.
test('with no credentials the save skips quietly instead of throwing', async () => {
  const result = await contacts.saveProviderContact(provider);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'missing_contacts_configuration');
});

test('a provider without a phone is skipped', async () => {
  const result = await contacts.saveProviderContact({ fullName: 'No Phone' });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'missing_provider');
});

// Re-running the backfill must not leave ops with two entries per caregiver.
test('a provider already saved is never created a second time', async () => {
  const result = await contacts.saveProviderContact({
    ...provider,
    contactSync: { resourceName: 'people/c123' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'already_saved');
  assert.equal(result.resourceName, 'people/c123');
});

/* ---- not creating what the phone book already has ------------------------ */

// The ops account held 644 hand-typed contacts before the first backfill, and
// 460 of the 507 completed providers were among them. Every one of these would
// have been created a second time.
test('the three spellings of one number share a key', () => {
  assert.equal(contacts.phoneKey('919746185168'), '9746185168');
  assert.equal(contacts.phoneKey('+91 97461 85168'), '9746185168');
  assert.equal(contacts.phoneKey('+919746185168'), '9746185168');
  assert.equal(contacts.phoneKey('9746185168'), '9746185168');
});

test('a Gulf number keeps enough digits to stay distinct', () => {
  assert.equal(contacts.phoneKey('97156473475'), '7156473475');
  assert.equal(contacts.phoneKey(''), '');
  assert.equal(contacts.phoneKey(null), '');
});

test('the account index is keyed by every number a person has', () => {
  const index = contacts.indexConnectionsByPhone([
    {
      resourceName: 'people/c1',
      names: [{ displayName: 'P8 Jisna varghese GDA Female Ernakulam' }],
      phoneNumbers: [{ value: '+91 90744 90963', canonicalForm: '+919074490963' }],
    },
    { resourceName: 'people/c2', phoneNumbers: [{ value: '97461 85168' }, { value: '' }] },
    { resourceName: 'people/c3' },
  ]);
  assert.equal(index.get('9074490963').resourceName, 'people/c1');
  assert.equal(index.get('9074490963').name, 'P8 Jisna varghese GDA Female Ernakulam');
  assert.equal(index.get('9746185168').resourceName, 'people/c2');
  assert.equal(index.size, 2);
});

test('a provider already in the account is linked to that entry, not created', async () => {
  const existingByPhone = new Map([['9074490963', { resourceName: 'people/c1', name: 'P8 Jisna' }]]);
  const result = await contacts.saveProviderContact(provider, { existingByPhone });
  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    reason: 'already_in_google',
    resourceName: 'people/c1',
    name: 'P8 Jisna',
  });
});

test('a stored resourceName still wins over the account lookup', async () => {
  const existingByPhone = new Map([['9074490963', { resourceName: 'people/c1', name: 'x' }]]);
  const result = await contacts.saveProviderContact(
    { ...provider, contactSync: { resourceName: 'people/stored' } },
    { existingByPhone }
  );
  assert.equal(result.reason, 'already_saved');
  assert.equal(result.resourceName, 'people/stored');
});

/* ---- test identities never reach the phone book -------------------------- */

// The app's device-test accounts (9000000xxx / 8000000xxx, OTP 123456) finish
// onboarding like anyone else. Two of them sat among the completed providers.
test('the device-test identities are recognised in every stored form', () => {
  assert.equal(contacts.isTestIdentity('919000000133'), true);
  assert.equal(contacts.isTestIdentity('918000000122'), true);
  assert.equal(contacts.isTestIdentity('9000000156'), true);
  assert.equal(contacts.isTestIdentity('+91 90000 00133'), true);
  assert.equal(contacts.isTestIdentity('919074490963'), false);
  assert.equal(contacts.isTestIdentity('919000001330'), false);
  assert.equal(contacts.isTestIdentity(''), false);
});

test('a test identity is skipped before any credential or network is touched', async () => {
  const result = await contacts.saveProviderContact({ ...provider, phone: '919000000133' });
  assert.deepEqual(result, { ok: false, skipped: true, reason: 'test_identity' });
});
