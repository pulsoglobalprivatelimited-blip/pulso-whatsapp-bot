const { getFirestore } = require('./storage');
const config = require('../config');
const { sendText } = require('./metaClient');

const COLLECTION = 'providerSupportSessions';

function collectionRef() {
  return getFirestore().collection(COLLECTION);
}

function normalizePhone(value) {
  return (value || '').toString().replace(/\D+/g, '');
}

function mapSessionDoc(doc) {
  return {
    id: doc.id,
    ...doc.data()
  };
}

async function listProviderSupportSessions() {
  const snapshot = await collectionRef().orderBy('updatedAt', 'desc').get();
  return snapshot.docs.map(mapSessionDoc);
}

async function getProviderSupportSession(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const directRef = collectionRef().doc(normalizedPhone);
  const directSnap = await directRef.get();
  if (directSnap.exists) {
    return mapSessionDoc(directSnap);
  }

  const snapshot = await collectionRef().get();
  const match = snapshot.docs
    .map(mapSessionDoc)
    .find((session) => normalizePhone(session.phone || session.id).endsWith(normalizedPhone.slice(-10)));

  return match || null;
}

async function listProviderSupportEvents(sessionId) {
  const snapshot = await collectionRef()
    .doc(sessionId)
    .collection('events')
    .orderBy('createdAt', 'asc')
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));
}

async function getProviderSupportSessionDetail(phone) {
  const session = await getProviderSupportSession(phone);
  if (!session) {
    return null;
  }

  const events = await listProviderSupportEvents(session.id);
  return {
    ...session,
    events
  };
}

async function deleteCollection(collection, batchSize = 100) {
  let deleted = 0;

  while (true) {
    const snapshot = await collection.limit(batchSize).get();
    if (snapshot.empty) {
      return deleted;
    }

    const batch = collection.firestore.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;

    if (snapshot.size < batchSize) {
      return deleted;
    }
  }
}

async function resetProviderSupportSession(phone) {
  const session = await getProviderSupportSession(phone);
  if (!session) {
    return { deleted: false, phone: normalizePhone(phone), eventsDeleted: 0 };
  }

  const ref = collectionRef().doc(session.id);
  const eventsDeleted = await deleteCollection(ref.collection('events'));
  await ref.delete();

  return {
    deleted: true,
    phone: session.phone || session.id,
    sessionId: session.id,
    eventsDeleted
  };
}

/**
 * The desk's reply (5 Nov 2026): goes from the support number into her chat,
 * and into the history as "Pulso team". Free-form, so only inside 24 hours of
 * her last message; Meta's refusal comes back as the error.
 */
async function replyToProviderSupportSession(phone, text, by = 'desk') {
  const normalizedPhone = normalizePhone(phone);
  const body = String(text || '').trim().slice(0, 4000);
  if (!normalizedPhone) throw new Error('phone required');
  if (!body) throw new Error('reply text required');
  const ref = collectionRef().doc(normalizedPhone);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No support chat with this number');
  await sendText(normalizedPhone, body, config.providerSupportPhoneNumberId ? { phoneNumberId: config.providerSupportPhoneNumberId } : undefined);
  const at = new Date().toISOString();
  await ref.collection('events').add({ type: 'outbound_message', payload: { kind: 'text', body, by }, createdAt: at });
  await ref.set({ lastDeskReplyAt: at, updatedAt: at }, { merge: true });
  return { ok: true, at };
}

module.exports = {
  replyToProviderSupportSession,
  getProviderSupportSessionDetail,
  listProviderSupportSessions,
  resetProviderSupportSession
};
