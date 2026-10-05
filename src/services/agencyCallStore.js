'use strict';

/**
 * Where the call list lives, and who is allowed to see it.
 *
 * Two collections in the bot's own Firestore:
 *   agencyCalls/{phoneDigits}  — one agency, its outcome, its follow-up date
 *   agencyCallers/{phoneDigits} — one caller, what he has in hand right now
 *
 * The caller record is what stops the same agency going out twice and what
 * remembers, between one message and the next, that the bot asked a question.
 */
const { getFirestore } = require('./storage');
const flow = require('./agencyCallFlow');

const AGENCIES = 'agencyCalls';
const CALLERS = 'agencyCallers';
const CONFIG = 'agencyCallConfig';

/** Who may use the calling commands. The founder, and whoever he adds later. */
const DEFAULT_ADMINS = ['917736108778'];

function digits(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function agencies() {
  return getFirestore().collection(AGENCIES);
}

function callers() {
  return getFirestore().collection(CALLERS);
}

/**
 * Is this number allowed the list?
 *
 * The gate reads config first and Firestore second, so a number can be added
 * without a deploy. It fails CLOSED: an unreadable config means nobody is an
 * admin, never everybody — a leak here hands a stranger 500 agency numbers and
 * the record of who said what about them.
 */
async function isCallAdmin(phone) {
  const want = digits(phone).slice(-10);
  if (!want) return false;
  const fromEnv = String(process.env.AGENCY_CALL_ADMINS || '')
    .split(',')
    .map((v) => digits(v).slice(-10))
    .filter(Boolean);
  const base = fromEnv.length ? fromEnv : DEFAULT_ADMINS.map((v) => v.slice(-10));
  if (base.includes(want)) return true;
  try {
    const snap = await getFirestore().collection(CONFIG).doc('admins').get();
    const extra = snap.exists ? snap.data().phones : null;
    return Array.isArray(extra) && extra.map((v) => digits(v).slice(-10)).includes(want);
  } catch (error) {
    console.error('[AGENCY_CALL_ADMIN_READ_FAILED]', error && error.message);
    return false;
  }
}

/** Put the list in. Existing rows keep their outcome; only details refresh. */
async function seedAgencies(rows = []) {
  const db = getFirestore();
  let added = 0;
  let refreshed = 0;
  for (const row of rows) {
    const id = digits(row.phone);
    if (!id) continue;
    const ref = agencies().doc(id);
    const snap = await ref.get();
    const base = {
      agency: String(row.agency || '').trim(),
      district: String(row.district || '').trim(),
      phone: String(row.phone || '').trim(),
      source: String(row.source || '').trim(),
      group: String(row.group || '').trim(),
      messagedOn: String(row.messagedOn || '').trim() || null,
      repliedToBroadcast: row.repliedToBroadcast === true,
      order: Number(row.order || 0) || 0,
      batch: String(row.batch || '').trim() || null,
    };
    if (snap.exists) {
      // Never touch status, outcome, attempts or notes: re-running the import
      // must not undo an evening of calls.
      await ref.set(base, { merge: true });
      refreshed += 1;
    } else {
      await ref.set({
        ...base,
        status: 'pending',
        outcome: null,
        nextStep: null,
        followUpOn: null,
        attempts: 0,
        notes: [],
        calledBy: null,
        calledAt: null,
        createdAt: new Date().toISOString(),
      });
      added += 1;
    }
  }
  return { added, refreshed, total: rows.length };
}

/**
 * The next agency for this caller, claimed so nobody else gets it.
 *
 * Order: the ones that already replied to our WhatsApp, then follow-ups that
 * are due, then the rest in list order. A claim writes `in_hand` with the
 * caller's number, so two people calling at once cannot be handed the same
 * agency — and a claim older than the stale window is taken back, because a
 * caller who closes WhatsApp mid-list must not lock a number forever.
 */
const STALE_CLAIM_MS = 6 * 60 * 60 * 1000;

async function claimNextAgency(callerPhone, { now = new Date() } = {}) {
  const caller = digits(callerPhone);
  const today = flow.toDayKey(now);
  const snap = await agencies().get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const stale = (a) => a.status === 'in_hand'
    && (!a.claimedAtMs || now.getTime() - Number(a.claimedAtMs) > STALE_CLAIM_MS);
  const mine = (a) => a.status === 'in_hand' && digits(a.claimedBy) === caller;

  const already = all.find(mine);
  if (already) return { agency: already, ...positionOf(all, already) };

  const available = all.filter((a) => {
    if (a.status === 'done' || a.status === 'retired') return false;
    if (a.status === 'in_hand' && !stale(a)) return false;
    if (a.followUpOn && a.followUpOn > today) return false;   // not due yet
    return true;
  });
  if (!available.length) return { agency: null, ...positionOf(all, null) };

  available.sort((a, b) => {
    if (Boolean(b.repliedToBroadcast) !== Boolean(a.repliedToBroadcast)) {
      return b.repliedToBroadcast ? 1 : -1;
    }
    const aDue = a.followUpOn ? 0 : 1;
    const bDue = b.followUpOn ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    return Number(a.order || 0) - Number(b.order || 0);
  });

  const pick = available[0];
  await agencies().doc(pick.id).set({
    status: 'in_hand',
    claimedBy: caller,
    claimedAtMs: now.getTime(),
  }, { merge: true });
  return { agency: { ...pick, status: 'in_hand' }, ...positionOf(all, pick) };
}

function positionOf(all, agency) {
  const total = all.length;
  const finished = all.filter((a) => a.status === 'done' || a.status === 'retired').length;
  return { position: finished + 1, total, nextDistrict: agency ? agency.district : null };
}

/** Write the outcome down. Returns the stored record. */
async function recordOutcome(agencyId, outcome, { callerPhone, note, followUpOn, now = new Date() } = {}) {
  const ref = agencies().doc(digits(agencyId));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const current = snap.data() || {};
  const next = flow.recordFor(outcome, {
    attempts: current.attempts || 0,
    followUpOn: followUpOn || null,
    now,
  });
  const notes = Array.isArray(current.notes) ? current.notes.slice() : [];
  if (note) notes.push({ at: now.toISOString(), by: digits(callerPhone), text: String(note).trim() });
  await ref.set({
    ...next,
    notes,
    claimedBy: null,
    claimedAtMs: null,
    calledBy: digits(callerPhone) || current.calledBy || null,
    calledAt: now.toISOString(),
  }, { merge: true });
  return { id: ref.id, ...current, ...next, notes };
}

/** Add a note to whatever he has in hand, without ending the call. */
async function addNote(agencyId, note, { callerPhone, now = new Date() } = {}) {
  const ref = agencies().doc(digits(agencyId));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const notes = Array.isArray(snap.data().notes) ? snap.data().notes.slice() : [];
  notes.push({ at: now.toISOString(), by: digits(callerPhone), text: String(note).trim() });
  await ref.set({ notes }, { merge: true });
  return true;
}

/** Put an agency back without recording anything. */
async function releaseAgency(agencyId) {
  const id = digits(agencyId);
  if (!id) return false;
  await agencies().doc(id).set({ status: 'pending', claimedBy: null, claimedAtMs: null }, { merge: true });
  return true;
}

/** Skip: back to the end of the queue, not an outcome. */
async function skipAgency(agencyId) {
  const id = digits(agencyId);
  if (!id) return false;
  const ref = agencies().doc(id);
  const snap = await ref.get();
  const order = Number((snap.exists && snap.data().order) || 0);
  await ref.set({
    status: 'pending',
    claimedBy: null,
    claimedAtMs: null,
    order: order + 10000,          // keeps list order, just later
  }, { merge: true });
  return true;
}

async function statsFor({ now = new Date() } = {}) {
  const today = flow.toDayKey(now);
  const snap = await agencies().get();
  const all = snap.docs.map((d) => d.data() || {});
  const count = (outcome) => all.filter((a) => a.outcome === outcome).length;
  const pendingNext = all
    .filter((a) => a.status === 'pending' || a.status === 'in_hand')
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))[0];
  return {
    total: all.length,
    interested: count(flow.OUTCOMES.interested),
    later: count(flow.OUTCOMES.later),
    noAnswer: all.filter((a) => a.outcome === flow.OUTCOMES.noAnswer && a.status !== 'retired').length,
    notInterested: count(flow.OUTCOMES.notInterested),
    wrongNumber: count(flow.OUTCOMES.wrongNumber),
    retired: all.filter((a) => a.status === 'retired').length,
    dueToday: all.filter((a) => a.followUpOn && a.followUpOn <= today && a.status !== 'done').length,
    nextDistrict: pendingNext ? pendingNext.district : null,
  };
}

/** The whole list, for the admin web page. */
async function listAgencies() {
  const snap = await agencies().orderBy('order', 'asc').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---- the caller's place in the conversation --------------------------------

async function getCaller(phone) {
  const id = digits(phone);
  if (!id) return null;
  const snap = await callers().doc(id).get();
  return snap.exists ? { id, ...snap.data() } : { id, state: flow.STATES.idle, inHand: null };
}

async function setCaller(phone, patch) {
  const id = digits(phone);
  if (!id) return null;
  await callers().doc(id).set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
  return true;
}

module.exports = {
  AGENCIES,
  CALLERS,
  DEFAULT_ADMINS,
  STALE_CLAIM_MS,
  isCallAdmin,
  seedAgencies,
  claimNextAgency,
  recordOutcome,
  addNote,
  releaseAgency,
  skipAgency,
  statsFor,
  listAgencies,
  getCaller,
  setCaller,
};
