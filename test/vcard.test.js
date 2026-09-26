'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const vcard = require('../src/services/vcardService');

const provider = {
  fullName: 'Sreelakshmi P',
  phone: '919074490963',
  district: 'Ernakulam',
  region: 'kerala',
  sex: 'Female',
  qualification: 'gda',
  dutyHourPreference: 'both',
};

function lines(card) {
  return card.split('\r\n');
}

test('a card opens and closes, and declares vCard 3.0', () => {
  const card = vcard.buildProviderVCard(provider);
  const l = lines(card);
  assert.equal(l[0], 'BEGIN:VCARD');
  assert.equal(l[1], 'VERSION:3.0');
  assert.equal(l[l.length - 2], 'END:VCARD');
});

// Android's importer has historically rejected bare LF. A file that half-imports
// is worse than one that fails outright.
test('every line ends CRLF, never a bare newline', () => {
  const card = vcard.buildProviderVCard(provider);
  assert.ok(card.includes('\r\n'));
  assert.equal(/[^\r]\n/.test(card), false);
});

test('the display name carries the duty prefix and the rest of the shorthand', () => {
  const card = vcard.buildProviderVCard(provider);
  assert.ok(lines(card).includes('FN:P24&8 Sreelakshmi P GDA Female Ernakulam'));
});

// N is family;given;additional;prefix;suffix. Splitting the name across those
// would put the duty prefix in a name part and break sorting by it.
test('N keeps the whole display name in one part, with four separators', () => {
  const card = vcard.buildProviderVCard(provider);
  const n = lines(card).find((l) => l.startsWith('N:'));
  assert.equal(n, 'N:;P24&8 Sreelakshmi P GDA Female Ernakulam;;;');
});

test('TEL is compact and dialable, not the spaced reading form', () => {
  const card = vcard.buildProviderVCard(provider);
  assert.ok(lines(card).includes('TEL;TYPE=CELL:+919074490963'));
});

test('a ten-digit number gains +91, a Gulf number keeps its own code', () => {
  assert.equal(vcard.dialablePhone('7034894494'), '+917034894494');
  assert.equal(vcard.dialablePhone('971564734754'), '+971564734754');
  assert.equal(vcard.dialablePhone(''), '');
});

// ADR has seven parts. A missing empty slot shifts every later field up, so the
// district would land in the street line.
test('ADR keeps all seven parts so nothing shifts', () => {
  const card = vcard.buildProviderVCard(provider);
  const adr = lines(card).find((l) => l.startsWith('ADR'));
  assert.equal(adr, 'ADR;TYPE=WORK:;;;Ernakulam;Kerala;;India');
  assert.equal(adr.split(':')[1].split(';').length, 7);
});

test('org and qualification ride in separate fields', () => {
  const card = vcard.buildProviderVCard(provider);
  assert.ok(lines(card).includes('ORG:Pulso'));
  assert.ok(lines(card).includes('TITLE:GDA'));
});

test('an unknown qualification leaves TITLE off rather than printing a slug', () => {
  const card = vcard.buildProviderVCard({ ...provider, qualification: 'physiotherapy' });
  assert.equal(lines(card).some((l) => l.startsWith('TITLE:')), false);
});

// The bug this suite exists for: '\;' in JavaScript is just ';', so the original
// escape silently did nothing and a name with a semicolon injected a field
// separator, shifting every part of the card after it.
test('a semicolon in a name is escaped, not left as a separator', () => {
  const card = vcard.buildProviderVCard({ ...provider, fullName: 'Jose; Maria' });
  const n = lines(card).find((l) => l.startsWith('N:'));
  assert.equal(n, String.raw`N:;P24&8 Jose\; Maria GDA Female Ernakulam;;;`);
});

test('commas, backslashes and newlines are escaped too', () => {
  assert.equal(vcard.escapeValue('A,B'), String.raw`A\,B`);
  assert.equal(vcard.escapeValue('A\\B'), String.raw`A\\B`);
  assert.equal(vcard.escapeValue('A\nB'), String.raw`A\nB`);
  assert.equal(vcard.escapeValue('A;B'), String.raw`A\;B`);
});

// Folding counts octets, not characters: a Malayalam character is three bytes,
// so a short-looking line can be well over the limit, and cutting inside a
// character puts mojibake in the phone book.
test('a long Malayalam name folds without splitting a character', () => {
  const card = vcard.buildProviderVCard({
    ...provider,
    fullName: 'ശ്രീലക്ഷ്മി പി നായർ വളരെ നീണ്ട പേര് ഇവിടെ',
    district: 'Thiruvananthapuram',
  });
  for (const l of lines(card)) {
    assert.ok(Buffer.from(l, 'utf8').length <= 76, `line over 75 octets: ${l}`);
  }
  assert.equal(card.includes('�'), false);
});

test('an unfolded card still reads back as the original name', () => {
  const name = 'ശ്രീലക്ഷ്മി പി നായർ വളരെ നീണ്ട പേര് ഇവിടെ';
  const card = vcard.buildProviderVCard({ ...provider, fullName: name, district: 'Kollam' });
  const unfolded = card.replace(/\r\n /g, '');
  const fn = lines(unfolded).find((l) => l.startsWith('FN:'));
  // sanitizeFullName caps the person's name, so compare the part that survives.
  assert.ok(fn.startsWith('FN:P24&8 '));
  assert.ok(name.startsWith(fn.slice('FN:P24&8 '.length).replace('…', '').trim().slice(0, 10)));
});

test('many providers concatenate into one importable file', () => {
  const file = vcard.buildProviderVCardFile([
    provider,
    { ...provider, fullName: 'Anitha Jose', dutyHourPreference: '8_hour' },
    { ...provider, fullName: 'Ravi K', region: 'karnataka', district: 'Bengaluru Urban' },
  ]);
  assert.equal((file.match(/BEGIN:VCARD/g) || []).length, 3);
  assert.equal((file.match(/END:VCARD/g) || []).length, 3);
  assert.ok(file.startsWith('BEGIN:VCARD'));
  assert.ok(file.trimEnd().endsWith('END:VCARD'));
});

test('an empty list is an empty file, not a broken card', () => {
  assert.equal(vcard.buildProviderVCardFile([]), '');
  assert.equal(vcard.buildProviderVCardFile(null), '');
});

// Content-Disposition is a header: quotes, slashes and newlines in a filename
// would break it or let a value escape into another header.
test('the filename drops characters a header cannot carry', () => {
  const name = vcard.vcardFilename({ ...provider, fullName: 'A/B:C*D?E"F\r\nG' });
  assert.equal(/["\\/:*?<>|\r\n]/.test(name), false);
  assert.ok(name.endsWith('.vcf'));
});

test('a nameless provider still yields a usable filename', () => {
  const name = vcard.vcardFilename({ ...provider, fullName: 'ശ്രീലക്ഷ്മി' });
  assert.ok(name.endsWith('.vcf'));
  assert.ok(name.length > 4);
});
