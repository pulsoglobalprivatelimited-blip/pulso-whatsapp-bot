require('dotenv').config();
const path = require('path');

function resolveMediaStorageDir() {
  if (process.env.MEDIA_STORAGE_DIR) {
    return process.env.MEDIA_STORAGE_DIR;
  }

  if (process.env.RENDER === 'true') {
    return '/var/data/pulso-media';
  }

  return path.join(process.cwd(), 'storage', 'media');
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'pulso-verify-token',
  whatsappToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v23.0',
  baseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  voiceNoteMediaId: process.env.WORKING_MODEL_AUDIO_MEDIA_ID || '',
  termsAndConditionsUrl: process.env.TERMS_AND_CONDITIONS_URL || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  firebasePrivateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  adminDefaultReviewer: process.env.ADMIN_DEFAULT_REVIEWER || 'ops-team',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || 'pulso-session-secret',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  ownerNotificationPhone: process.env.OWNER_NOTIFICATION_PHONE || '919446600809',
  agentHelpWhatsappNumber: process.env.AGENT_HELP_WHATSAPP_NUMBER || '919446600809',
  mediaStorageDir: resolveMediaStorageDir(),
  dryRun: process.env.WHATSAPP_DRY_RUN !== 'false',
  publicDir: path.join(__dirname, 'public')
};
