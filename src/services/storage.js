const admin = require('firebase-admin');
const config = require('../config');

let app;
let db;

function getFirebaseApp() {
  if (app) {
    return app;
  }

  getFirestore();
  return app;
}

function getFirestore() {
  if (db) {
    return db;
  }

  if (!admin.apps.length) {
    const hasInlineCredential =
      config.firebaseProjectId &&
      config.firebaseClientEmail &&
      config.firebasePrivateKey &&
      !config.firebasePrivateKey.includes('...');

    const hasCredentialFile = Boolean(config.googleApplicationCredentials);

    if (!hasInlineCredential && !hasCredentialFile) {
      throw new Error(
        'Firebase credentials are missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY, or set GOOGLE_APPLICATION_CREDENTIALS to a mounted service-account JSON file.'
      );
    }

    const credential =
      config.googleApplicationCredentials || !hasInlineCredential
        ? admin.credential.applicationDefault()
        : admin.credential.cert({
            projectId: config.firebaseProjectId,
            clientEmail: config.firebaseClientEmail,
            privateKey: config.firebasePrivateKey
          });

    app = admin.initializeApp({
      credential,
      projectId: config.firebaseProjectId || undefined,
      storageBucket: config.firebaseStorageBucket || undefined
    });
  } else {
    [app] = admin.apps;
  }

  db = admin.firestore(app);
  return db;
}

function getStorageBucket() {
  const firebaseApp = getFirebaseApp();
  return admin.storage(firebaseApp).bucket(config.firebaseStorageBucket || undefined);
}

async function initializeStorage() {
  await getFirestore().collection('_health').doc('startup').set(
    {
      checkedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

async function getProvider(phone) {
  const snapshot = await getFirestore().collection('providers').doc(phone).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function listProviders() {
  const snapshot = await getFirestore()
    .collection('providers')
    .orderBy('updatedAt', 'desc')
    .get();

  return snapshot.docs.map((doc) => doc.data());
}

async function listProviderSummaries() {
  const snapshot = await getFirestore()
    .collection('providers')
    .orderBy('updatedAt', 'desc')
    .select(
      'phone',
      'status',
      'currentStep',
      'region',
      'language',
      'flowId',
      'qualification',
      'fullName',
      'age',
      'sex',
      'district',
      'dutyHourPreference',
      'expectedDutiesAccepted',
      'interestConfirmed',
      'agentHelpRequested',
      'termsAccepted',
      'completedAt',
      'createdAt',
      'updatedAt',
      'verification',
      'pulsoAppActivationStatus',
      'pulsoAppDevice',
      'pulsoAppHelpReason',
      'mobileAppCampaignStatus',
      'mobileAppCampaignDevice'
    )
    .get();

  return snapshot.docs.map((doc) => ({
    phone: doc.id,
    ...doc.data()
  }));
}

async function listProviderTermsReminderCandidates() {
  const snapshot = await getFirestore()
    .collection('providers')
    .where('status', '==', 'awaiting_terms_acceptance')
    .select(
      'phone',
      'status',
      'termsAccepted',
      'termsSentAt',
      'termsReminderSentAt',
      'termsReminderCount',
      'termsReminderKind',
      'verification'
    )
    .get();

  return snapshot.docs.map((doc) => ({
    phone: doc.id,
    ...doc.data()
  }));
}

async function listPendingVerificationNotificationProviders() {
  const snapshot = await getFirestore()
    .collection('providers')
    .where('status', '==', 'certificate_verification_pending')
    .select(
      'phone',
      'status',
      'fullName',
      'age',
      'sex',
      'region',
      'dutyHourPreference',
      'qualification',
      'district',
      'documents',
      'verification'
    )
    .get();

  return snapshot.docs.map((doc) => ({
    phone: doc.id,
    ...doc.data()
  }));
}

async function listReviewerWorkflowProviders(reviewerPhone) {
  const snapshot = await getFirestore()
    .collection('providers')
    .where('verification.reviewerWorkflow.reviewerPhone', '==', reviewerPhone)
    .select(
      'phone',
      'status',
      'fullName',
      'age',
      'sex',
      'region',
      'dutyHourPreference',
      'qualification',
      'district',
      'verification'
    )
    .get();

  return snapshot.docs.map((doc) => ({
    phone: doc.id,
    ...doc.data()
  }));
}

async function saveProvider(phone, provider) {
  await getFirestore().collection('providers').doc(phone).set(provider, { merge: true });
  return provider;
}

async function saveWhatsappMessageStatus(status) {
  const messageId = status && status.id ? String(status.id).replace(/\//g, '_') : null;
  if (!messageId) {
    return null;
  }

  const payload = {
    ...status,
    updatedAt: new Date().toISOString()
  };

  await getFirestore()
    .collection('whatsappMessageStatuses')
    .doc(messageId)
    .set(payload, { merge: true });

  return payload;
}

module.exports = {
  initializeStorage,
  getFirestore,
  getProvider,
  listProviders,
  listProviderSummaries,
  listProviderTermsReminderCandidates,
  listPendingVerificationNotificationProviders,
  listReviewerWorkflowProviders,
  saveProvider,
  saveWhatsappMessageStatus,
  getStorageBucket
};
