const { getHubFirestore } = require('./hubStorage');

const BUREAUS_COLLECTION = 'bureaus';
const BUREAU_INVITES_COLLECTION = 'bureauInvites';
const USERS_COLLECTION = 'users';

// pulso-hub's own vocabulary: only a pilot or active partner is trading, and a
// prospect has signed nothing yet. Anything else is treated as not a partner.
const TRADING_STATUSES = ['pilot', 'active'];
const PROSPECT_STATUSES = ['prospect'];

const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000;

const PARTNER_KIND = {
  PARTNER: 'partner',
  PROSPECT: 'prospect',
  UNKNOWN: 'unknown'
};

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

// Matches normalizePhoneNumber in pulso-hub, which is what bureauInvites doc ids
// were written with, and what WhatsApp sends as message.from.
function normalizeHubPhone(value) {
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

function phoneCandidates(value) {
  const normalized = normalizeHubPhone(value);
  if (!normalized) return [];
  const last10 = normalized.slice(-10);
  return Array.from(new Set([normalized, `+${normalized}`, last10, `+91${last10}`, `91${last10}`]));
}

// Agency names are typed into the admin console and stored as typed, which in
// practice means all lower case ("global home care"). Capitalise those for the
// greeting, but leave a name that was deliberately styled ("Maxpro") alone.
function presentName(value) {
  const name = String(value || '').trim();
  if (!name || name !== name.toLowerCase()) {
    return name;
  }
  return name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function bureauDisplayName(bureau = {}) {
  const brand = bureau.brand && typeof bureau.brand === 'object' ? bureau.brand : {};
  return (
    presentName(bureau.brandName) ||
    presentName(brand.displayName) ||
    presentName(bureau.name) ||
    'your agency'
  );
}

/** Pure: what a bureau's status means for this bot. */
function classifyBureauStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (TRADING_STATUSES.includes(value)) return PARTNER_KIND.PARTNER;
  if (PROSPECT_STATUSES.includes(value)) return PARTNER_KIND.PROSPECT;
  return PARTNER_KIND.UNKNOWN;
}

function unknownResult(extra = {}) {
  return { kind: PARTNER_KIND.UNKNOWN, bureauId: '', name: '', status: '', role: '', district: '', ...extra };
}

async function findBureauIdByInvite(db, phone) {
  const snap = await db.collection(BUREAU_INVITES_COLLECTION).doc(normalizeHubPhone(phone)).get();
  if (!snap.exists) return null;
  const invite = snap.data() || {};
  const bureauId = String(invite.bureauId || '').trim();
  return bureauId ? { bureauId, role: String(invite.role || '').trim(), source: 'bureau_invite' } : null;
}

async function findBureauIdByUser(db, phone) {
  for (const candidate of phoneCandidates(phone)) {
    const snap = await db.collection(USERS_COLLECTION).where('phone', '==', candidate).limit(1).get();
    if (snap.empty) continue;
    const bureauId = String((snap.docs[0].data() || {}).bureauId || '').trim();
    if (bureauId) return { bureauId, role: '', source: 'user' };
  }
  return null;
}

// Best effort only: bureaus.phone is free text in pulso-hub, so an equality
// query misses anything stored with spaces. A miss here falls through to the
// pitch, which is recoverable; a wrong hit would not be.
async function findBureauIdByBureauPhone(db, phone) {
  for (const candidate of phoneCandidates(phone)) {
    const snap = await db.collection(BUREAUS_COLLECTION).where('phone', '==', candidate).limit(1).get();
    if (!snap.empty) {
      return { bureauId: snap.docs[0].id, role: '', source: 'bureau_phone' };
    }
  }
  return null;
}

/**
 * Who is on the other end of this number, as far as pulso-hub knows.
 *
 * Never throws. A lookup that fails returns `unknown` with `lookupFailed` set,
 * because dead-ending an agency over an unreachable project is worse than
 * showing them the join link they can ignore.
 */
async function lookupCarePartner(phone) {
  const normalized = normalizeHubPhone(phone);
  if (!normalized) {
    return unknownResult();
  }

  try {
    const db = getHubFirestore();
    const match =
      (await findBureauIdByInvite(db, normalized)) ||
      (await findBureauIdByUser(db, normalized)) ||
      (await findBureauIdByBureauPhone(db, normalized));

    if (!match) {
      return unknownResult({ checkedAt: new Date().toISOString() });
    }

    const snap = await db.collection(BUREAUS_COLLECTION).doc(match.bureauId).get();
    if (!snap.exists) {
      return unknownResult({ checkedAt: new Date().toISOString() });
    }

    const bureau = snap.data() || {};
    return {
      kind: classifyBureauStatus(bureau.status),
      bureauId: match.bureauId,
      role: match.role,
      source: match.source,
      name: bureauDisplayName(bureau),
      status: String(bureau.status || '').trim(),
      district: String(bureau.district || '').trim(),
      billingDay: Number(bureau.billingDay) || 0,
      partnerPct: Number.isFinite(Number(bureau.partnerPct)) ? Number(bureau.partnerPct) : null,
      gstRegistered: bureau.gstRegistered === true,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(
      '[CARE_PARTNER_LOOKUP_ERROR]',
      JSON.stringify({ phone: normalized, message: error.message }, null, 2)
    );
    return unknownResult({ lookupFailed: true, checkedAt: new Date().toISOString() });
  }
}

/** Pure: is a cached lookup still good enough to answer with? */
function isLookupFresh(cached, now = Date.now()) {
  if (!cached || !cached.checkedAt) return false;
  // A failed lookup is never cached as an answer; retry on the next message.
  if (cached.lookupFailed) return false;
  const checkedAt = Date.parse(cached.checkedAt);
  if (!checkedAt) return false;
  return now - checkedAt < LOOKUP_TTL_MS;
}

/** Cached lookup, refreshed once a day so a terminated partner stops being one. */
async function resolveCarePartner(phone, cached) {
  if (isLookupFresh(cached)) {
    return cached;
  }
  return lookupCarePartner(phone);
}

module.exports = {
  PARTNER_KIND,
  LOOKUP_TTL_MS,
  normalizeHubPhone,
  phoneCandidates,
  bureauDisplayName,
  presentName,
  classifyBureauStatus,
  isLookupFresh,
  lookupCarePartner,
  resolveCarePartner
};
