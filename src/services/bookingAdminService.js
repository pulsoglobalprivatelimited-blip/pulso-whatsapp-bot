const admin = require('firebase-admin');
const config = require('../config');
const { getFirestore } = require('./storage');

const COLLECTION = 'whatsappBookingChats';
let bookingDb;

function getBookingFirestore() {
  const projectId = config.bookingFirebaseProjectId || config.firebaseProjectId;
  if (!projectId || projectId === config.firebaseProjectId) {
    return getFirestore();
  }

  if (bookingDb) {
    return bookingDb;
  }

  const appName = `booking-${projectId}`;
  const existingApp = admin.apps.find((item) => item.name === appName);
  const hasInlineCredential =
    config.firebaseProjectId &&
    config.firebaseClientEmail &&
    config.firebasePrivateKey &&
    !config.firebasePrivateKey.includes('...');

  const app =
    existingApp ||
    admin.initializeApp(
      {
        credential:
          config.googleApplicationCredentials || !hasInlineCredential
            ? admin.credential.applicationDefault()
            : admin.credential.cert({
                projectId: config.firebaseProjectId,
                clientEmail: config.firebaseClientEmail,
                privateKey: config.firebasePrivateKey
              }),
        projectId
      },
      appName
    );

  bookingDb = admin.firestore(app);
  return bookingDb;
}

function collectionRef() {
  return getBookingFirestore().collection(COLLECTION);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return value && String(value).startsWith('+') ? String(value) : digits;
}

function normalizeRegion(value) {
  const region = String(value || '').trim().toLowerCase();
  return region === 'kerala' || region === 'karnataka' ? region : null;
}

function serializeFirestoreValue(value) {
  if (value == null) return value;
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (typeof value.toMillis === 'function') {
    return new Date(value.toMillis()).toISOString();
  }
  if (
    typeof value === 'object' &&
    Number.isFinite(value._seconds) &&
    Number.isFinite(value._nanoseconds)
  ) {
    return new Date(value._seconds * 1000 + Math.round(value._nanoseconds / 1000000)).toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }
  if (typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, item]) => {
      acc[key] = serializeFirestoreValue(item);
      return acc;
    }, {});
  }
  return value;
}

function mapChatDoc(doc) {
  return {
    id: doc.id,
    ...serializeFirestoreValue(doc.data())
  };
}

async function listWhatsappBookingChats(options = {}) {
  const requestedRegion = normalizeRegion(options.region);
  const snapshot = await collectionRef().orderBy('updatedAt', 'desc').limit(500).get();
  const chats = snapshot.docs.map(mapChatDoc);

  if (!requestedRegion) {
    return chats;
  }

  return chats.filter((chat) => normalizeRegion(chat.region) === requestedRegion);
}

async function getWhatsappBookingChat(phone) {
  const normalizedPhone = normalizePhone(phone);
  const candidates = Array.from(
    new Set([phone, normalizedPhone, normalizedPhone.replace(/^\+/, '')].filter(Boolean).map(String))
  );

  for (const candidate of candidates) {
    const snap = await collectionRef().doc(candidate).get();
    if (snap.exists) {
      return mapChatDoc(snap);
    }
  }

  if (!normalizedPhone) {
    return null;
  }

  const lastTen = normalizedPhone.replace(/\D+/g, '').slice(-10);
  const snapshot = await collectionRef().limit(500).get();
  return (
    snapshot.docs
      .map(mapChatDoc)
      .find((chat) => normalizePhone(chat.phone || chat.id).replace(/\D+/g, '').endsWith(lastTen)) || null
  );
}

async function listWhatsappBookingMessages(chatId) {
  const snapshot = await collectionRef()
    .doc(chatId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .limit(1000)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...serializeFirestoreValue(doc.data())
  }));
}

async function getWhatsappBookingChatDetail(phone) {
  const chat = await getWhatsappBookingChat(phone);
  if (!chat) {
    return null;
  }

  return {
    ...chat,
    messages: await listWhatsappBookingMessages(chat.id)
  };
}

module.exports = {
  getWhatsappBookingChatDetail,
  listWhatsappBookingChats
};
