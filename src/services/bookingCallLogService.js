/* Admin call log for booking/agency conversations.
   The chats themselves live in the booking bot's own Firebase project
   (see bookingAdminService), which this app only ever reads. Call status is
   ours, so it is kept here in this app's Firestore instead: no write access to
   the other project is needed and the booking bot's schema stays untouched. */
const { getFirestore } = require('./storage');

const COLLECTION = 'bookingChatCallLogs';
const MAX_LOGS = 1000;

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

function mapLog(doc) {
  const data = doc.data() || {};
  return {
    called: data.called === true,
    calledBy: data.calledBy || '',
    calledAt: toIsoString(data.calledAt)
  };
}

const EMPTY_LOG = { called: false, calledBy: '', calledAt: null };

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
  const actor = String(options.actor || '').trim() || 'unknown';
  const now = new Date().toISOString();
  const payload = called
    ? { called: true, calledBy: actor, calledAt: now, updatedAt: now, updatedBy: actor }
    : { called: false, calledBy: null, calledAt: null, updatedAt: now, updatedBy: actor };

  await collectionRef().doc(String(chatId)).set(payload, { merge: true });

  return { called, calledBy: called ? actor : '', calledAt: called ? now : null };
}

module.exports = {
  EMPTY_LOG,
  listCallLogs,
  getCallLog,
  setCallLog
};
