const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * The gate, tested against a stubbed Firestore.
 *
 * This is the test that matters most in the calling bot. If it leaks, an
 * agency owner who types "call" is handed 500 competitors' phone numbers and
 * the private record of what each of them said about us. So it is checked for
 * what it lets IN and, more importantly, for what it keeps out when things go
 * wrong — a missing config, an unreadable database, a number that merely looks
 * similar.
 */

let configDoc = { exists: false, data: () => ({}) };
let throwOnRead = false;

const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === './storage' || request === '../src/services/storage') {
    return {
      getFirestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => {
              if (throwOnRead) throw new Error('firestore down');
              return configDoc;
            },
          }),
        }),
      }),
    };
  }
  return realLoad(request, parent, isMain);
};

const store = require('../src/services/agencyCallStore');

test.after(() => { Module._load = realLoad; });

test('the founder is let in, in every form the webhook might give his number', async () => {
  for (const form of ['917736108778', '+91 77361 08778', '7736108778', '917736108778@c.us']) {
    assert.equal(await store.isCallAdmin(form), true, form);
  }
});

test('an agency is kept out, including numbers that look close', async () => {
  for (const other of ['919876543210', '7736108779', '917736108', '', null, undefined, '0']) {
    assert.equal(await store.isCallAdmin(other), false, String(other));
  }
});

test('an unreadable database locks everybody out, never lets everybody in', async () => {
  // Fail closed. A gate that opens when the database is down is not a gate,
  // and this one guards a contact list we cannot un-send.
  throwOnRead = true;
  try {
    assert.equal(await store.isCallAdmin('919876543210'), false);
    // The founder still gets in: his number does not need the database.
    assert.equal(await store.isCallAdmin('917736108778'), true);
  } finally {
    throwOnRead = false;
  }
});

test('a number added in the database is let in, without a deploy', async () => {
  configDoc = { exists: true, data: () => ({ phones: ['+91 94466 00809'] }) };
  try {
    assert.equal(await store.isCallAdmin('919446600809'), true);
    assert.equal(await store.isCallAdmin('919446600800'), false);
  } finally {
    configDoc = { exists: false, data: () => ({}) };
  }
});

test('a database value that is not a list cannot open the gate', async () => {
  for (const bad of ['919876543210', { phones: '919876543210' }, 42, null]) {
    configDoc = { exists: true, data: () => ({ phones: bad }) };
    assert.equal(await store.isCallAdmin('919876543210'), false, JSON.stringify(bad));
  }
  configDoc = { exists: false, data: () => ({}) };
});

test('the environment list replaces the built-in one, so the founder can be removed', async () => {
  // If his number ever changes hands, setting the variable must be enough —
  // a built-in number that cannot be switched off is a back door.
  const before = process.env.AGENCY_CALL_ADMINS;
  process.env.AGENCY_CALL_ADMINS = '919446600809';
  try {
    assert.equal(await store.isCallAdmin('919446600809'), true);
    assert.equal(await store.isCallAdmin('917736108778'), false, 'the built-in default no longer applies');
  } finally {
    if (before === undefined) delete process.env.AGENCY_CALL_ADMINS;
    else process.env.AGENCY_CALL_ADMINS = before;
  }
});
