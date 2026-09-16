const admin = require('firebase-admin');
const config = require('../config');
const { getFirestore } = require('./storage');

let hubDb;
let hubApp;

// The pulso-hub app itself: Firestore for bookings and care partners, and the
// sign-in token check for the app pipe (verifyIdToken needs only the project id
// and Google's public keys, so the bot's own credential serves).
function getHubApp() {
  const projectId = config.bookingFirebaseProjectId || config.firebaseProjectId;
  if (!projectId || projectId === config.firebaseProjectId) {
    getFirestore();
    return admin.app();
  }
  if (hubApp) {
    return hubApp;
  }
  hubApp = buildHubApp(projectId);
  return hubApp;
}

// The bot writes its own providers and support sessions to its own project, but
// bookings and care partners live in pulso-hub. Both readers share one app so a
// second credential is never initialised for the same project.
function getHubFirestore() {
  const projectId = config.bookingFirebaseProjectId || config.firebaseProjectId;
  if (!projectId || projectId === config.firebaseProjectId) {
    return getFirestore();
  }

  if (hubDb) {
    return hubDb;
  }

  hubDb = admin.firestore(getHubApp());
  return hubDb;
}

function buildHubApp(projectId) {
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

  return app;
}

module.exports = {
  getHubFirestore,
  getHubApp
};
