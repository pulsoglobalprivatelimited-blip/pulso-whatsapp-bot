const { getHubFirestore } = require('./hubStorage');

// The hub mirrors every completed bot onboarding into botOnboarding/{digits}
// and, when the same phone signs into the app, stamps sync.matchStatus
// 'activated' and the user's uid on it. That stamp is the only proof the bot
// has that the provider is really in the app, so this is a read of that one
// document and nothing else.

function toIsoString(value) {
  if (!value) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }
  return null;
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function getHubAppActivation(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) {
    return { ok: false, found: false, activated: false, matchStatus: null, uid: null, activatedAt: null, error: 'invalid_phone' };
  }

  const snapshot = await getHubFirestore().collection('botOnboarding').doc(digits).get();
  if (!snapshot.exists) {
    return { ok: true, found: false, activated: false, matchStatus: null, uid: null, activatedAt: null };
  }

  const data = snapshot.data() || {};
  const sync = data.sync || {};
  const matchStatus = sync.matchStatus || null;
  const uid = data.appProviderUid || sync.matchedUserId || null;
  const activated = matchStatus === 'activated' && Boolean(uid);

  let activatedAt = null;
  if (activated) {
    activatedAt = await readActivatedAt(uid);
    if (!activatedAt) {
      activatedAt = toIsoString(sync.lastEvaluatedAt) || toIsoString(data.lastSyncedAt);
    }
  }

  return { ok: true, found: true, activated, matchStatus, uid, activatedAt };
}

// The user doc carries the moment the hub activated the provider; the mirror
// only knows when it last looked. Missing or unreadable is fine — the caller
// falls back to the mirror's timestamp.
async function readActivatedAt(uid) {
  try {
    const userSnapshot = await getHubFirestore().collection('users').doc(uid).get();
    if (!userSnapshot.exists) {
      return null;
    }
    const user = userSnapshot.data() || {};
    return toIsoString(user.activatedFromBotAt) || toIsoString(user.activatedAt) || null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  getHubAppActivation,
  normalizePhoneDigits
};
