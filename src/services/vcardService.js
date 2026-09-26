// Turns a finished provider into a .vcf the admin can tap on a phone to drop
// them straight into the contact book.
//
// The field mapping - the p24/p8 prefix, the dialable number, the district and
// state, the notes - already exists in googleContactsService and is covered by
// tests there. This file is only the serialisation: vCard 3.0 is fussy about
// escaping, line endings and line length, and Android's importer is the thing
// that has to read it.
const {
  buildContactName,
  buildContactAddress,
  buildContactNotes,
  qualificationLabel,
  regionLabel,
} = require('./googleContactsService');

// vCard 3.0 rather than 4.0: it is what Android's contact importer and every
// other phone book actually agree on. 4.0 is newer and less widely read.
const VCARD_VERSION = '3.0';

// RFC 6350 line breaks are CRLF, not LF. Some importers accept bare LF; Android's
// has historically not, and a file that half-imports is worse than one that fails
// outright.
const CRLF = '\r\n';

// Backslash first - escaping it after the others would double-escape what they
// just inserted.
function escapeValue(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// A content line longer than 75 octets must be folded, continued by a leading
// space. Counting octets rather than characters matters here: a Malayalam name
// is three bytes per character, so a line that looks short can be well over the
// limit, and splitting inside a character produces mojibake in the phone book.
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const pieces = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Walk back off a continuation byte (10xxxxxx) so a multi-byte character is
    // never cut in half.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    pieces.push(bytes.slice(start, end).toString('utf8'));
    start = end;
    // Continuation lines carry a leading space, which costs an octet.
    limit = 74;
  }
  return pieces.join(`${CRLF} `);
}

function line(name, value) {
  return foldLine(`${name}:${value}`);
}

// TEL is what the phone dials. formatContactPhone spaces the number for reading;
// strip that back out so no dialer has to guess.
function dialablePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

// ADR is seven semicolon-separated parts: po box, extended, street, locality,
// region, postcode, country. Only locality, region and country are known here,
// and the empty slots have to be present or the importer shifts every field up.
function addressLine(provider) {
  const district = escapeValue(String((provider && provider.district) || '').trim());
  const state = escapeValue(regionLabel(provider && provider.region));
  if (!district && !state) return '';
  return line('ADR;TYPE=WORK', `;;;${district};${state};;India`);
}

function buildProviderVCard(provider) {
  const name = escapeValue(buildContactName(provider));
  const lines = [
    'BEGIN:VCARD',
    line('VERSION', VCARD_VERSION),
    line('FN', name),
    // N is family;given;additional;prefix;suffix. The whole display name goes in
    // `given` deliberately: splitting "p24 p8 Sreelakshmi P" into parts would put
    // the duty prefix in a name field and break sorting by it.
    line('N', `;${name};;;`),
  ];

  const tel = dialablePhone(provider && provider.phone);
  if (tel) lines.push(line('TEL;TYPE=CELL', escapeValue(tel)));

  lines.push(line('ORG', escapeValue('Pulso')));
  const title = qualificationLabel(provider && provider.qualification);
  if (title) lines.push(line('TITLE', escapeValue(title)));

  const adr = addressLine(provider);
  if (adr) lines.push(adr);
  const address = buildContactAddress(provider);
  if (address) lines.push(line('LABEL;TYPE=WORK', escapeValue(address)));

  const notes = buildContactNotes(provider);
  if (notes) lines.push(line('NOTE', escapeValue(notes)));

  lines.push('END:VCARD');
  return lines.join(CRLF) + CRLF;
}

// A provider who never gave a name sorts to the end, not the top. An empty
// string sorts first by default, which opened the bulk file with cards that were
// nothing but a phone number - the least useful entries leading the rest.
function compareProvidersByName(a, b) {
  const aName = String((a && a.fullName) || '').trim();
  const bName = String((b && b.fullName) || '').trim();
  if (Boolean(aName) !== Boolean(bName)) return aName ? -1 : 1;
  return aName.localeCompare(bName);
}

// A .vcf may hold any number of cards back to back, so the whole backlog imports
// in one tap rather than 483.
function buildProviderVCardFile(providers) {
  return (providers || []).map(buildProviderVCard).join('');
}

// Content-Disposition is a header, so the filename cannot carry quotes, slashes,
// control characters or newlines. Non-ASCII is handled separately by the caller
// via filename*, this is the plain fallback.
function vcardFilename(provider) {
  const base = buildContactName(provider)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\/:*?<>|\r\n]/g, '')
    .trim();
  return `${base || 'pulso-contact'}.vcf`;
}

module.exports = {
  buildProviderVCard,
  compareProvidersByName,
  buildProviderVCardFile,
  vcardFilename,
  dialablePhone,
  escapeValue,
  foldLine,
};
