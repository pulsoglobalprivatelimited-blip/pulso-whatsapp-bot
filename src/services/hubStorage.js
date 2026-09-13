const admin = require('firebase-admin');
const config = require('../config');
const { getFirestore } = require('./storage');

let hubDb;

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

  hubDb = admin.firestore(app);
  return hubDb;
}

module.exports = {
  getHubFirestore
};
