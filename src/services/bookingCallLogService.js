/* Admin call log for booking/agency conversations.
   The chats themselves live in the booking bot's own Firebase project
   (see bookingAdminService), which this app only ever reads. Call status is
   ours, so it is kept here in this app's Firestore instead: no write access to
   the other project is needed and the booking bot's schema stays untouched. */
const crypto = require('crypto');
const { getFirestore } = require('./storage');

const COLLECTION = 'bookingChatCallLogs';
const MAX_LOGS = 1000;
const MAX_NOTES = 50;
const MAX_NOTE_LENGTH = 1000;

function collectionRef() {
  return getFirestore().collection(COLLECTION);
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  return null;
}

function mapNotes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((note) => ({
      id: String((note && note.id) || ''),
      text: String((note && note.text) || ''),
      by: String((note && note.by) || ''),
      at: toIsoString(note && note.at)
    }))
    .filter((note) => note.id && note.text);
}

function mapLog(doc) {
  const data = doc.data() || {};
  return {
    called: data.called === true,
    calledBy: data.calledBy || '',
    calledAt: toIsoString(data.calledAt),
    shortlisted: data.shortlisted === true,
    shortlistedBy: data.shortlistedBy || '',
    shortlistedAt: toIsoString(data.shortlistedAt),
    notes: mapNotes(data.notes)
  };
}

const EMPTY_LOG = {
  called: false,
  calledBy: '',
  calledAt: null,
  shortlisted: false,
  shortlistedBy: '',
  shortlistedAt: null,
  notes: []
};

function normalizeActor(actor) {
  return String(actor || '').trim() || 'unknown';
}

/* Returns a map of chat id -> call status. Never throws: a call-log outage
   should grey out the call column, not take the whole inbox down with it. */
async function listCallLogs() {
  try {
    const snapshot = await collectionRef().limit(MAX_LOGS).get();
    return snapshot.docs.reduce((acc, doc) => {
      acc[doc.id] = mapLog(doc);
      return acc;
    }, {});
  } catch (error) {
    console.error('[BOOKING_CALL_LOG_LIST_ERROR]', error.message);
    return {};
  }
}

async function getCallLog(chatId) {
  if (!chatId) return { ...EMPTY_LOG };
  try {
    const snap = await collectionRef().doc(String(chatId)).get();
    return snap.exists ? mapLog(snap) : { ...EMPTY_LOG };
  } catch (error) {
    console.error('[BOOKING_CALL_LOG_GET_ERROR]', error.message);
    return { ...EMPTY_LOG };
  }
}

async function setCallLog(chatId, options = {}) {
  if (!chatId) {
    throw new Error('chatId is required');
  }

  const called = options.called === true;
  const actor = normalizeActor(options.actor);
  const now = new Date().toISOString();
  const payload = called
    ? { called: true, calledBy: actor, calledAt: now, updatedAt: now, updatedBy: actor }
    : { called: false, calledBy: null, calledAt: null, updatedAt: now, updatedBy: actor };

  await collectionRef().doc(String(chatId)).set(payload, { merge: true });

  return { called, calledBy: called ? actor : '', calledAt: called ? now : null };
}

async function setShortlisted(chatId, options = {}) {
  if (!chatId) {
    throw new Error('chatId is required');
  }

  const shortlisted = options.shortlisted === true;
  const actor = normalizeActor(options.actor);
  const now = new Date().toISOString();
  const payload = shortlisted
    ? { shortlisted: true, shortlistedBy: actor, shortlistedAt: now, updatedAt: now, updatedBy: actor }
    : { shortlisted: false, shortlistedBy: null, shortlistedAt: null, updatedAt: now, updatedBy: actor };

  await collectionRef().doc(String(chatId)).set(payload, { merge: true });

  return {
    shortlisted,
    shortlistedBy: shortlisted ? actor : '',
    shortlistedAt: shortlisted ? now : null
  };
}

/* Notes are appended in a transaction, not read-modify-write: two admins
   working the same call list would otherwise silently drop each other's note.
   Stored newest first, so display order is storage order and the cap sheds
   the oldest entries. */
async function appendNote(chatId, options = {}) {
  if (!chatId) {
    throw new Error('chatId is required');
  }

  const text = String(options.text || '').trim();
  if (!text) {
    throw new Error('Note text is required');
  }
  if (text.length > MAX_NOTE_LENGTH) {
    throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or fewer`);
  }

  const actor = normalizeActor(options.actor);
  const note = { id: crypto.randomUUID(), text, by: actor, at: new Date().toISOString() };
  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(String(chatId));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? mapNotes((snap.data() || {}).notes) : [];
    const notes = [note, ...existing].slice(0, MAX_NOTES);
    tx.set(ref, { notes, updatedAt: note.at, updatedBy: actor }, { merge: true });
  });

  return note;
}

async function deleteNote(chatId, noteId) {
  if (!chatId) {
    throw new Error('chatId is required');
  }

  const id = String(noteId || '').trim();
  if (!id) {
    throw new Error('noteId is required');
  }

  const db = getFirestore();
  const ref = db.collection(COLLECTION).doc(String(chatId));
  let removed = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const existing = mapNotes((snap.data() || {}).notes);
    const notes = existing.filter((note) => note.id !== id);
    if (notes.length === existing.length) return;
    removed = true;
    tx.set(ref, { notes, updatedAt: new Date().toISOString() }, { merge: true });
  });

  return removed;
}

module.exports = {
  EMPTY_LOG,
  MAX_NOTE_LENGTH,
  setShortlisted,
  appendNote,
  deleteNote,
  listCallLogs,
  getCallLog,
  setCallLog
};
