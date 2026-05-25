require('dotenv').config();
const path = require('path');

const DEFAULT_IVR_WEBHOOK_ALLOWED_IPS = [
  '122.176.95.160',
  '180.179.198.152',
  '180.179.198.235'
];

const DEFAULT_PULSO_DUTY_ACCEPT_VIDEO_MEDIA_ID = '1862764111082996';
const DEFAULT_PULSO_APP_ACTIVATION_VIDEO_MEDIA_ID = '1661011455048746';
const STALE_PULSO_VIDEO_MEDIA_IDS = new Set([
  '969942785736280',
  '908615228890468'
]);

function resolveWhatsappMediaId(value, fallback) {
  const mediaId = (value || '').toString().trim();
  if (!mediaId || STALE_PULSO_VIDEO_MEDIA_IDS.has(mediaId)) {
    return fallback;
  }
  return mediaId;
}

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
  pulsoDutyAcceptVideoMediaId: resolveWhatsappMediaId(
    process.env.PULSO_DUTY_ACCEPT_VIDEO_MEDIA_ID,
    DEFAULT_PULSO_DUTY_ACCEPT_VIDEO_MEDIA_ID
  ),
  pulsoAppActivationVideoMediaId: resolveWhatsappMediaId(
    process.env.PULSO_APP_ACTIVATION_VIDEO_MEDIA_ID,
    DEFAULT_PULSO_APP_ACTIVATION_VIDEO_MEDIA_ID
  ),
  termsAndConditionsUrl: process.env.TERMS_AND_CONDITIONS_URL || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  bookingFirebaseProjectId:
    process.env.BOOKING_FIREBASE_PROJECT_ID ||
    process.env.PULSO_HUB_FIREBASE_PROJECT_ID ||
    'pulso-hub',
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
  secondaryNotificationPhone: process.env.SECONDARY_NOTIFICATION_PHONE || '',
  termsFirstReminderDelayHours: Number(
    process.env.TERMS_FIRST_REMINDER_DELAY_HOURS || process.env.TERMS_REMINDER_DELAY_HOURS || 1
  ),
  termsSecondReminderDelayHours: Number(process.env.TERMS_SECOND_REMINDER_DELAY_HOURS || 24),
  termsReminderCheckIntervalMinutes: Number(process.env.TERMS_REMINDER_CHECK_INTERVAL_MINUTES || 30),
  termsReminderResumeKeyword: process.env.TERMS_REMINDER_RESUME_KEYWORD || 'continue',
  termsReminderTemplateName: process.env.TERMS_REMINDER_TEMPLATE_NAME || '',
  termsReminderTemplateLanguage: process.env.TERMS_REMINDER_TEMPLATE_LANGUAGE || 'en',
  pulsoHubBotSyncUrl: process.env.PULSO_HUB_BOT_SYNC_URL || '',
  pulsoHubBotSyncSecret: process.env.PULSO_HUB_BOT_SYNC_SECRET || '',
  ivrStaffPhone: process.env.IVR_STAFF_PHONE || process.env.OWNER_NOTIFICATION_PHONE || '918714105666',
  ivrRecruitmentWhatsappNumber: process.env.IVR_RECRUITMENT_WHATSAPP_NUMBER || '919633108778',
  ivrWebhookSecret: process.env.IVR_WEBHOOK_SECRET || '',
  ivrWebhookAllowedIps: Array.from(
    new Set(
      (process.env.IVR_WEBHOOK_ALLOWED_IPS || '')
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .concat(DEFAULT_IVR_WEBHOOK_ALLOWED_IPS)
    )
  ),
  ivrJobWhatsappTemplateName: process.env.IVR_JOB_WHATSAPP_TEMPLATE_NAME || '',
  ivrJobWhatsappTemplateNameEn:
    process.env.IVR_JOB_WHATSAPP_TEMPLATE_NAME_EN || 'ivr_continue_reply_en',
  ivrJobWhatsappTemplateNameMl: process.env.IVR_JOB_WHATSAPP_TEMPLATE_NAME_ML || '',
  ivrJobWhatsappTemplateLanguageEn: process.env.IVR_JOB_WHATSAPP_TEMPLATE_LANGUAGE_EN || 'en',
  ivrJobWhatsappTemplateLanguageMl: process.env.IVR_JOB_WHATSAPP_TEMPLATE_LANGUAGE_ML || 'ml',
  ivrJobWhatsappPhoneNumberId:
    process.env.IVR_JOB_WHATSAPP_PHONE_NUMBER_ID ||
    process.env.PROVIDER_SUPPORT_WHATSAPP_PHONE_NUMBER_ID ||
    '1152619794595125',
  providerSupportPhoneNumberId: process.env.PROVIDER_SUPPORT_WHATSAPP_PHONE_NUMBER_ID || '',
  providerSupportBotWhatsappNumber: process.env.PROVIDER_SUPPORT_BOT_WHATSAPP_NUMBER || '917736129809',
  providerSupportJoiningChatbotUrl:
    process.env.PROVIDER_SUPPORT_JOINING_CHATBOT_URL || 'https://wa.me/919633108778',
  providerSupportCustomerCareWhatsappUrl:
    process.env.PROVIDER_SUPPORT_CUSTOMER_CARE_WHATSAPP_URL || 'https://wa.me/919446600809',
  providerSupportPhone: process.env.PROVIDER_SUPPORT_PHONE || '8714105333',
  providerSupportAndroidAppUrl:
    process.env.PROVIDER_SUPPORT_ANDROID_APP_URL ||
    'https://play.google.com/store/apps/details?id=com.pulso.global',
  providerSupportIosAppUrl:
    process.env.PROVIDER_SUPPORT_IOS_APP_URL || 'https://apps.apple.com/in/app/pulso/id6757874217',
  mediaStorageDir: resolveMediaStorageDir(),
  dryRun: process.env.WHATSAPP_DRY_RUN !== 'false',
  publicDir: path.join(__dirname, 'public')
};
