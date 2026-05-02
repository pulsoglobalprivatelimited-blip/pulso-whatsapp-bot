const config = require('../config');
const fs = require('fs');
const path = require('path');
const {
  MESSAGES,
  STATUS,
  BUTTON_IDS,
  QUALIFICATIONS,
  DISTRICTS,
  REGION_OPTIONS,
  UI_TEXT,
  getFlowConfig,
  runWithProviderFlow
} = require('../flow');
const { sendText, sendButtons, sendList, sendTemplate } = require('./metaClient');
const {
  getOrCreateProvider,
  updateProvider,
  appendHistory,
  getProvider,
  listProviders
} = require('./providerService');
const {
  getRejectReasonDetails,
  isReviewerPhone,
  notifyAgentHelpRequested,
  notifyAdditionalDocumentRequested,
  notifyAdditionalDocumentUploaded,
  parseReviewerAction,
  notifyCertificateUploaded,
  notifyCertificateReviewed,
  notifyOnboardingCompleted,
  promptAdditionalDocumentNoteEntry,
  promptRejectNoteEntry,
  requestAdditionalDocumentConfirmation,
  requestRejectNoteOrConfirmation,
  requestRejectReason,
  requestReviewConfirmation
} = require('./opsNotifications');
const { isPreOnboardedPhone } = require('./preOnboardedService');
const {
  getMessageText,
  parseRegion,
  parseQualification,
  isQualificationDeclined,
  isInterested,
  isNotInterested,
  parseDutyHourPreference,
  parseSampleDutyOfferPreference,
  parseExpectedDutiesResponse,
  parseAge,
  parseAgeCorrectionAction,
  parseSex,
  parseDistrict,
  parseDistrictListAction,
  parseTermsAcceptance,
  parsePulsoAppInstallInterest,
  parsePulsoAppDevice,
  parsePulsoAppActivationAction,
  parsePulsoAppHelpReason,
  parseTermsReminderResume,
  parseCertificateCollectionAction,
  classifyDocument
} = require('./messageParser');
const { archiveIncomingMedia } = require('./mediaStorage');
const { syncProviderToPulsoHub } = require('./pulsoHubSyncService');

const pendingCertificatePromptTimers = new Map();
const pendingCertificateRetryTimers = new Map();
const CERTIFICATE_PROMPT_DEBOUNCE_MS = 5000;
const AGENT_HELP_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const TERMS_REMINDER_HISTORY_EVENT = 'terms_acceptance_reminder_sent';
const MOBILE_APP_CAMPAIGN_STATUS = {
  REQUIRED: 'required',
  ANNOUNCEMENT_SENT: 'announcement_sent',
  INSTALL_INTEREST_YES: 'install_interest_yes',
  INSTALL_INTEREST_NO: 'install_interest_no',
  DEVICE_ANDROID: 'device_android',
  DEVICE_IPHONE: 'device_iphone',
  ANDROID_LINK_SENT: 'android_link_sent',
  IPHONE_LINK_SENT: 'iphone_link_sent',
  ACTIVATION_PENDING: 'activation_pending',
  HELP_REQUESTED: 'help_requested',
  LATER_SELECTED: 'later_selected',
  APP_VERIFIED: 'app_verified',
  COMPLETED: 'completed'
};
const MOBILE_APP_STAGE_INSTALL_INTEREST = 'awaiting_install_interest';
const MOBILE_APP_STAGE_DEVICE = 'awaiting_device';
const MOBILE_APP_STAGE_INSTALLED_CONFIRMATION = 'awaiting_installed_confirmation';
const MOBILE_APP_STAGE_HELP_REASON = 'awaiting_help_reason';
const MOBILE_APP_STAGE_ACTIVATION_PENDING = 'activation_pending_verification';

let termsReminderInterval = null;

function buildAgentHelpMessage() {
  return 'Pulso support team ഉടൻ തന്നെ താങ്കളെ ബന്ധപ്പെടുന്നതാണ്.';
}

function getAgentHelpCooldownRemainingMs(provider) {
  const requestedAt = provider && provider.agentHelpRequestedAt ? Date.parse(provider.agentHelpRequestedAt) : NaN;
  if (!requestedAt) {
    return 0;
  }

  const remainingMs = AGENT_HELP_COOLDOWN_MS - (Date.now() - requestedAt);
  return remainingMs > 0 ? remainingMs : 0;
}

function canRequestAgentHelp(provider) {
  return getAgentHelpCooldownRemainingMs(provider) === 0;
}

function buildAdditionalDocumentMessage(note) {
  return MESSAGES.additionalDocumentRequest.replace('{{note}}', note);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function handleAgentHelpRequest(phone) {
  const provider = await getProvider(phone);
  if (provider && !canRequestAgentHelp(provider)) {
    await sendAndLog(phone, 'text', MESSAGES.agentHelpAlreadyRequested);
    return;
  }

  const nextStatus =
    provider && provider.termsAccepted ? STATUS.COMPLETED : STATUS.AWAITING_PULSO_AGENT;

  await updateProvider(phone, {
    agentHelpRequested: true,
    agentHelpRequestedAt: new Date().toISOString(),
    status: nextStatus
  });

  await appendHistory(phone, { type: 'system', event: 'agent_help_requested' });
  const updatedProvider = await getProvider(phone);
  await sendAndLog(phone, 'text', buildAgentHelpMessage());
  await notifyAgentHelpRequested(updatedProvider);
}

async function sendAndLog(phone, kind, body, sender) {
  try {
    if (kind === 'buttons') {
      await sendButtons(phone, body.body, body.buttons);
    } else if (kind === 'list') {
      await sendList(phone, body.body, body.buttonText, body.sections);
    } else if (kind === 'template') {
      await sendTemplate(phone, body.name, body.languageCode, body.components);
    } else {
      await sendText(phone, body);
    }
  } catch (error) {
    console.error(
      '[WHATSAPP_SEND_ERROR]',
      JSON.stringify(
        {
          phone,
          kind,
          body,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    throw error;
  }

  await appendHistory(phone, {
    type: 'outbound_message',
    sender: sender || 'bot',
    payload: { kind, body }
  });
}

function updateStatus(phone, status, currentStep, extra = {}) {
  return updateProvider(phone, { status, currentStep, ...extra });
}

function hasCompletedProfile(provider) {
  return Boolean(
    provider &&
      provider.fullName &&
      provider.age &&
      provider.sex &&
      provider.district
  );
}

async function sendCertificateCollectionButtons(phone, provider) {
  await sendIfChanged(phone, provider, 'buttons', {
    body: MESSAGES.certificateUploadProgress,
    buttons: [
      { id: BUTTON_IDS.CERTIFICATE_ADD_MORE, title: UI_TEXT.certificateAddMoreTitle },
      { id: BUTTON_IDS.CERTIFICATE_CONTINUE, title: UI_TEXT.certificateContinueTitle }
    ]
  });
}

function clearPendingCertificatePrompt(phone) {
  const timer = pendingCertificatePromptTimers.get(phone);
  if (timer) {
    clearTimeout(timer);
    pendingCertificatePromptTimers.delete(phone);
  }
}

function scheduleCertificateCollectionPrompt(phone) {
  clearPendingCertificatePrompt(phone);
  const timer = setTimeout(async () => {
    pendingCertificatePromptTimers.delete(phone);
    try {
      const provider = await getProvider(phone);
      if (!provider || provider.status !== STATUS.AWAITING_CERTIFICATE) {
        return;
      }

      await runWithProviderFlow(provider, async () => {
      const attachments = provider.documents && provider.documents.certificateAttachments
        ? provider.documents.certificateAttachments
        : [];

      if (!attachments.length || attachments.length >= 4) {
        return;
      }

      await sendCertificateCollectionButtons(phone, provider);
      });
    } catch (error) {
      console.error('[CERTIFICATE_PROMPT_SCHEDULE_ERROR]', error);
    }
  }, CERTIFICATE_PROMPT_DEBOUNCE_MS);

  pendingCertificatePromptTimers.set(phone, timer);
}

function clearPendingCertificateRetry(phone) {
  const timer = pendingCertificateRetryTimers.get(phone);
  if (timer) {
    clearTimeout(timer);
    pendingCertificateRetryTimers.delete(phone);
  }
}

function scheduleCertificateRetry(phone) {
  clearPendingCertificateRetry(phone);
  const timer = setTimeout(async () => {
    pendingCertificateRetryTimers.delete(phone);
    try {
      const provider = await getProvider(phone);
      if (!provider || provider.status !== STATUS.AWAITING_CERTIFICATE) {
        return;
      }

      await runWithProviderFlow(provider, async () => {
      const attachments = provider.documents && provider.documents.certificateAttachments
        ? provider.documents.certificateAttachments
        : [];

      if (attachments.length) {
        return;
      }

      await sendIfChanged(phone, provider, 'text', MESSAGES.certificateRetry);
      });
    } catch (error) {
      console.error('[CERTIFICATE_RETRY_SCHEDULE_ERROR]', error);
    }
  }, CERTIFICATE_PROMPT_DEBOUNCE_MS);

  pendingCertificateRetryTimers.set(phone, timer);
}

function buildReviewerWorkflowPatch(existing, patch) {
  return {
    verification: {
      reviewerWorkflow: patch === null ? null : { ...(existing || {}), ...patch }
    }
  };
}

async function recordInbound(phone, message) {
  return appendHistory(phone, {
    type: 'inbound_message',
    payload: message
  });
}

function hasProcessedMessage(provider, messageId) {
  if (!messageId || !provider || !Array.isArray(provider.history)) {
    return false;
  }

  return provider.history.some(
    (event) => event.type === 'inbound_message' && event.payload && event.payload.id === messageId
  );
}

function lastOutboundSignature(provider) {
  if (!provider || !Array.isArray(provider.history)) {
    return null;
  }

  for (let index = provider.history.length - 1; index >= 0; index -= 1) {
    const event = provider.history[index];
    if (event.type === 'outbound_message') {
      return JSON.stringify(event.payload);
    }
  }

  return null;
}

async function sendIfChanged(phone, provider, kind, body) {
  const nextSignature = JSON.stringify({ kind, body });
  if (lastOutboundSignature(provider) === nextSignature) {
    return;
  }

  await sendAndLog(phone, kind, body);
}

async function sendQualificationList(phone) {
  await sendAndLog(phone, 'list', {
    body: MESSAGES.welcomeQualification,
    buttonText: UI_TEXT.qualificationButtonText,
    sections: [
      {
        title: UI_TEXT.qualificationSectionTitle,
        rows: QUALIFICATIONS
      }
    ]
  });
}

async function sendDistrictList(phone) {
  const provider = await getProvider(phone);
  const pageSize = UI_TEXT.districtPageSize || 7;
  const pageCount = Math.max(1, Math.ceil(DISTRICTS.length / pageSize));
  const requestedPage = Number(provider && provider.districtListPage) || 1;
  const page = Math.min(Math.max(requestedPage, 1), pageCount);
  const start = (page - 1) * pageSize;
  const rows = [...DISTRICTS.slice(start, start + pageSize)];

  if (page < pageCount) {
    rows.push({
      id: BUTTON_IDS.DISTRICT_PAGE_NEXT,
      title: UI_TEXT.nextListTitle,
      description: UI_TEXT.nextListDescription
    });
  }

  if (page > 1) {
    rows.push({
      id: BUTTON_IDS.DISTRICT_PAGE_PREVIOUS,
      title: UI_TEXT.previousListTitle,
      description: UI_TEXT.previousListDescription
    });
  }

  await sendAndLog(phone, 'list', {
    body: page === 1 ? MESSAGES.districtQuestion : MESSAGES.districtListQuestion,
    buttonText: UI_TEXT.districtButtonText,
    sections: [
      {
        title: UI_TEXT.districtSectionTitle,
        rows
      }
    ]
  });
}

async function sendQualificationHelpButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.qualificationGoBack,
    buttons: [{ id: BUTTON_IDS.QUALIFICATION_GO_BACK, title: UI_TEXT.qualificationGoBackTitle }]
  });
}

async function sendInterestButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.interestQuestion,
    buttons: [
      { id: BUTTON_IDS.INTEREST_YES, title: UI_TEXT.interestYesTitle },
      { id: BUTTON_IDS.INTEREST_NO, title: UI_TEXT.interestNoTitle }
    ]
  });
}

async function sendSexButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.sexQuestion,
    buttons: [
      { id: BUTTON_IDS.SEX_MALE, title: 'Male' },
      { id: BUTTON_IDS.SEX_FEMALE, title: 'Female' }
    ]
  });
}

async function sendDutyHourPreferenceButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.dutyHourPreferenceQuestion,
    buttons: [
      { id: BUTTON_IDS.DUTY_HOUR_8, title: '8 hour' },
      { id: BUTTON_IDS.DUTY_HOUR_24, title: '24 hour' },
      { id: BUTTON_IDS.DUTY_HOUR_BOTH, title: UI_TEXT.dutyBothTitle }
    ]
  });
  await sendAndLog(phone, 'text', MESSAGES.dutyHourPaymentSummary || '8 hour (8 am to 6 pm) - 900rs per day\n24 hour - 1200 rs per day');
}

async function sendSampleDutyOfferPrompt(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.sampleDutyOfferQuestion,
    buttons: [
      { id: BUTTON_IDS.SAMPLE_DUTY_YES, title: UI_TEXT.sampleYesTitle },
      { id: BUTTON_IDS.SAMPLE_DUTY_NO, title: UI_TEXT.sampleNoTitle }
    ]
  });
}

function getOtherDutyPreference(value) {
  if (value === 'both') return null;
  return value === '24_hour' ? '8_hour' : '24_hour';
}

function getSampleDutyMessage(value) {
  if (value === 'both') return null;
  return value === '24_hour' ? MESSAGES.sampleDutyOffer24Hour : MESSAGES.sampleDutyOffer8Hour;
}

function getOtherSampleQuestion(value) {
  if (value === 'both') return null;
  return value === '24_hour'
    ? MESSAGES.sampleDutyOtherOffer24HourQuestion
    : MESSAGES.sampleDutyOtherOffer8HourQuestion;
}

async function sendOtherSamplePrompt(phone, dutyHourPreference) {
  await sendAndLog(phone, 'buttons', {
    body: getOtherSampleQuestion(dutyHourPreference),
    buttons: [
      { id: BUTTON_IDS.SAMPLE_DUTY_YES, title: UI_TEXT.sampleYesTitle },
      { id: BUTTON_IDS.SAMPLE_DUTY_NO, title: UI_TEXT.sampleNoTitle }
    ]
  });
}

async function sendFinalDutyChoiceButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.sampleDutyFinalChoiceQuestion,
    buttons: [
      { id: BUTTON_IDS.DUTY_HOUR_8, title: '8 hour' },
      { id: BUTTON_IDS.DUTY_HOUR_24, title: '24 hour' },
      { id: BUTTON_IDS.DUTY_HOUR_BOTH, title: UI_TEXT.dutyBothTitle }
    ]
  });
}

async function notify8HourNoStayOrFood(phone, dutyHourPreference) {
  if (!['8_hour', 'both'].includes(dutyHourPreference)) {
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.dutyHourPreference8HourNotice);
}

async function moveToExpectedDuties(phone, dutyHourPreference) {
  await notify8HourNoStayOrFood(phone, dutyHourPreference);
  await updateStatus(phone, STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION, 7, {
    dutyHourPreference,
    sampleDutyState: null
  });
  await sendExpectedDutiesFlow(phone);
}

async function sendExpectedDutiesFlow(phone) {
  await sendAndLog(phone, 'text', MESSAGES.expectedDutiesIntroOne);
  await sendAndLog(phone, 'text', MESSAGES.expectedDutiesIntroTwo);
  await sendAndLog(phone, 'text', MESSAGES.expectedDutiesIntroThree);
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.expectedDutiesQuestion,
    buttons: [
      { id: BUTTON_IDS.EXPECTED_DUTIES_YES, title: UI_TEXT.expectedDutiesYesTitle },
      { id: BUTTON_IDS.EXPECTED_DUTIES_NO, title: UI_TEXT.expectedDutiesNoTitle }
    ]
  });
}

async function sendAgeCorrectionButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.ageAboveLimitOptions,
    buttons: [
      { id: BUTTON_IDS.AGE_RETRY_ENTRY, title: UI_TEXT.ageRetryTitle },
      { id: BUTTON_IDS.AGE_CONFIRM_EXIT, title: UI_TEXT.ageExitTitle }
    ]
  });
}

async function sendAgeFinalRejectionButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.ageFinalRejectionOptions,
    buttons: [
      { id: BUTTON_IDS.AGE_EDIT_AFTER_REJECTION, title: UI_TEXT.ageEditTitle },
      { id: BUTTON_IDS.AGE_CLOSE_AFTER_REJECTION, title: UI_TEXT.ageExitTitle }
    ]
  });
}

async function sendTermsButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.termsQuestion,
    buttons: [
      { id: BUTTON_IDS.TERMS_ACCEPT, title: UI_TEXT.termsAcceptTitle },
      { id: BUTTON_IDS.TERMS_DECLINE, title: UI_TEXT.termsDeclineTitle }
    ]
  });
}

async function sendPulsoAppInstallInterestButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.pulsoAppInstallQuestion,
    buttons: [
      { id: BUTTON_IDS.PULSO_APP_DEVICE_ANDROID, title: UI_TEXT.appDeviceAndroidTitle },
      { id: BUTTON_IDS.PULSO_APP_DEVICE_IPHONE, title: UI_TEXT.appDeviceIphoneTitle },
      { id: BUTTON_IDS.PULSO_APP_NEED_HELP, title: UI_TEXT.appNeedHelpTitle }
    ]
  });
}

async function sendPulsoAppDeviceButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.pulsoAppDeviceQuestion,
    buttons: [
      { id: BUTTON_IDS.PULSO_APP_DEVICE_ANDROID, title: UI_TEXT.appDeviceAndroidTitle },
      { id: BUTTON_IDS.PULSO_APP_DEVICE_IPHONE, title: UI_TEXT.appDeviceIphoneTitle },
      { id: BUTTON_IDS.PULSO_APP_NEED_HELP, title: UI_TEXT.appNeedHelpTitle }
    ]
  });
}

async function sendPulsoAppInstalledConfirmationButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.pulsoAppInstalledQuestion,
    buttons: [
      { id: BUTTON_IDS.PULSO_APP_INSTALLED, title: UI_TEXT.appInstalledTitle },
      { id: BUTTON_IDS.PULSO_APP_NEED_HELP, title: UI_TEXT.appNeedHelpTitle },
      { id: BUTTON_IDS.PULSO_APP_LATER, title: UI_TEXT.appLaterTitle }
    ]
  });
}

async function sendPulsoAppHelpReasonButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.pulsoAppHelpQuestion,
    buttons: [
      { id: BUTTON_IDS.PULSO_APP_HELP_INSTALL, title: UI_TEXT.appHelpInstallTitle },
      { id: BUTTON_IDS.PULSO_APP_HELP_LOGIN_OTP, title: UI_TEXT.appHelpLoginOtpTitle },
      { id: BUTTON_IDS.PULSO_APP_HELP_NO_SMARTPHONE, title: UI_TEXT.appHelpNoSmartphoneTitle }
    ]
  });
}

async function sendPostOnboardingWrapUp(phone, sender = 'bot') {
  await updateProvider(phone, {
    pulsoAppPromptStage: null,
    mobileAppCampaignStage: null,
    mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.COMPLETED,
    postOnboardingCompletedAt: new Date().toISOString()
  });
  await sendAndLog(phone, 'text', MESSAGES.postOnboardingSupport, sender);
  await sendAndLog(phone, 'text', MESSAGES.postOnboardingContactSupport, sender);
  await sendAndLog(phone, 'text', MESSAGES.postOnboardingLinks, sender);
}

async function sendMobileAppCampaignClosing(phone, sender = 'bot') {
  await updateProvider(phone, {
    pulsoAppPromptStage: null,
    mobileAppCampaignStage: null,
    mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.COMPLETED,
    mobileAppCampaignCompletedAt: new Date().toISOString()
  });
  await sendAndLog(phone, 'text', MESSAGES.mobileAppCampaignThanks, sender);
}

async function finishMobileAppFlow(phone, provider, sender = 'bot') {
  if (provider && provider.mobileAppCampaignSource === 'post_onboarding') {
    await sendPostOnboardingWrapUp(phone, sender);
    return;
  }

  await sendMobileAppCampaignClosing(phone, sender);
}

function buildTermsReminderMessage() {
  const keyword = config.termsReminderResumeKeyword || 'continue';
  return (MESSAGES.termsReminder || '').replace('"continue"', `"${keyword}"`);
}

function getTermsReminderScheduleHours() {
  return [config.termsFirstReminderDelayHours, config.termsSecondReminderDelayHours]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
}

function getTermsReminderCount(provider) {
  const explicitCount = Number(provider && provider.termsReminderCount);
  if (Number.isFinite(explicitCount) && explicitCount >= 0) {
    return explicitCount;
  }

  return provider && provider.termsReminderSentAt ? 1 : 0;
}

function getNextTermsReminderDelayHours(provider) {
  const scheduleHours = getTermsReminderScheduleHours();
  return scheduleHours[getTermsReminderCount(provider)] || null;
}

function hasReminderCapacityRemaining(provider) {
  return getNextTermsReminderDelayHours(provider) !== null;
}

function hasHistoryEvent(provider, predicate) {
  const history = Array.isArray(provider && provider.history) ? provider.history : [];
  return history.some(predicate);
}

function getLastTermsAcceptHistoryEntry(provider) {
  const history = Array.isArray(provider && provider.history) ? provider.history : [];
  const acceptEntries = history.filter(
    (entry) =>
      entry &&
      entry.type === 'inbound_message' &&
      entry.payload &&
      entry.payload.interactive &&
      entry.payload.interactive.button_reply &&
      entry.payload.interactive.button_reply.id === BUTTON_IDS.TERMS_ACCEPT
  );

  return acceptEntries.length ? acceptEntries[acceptEntries.length - 1] : null;
}

function getTermsSentAt(provider) {
  if (!provider) {
    return null;
  }

  if (provider.termsSentAt) {
    return provider.termsSentAt;
  }

  if (provider.verification && provider.verification.reviewedAt) {
    return provider.verification.reviewedAt;
  }

  return null;
}

function hasReminderBeenSent(provider) {
  return getTermsReminderCount(provider) > 0;
}

function isLegacyWaitingForTermsProvider(provider) {
  if (!provider || !provider.phone || provider.termsAccepted) {
    return false;
  }

  if (provider.status !== STATUS.AWAITING_TERMS_ACCEPTANCE) {
    return false;
  }

  if (provider.termsSentAt || hasReminderBeenSent(provider)) {
    return false;
  }

  return true;
}

function isCurrentWaitingForTermsWithoutReminder(provider) {
  if (!provider || !provider.phone || provider.termsAccepted) {
    return false;
  }

  if (provider.status !== STATUS.AWAITING_TERMS_ACCEPTANCE) {
    return false;
  }

  if (hasReminderBeenSent(provider)) {
    return false;
  }

  return true;
}

function isTermsReminderDue(provider, now = Date.now()) {
  if (!provider || !provider.phone || provider.termsAccepted) {
    return false;
  }

  if (provider.status !== STATUS.AWAITING_TERMS_ACCEPTANCE) {
    return false;
  }

  if (!hasReminderCapacityRemaining(provider)) {
    return false;
  }

  const termsSentAt = getTermsSentAt(provider);
  if (!termsSentAt) {
    return false;
  }

  const sentAtMs = Date.parse(termsSentAt);
  if (Number.isNaN(sentAtMs)) {
    return false;
  }

  const nextReminderDelayHours = getNextTermsReminderDelayHours(provider);
  if (nextReminderDelayHours === null) {
    return false;
  }

  return now - sentAtMs >= nextReminderDelayHours * 60 * 60 * 1000;
}

async function sendTermsReminder(phone, sender = 'bot') {
  const templateName = String(config.termsReminderTemplateName || '').trim();
  if (templateName) {
    await sendAndLog(phone, 'template', {
      name: templateName,
      languageCode: config.termsReminderTemplateLanguage || 'en',
      components: []
    }, sender);
    return 'template';
  }

  await sendAndLog(phone, 'text', buildTermsReminderMessage(), sender);
  return 'text';
}

async function finalizeTermsAcceptance(phone, provider, sender = 'bot', options = {}) {
  const completionTime = options.completedAt || new Date().toISOString();
  const currentProvider = provider || (await getProvider(phone));
  if (!currentProvider) {
    throw new Error('Provider not found');
  }

  return runWithProviderFlow(currentProvider, async () => {
  await updateStatus(phone, STATUS.COMPLETED, 15, {
    termsAccepted: true,
    pulsoAppRequired: true,
    pulsoAppActivationStatus: 'required',
    pulsoAppPromptStage: MOBILE_APP_STAGE_DEVICE,
    mobileAppCampaignStage: MOBILE_APP_STAGE_DEVICE,
    mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.REQUIRED,
    mobileAppCampaignSource: 'post_onboarding',
    mobileAppCampaignSentAt: new Date().toISOString(),
    termsReminderReplyReceivedAt:
      currentProvider && currentProvider.termsReminderReplyReceivedAt
        ? currentProvider.termsReminderReplyReceivedAt
        : null,
    agentHelpRequested: false,
    agentHelpRequestedAt: null,
    completedAt: completionTime
  });

  const completedProvider = await getProvider(phone);
  const hasCompletedEvent = hasHistoryEvent(
    completedProvider,
    (entry) => entry && entry.type === 'system' && entry.event === 'onboarding_completed'
  );
  if (!hasCompletedEvent) {
    await appendHistory(phone, { type: 'system', event: 'onboarding_completed' });
  }

  const refreshedProvider = await getProvider(phone);
  const sentTermsAcceptedMessage = hasHistoryEvent(
    refreshedProvider,
    (entry) =>
      entry &&
      entry.type === 'outbound_message' &&
      entry.payload &&
      entry.payload.kind === 'text' &&
      entry.payload.body === MESSAGES.termsAccepted
  );
  if (!sentTermsAcceptedMessage) {
    await sendAndLog(phone, 'text', MESSAGES.termsAccepted, sender);
  }

  const sentPulsoAppQuestion = hasHistoryEvent(
    refreshedProvider,
    (entry) =>
      entry &&
      entry.type === 'outbound_message' &&
      entry.payload &&
      entry.payload.kind === 'buttons' &&
      entry.payload.body &&
      entry.payload.body.body === MESSAGES.pulsoAppInstallQuestion
  );
  if (!sentPulsoAppQuestion) {
    await sendAndLog(phone, 'text', MESSAGES.postOnboardingSupport, sender);
    await sendAndLog(phone, 'text', MESSAGES.pulsoAppPreferenceNotice, sender);
    await sendPulsoAppInstallInterestButtons(phone);
  }

  const finalProvider = await getProvider(phone);
  if (options.notifyOps !== false) {
    await notifyOnboardingCompleted(finalProvider);
  }

  try {
    const syncResult = await syncProviderToPulsoHub(finalProvider);
    await updateProvider(phone, {
      appSync: {
        status: syncResult.ok ? 'synced' : syncResult.skipped ? 'skipped' : 'failed',
        skipped: syncResult.skipped === true,
        reason: syncResult.reason || '',
        syncedAt: new Date().toISOString(),
        response: syncResult.data || null,
      },
    });
    await appendHistory(phone, {
      type: 'system',
      event: syncResult.ok ? 'pulso_hub_sync_completed' : 'pulso_hub_sync_skipped',
      details: syncResult.data || { reason: syncResult.reason || '' },
    });
  } catch (error) {
    console.error('[PULSO_HUB_SYNC_ERROR]', phone, error.message);
    await updateProvider(phone, {
      appSync: {
        status: 'failed',
        skipped: false,
        reason: error.message || 'sync_failed',
        syncedAt: new Date().toISOString(),
      },
    });
    await appendHistory(phone, {
      type: 'system',
      event: 'pulso_hub_sync_failed',
      details: { message: error.message || 'sync_failed' },
    });
  }

  return getProvider(phone);
  });
}

async function remindProviderToAcceptTerms(provider) {
  return runWithProviderFlow(provider, async () => {
  if (!provider || !provider.phone || !isTermsReminderDue(provider)) {
    return false;
  }

  const reminderKind = await sendTermsReminder(provider.phone, 'terms-reminder');
  const sentAt = new Date().toISOString();
  await updateProvider(provider.phone, {
    termsReminderSentAt: sentAt,
    termsReminderCount: getTermsReminderCount(provider) + 1,
    termsReminderKind: reminderKind
  });
  await appendHistory(provider.phone, { type: 'system', event: TERMS_REMINDER_HISTORY_EVENT, reminderKind });
  return true;
  });
}

function isCompletedProviderEligibleForMobileAppCampaign(provider) {
  return Boolean(
    provider &&
      provider.phone &&
      provider.status === STATUS.COMPLETED &&
      provider.termsAccepted === true &&
      provider.verification &&
      provider.verification.status === 'verified' &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.REQUIRED &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.COMPLETED &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.ANNOUNCEMENT_SENT &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.INSTALL_INTEREST_YES &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.INSTALL_INTEREST_NO &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.DEVICE_ANDROID &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.DEVICE_IPHONE &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.ANDROID_LINK_SENT &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.IPHONE_LINK_SENT &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.ACTIVATION_PENDING &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.HELP_REQUESTED &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.LATER_SELECTED &&
      provider.mobileAppCampaignStatus !== MOBILE_APP_CAMPAIGN_STATUS.APP_VERIFIED
  );
}

async function sendMobileAppCampaignToProvider(provider, sender = 'mobile-app-campaign') {
  return runWithProviderFlow(provider, async () => {
  if (!isCompletedProviderEligibleForMobileAppCampaign(provider)) {
    return false;
  }

  const sentAt = new Date().toISOString();
  await sendAndLog(provider.phone, 'text', MESSAGES.mobileAppCampaignAnnouncement, sender);
  await sendPulsoAppInstallInterestButtons(provider.phone);
  await updateProvider(provider.phone, {
    pulsoAppRequired: true,
    pulsoAppActivationStatus: 'required',
    pulsoAppPromptStage: MOBILE_APP_STAGE_DEVICE,
    mobileAppCampaignStage: MOBILE_APP_STAGE_DEVICE,
    mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.REQUIRED,
    mobileAppCampaignSource: 'completed_provider_campaign',
    mobileAppCampaignSentAt: sentAt
  });
  await appendHistory(provider.phone, {
    type: 'system',
    event: 'mobile_app_campaign_announcement_sent',
    sentAt
  });
  return true;
  });
}

async function runMobileAppCampaignForCompletedProviders(targetPhones = null) {
  const providers = await listProviders();
  const targetSet = Array.isArray(targetPhones) && targetPhones.length ? new Set(targetPhones) : null;
  const candidates = providers.filter((provider) => {
    if (targetSet && (!provider || !targetSet.has(provider.phone))) {
      return false;
    }

    return isCompletedProviderEligibleForMobileAppCampaign(provider);
  });

  if (!candidates.length) {
    console.log('[MOBILE_APP_CAMPAIGN] No eligible completed providers found');
    return { scanned: providers.length, eligible: 0, sent: 0, failed: 0, results: [] };
  }

  console.log(`[MOBILE_APP_CAMPAIGN] Sending to ${candidates.length} completed provider(s)`);
  const results = [];

  for (const provider of candidates) {
    try {
      const sent = await sendMobileAppCampaignToProvider(provider);
      results.push({ phone: provider.phone, sent });
      if (sent) {
        console.log(`[MOBILE_APP_CAMPAIGN] Sent to ${provider.phone}`);
      }
    } catch (error) {
      results.push({
        phone: provider.phone,
        sent: false,
        error: error.message || 'send_failed'
      });
      console.error(
        '[MOBILE_APP_CAMPAIGN_ERROR]',
        JSON.stringify(
          {
            phone: provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }
  }

  return {
    scanned: providers.length,
    eligible: candidates.length,
    sent: results.filter((item) => item.sent).length,
    failed: results.filter((item) => !item.sent).length,
    results
  };
}

async function sendLegacyTermsReminder(provider) {
  if (!isLegacyWaitingForTermsProvider(provider)) {
    return false;
  }

  const reminderKind = await sendTermsReminder(provider.phone, 'terms-reminder-backfill');
  const sentAt = new Date().toISOString();
  await updateProvider(provider.phone, {
    termsSentAt: getTermsSentAt(provider) || (provider.verification && provider.verification.reviewedAt) || sentAt,
    termsReminderSentAt: sentAt,
    termsReminderCount: getTermsReminderCount(provider) + 1,
    termsReminderKind: reminderKind
  });
  await appendHistory(provider.phone, {
    type: 'system',
    event: TERMS_REMINDER_HISTORY_EVENT,
    reminderKind,
    source: 'legacy_backfill'
  });
  return true;
}

async function runTermsReminderSweep() {
  const providers = await listProviders();
  const dueProviders = providers.filter((provider) => isTermsReminderDue(provider));

  if (!dueProviders.length) {
    console.log('[TERMS_REMINDER] No providers due for reminder');
    return { scanned: providers.length, due: 0, sent: 0 };
  }

  console.log(`[TERMS_REMINDER] Sending reminders to ${dueProviders.length} provider(s)`);
  let sent = 0;

  for (const provider of dueProviders) {
    try {
      const delivered = await remindProviderToAcceptTerms(provider);
      if (delivered) {
        sent += 1;
        console.log(`[TERMS_REMINDER] Reminder sent to ${provider.phone}`);
      }
    } catch (error) {
      console.error(
        '[TERMS_REMINDER_ERROR]',
        JSON.stringify(
          {
            phone: provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }
  }

  return { scanned: providers.length, due: dueProviders.length, sent };
}

async function runLegacyTermsReminderBackfill() {
  const providers = await listProviders();
  const legacyProviders = providers.filter((provider) => isLegacyWaitingForTermsProvider(provider));

  if (!legacyProviders.length) {
    console.log('[TERMS_REMINDER_BACKFILL] No legacy providers waiting for terms');
    return { scanned: providers.length, eligible: 0, sent: 0 };
  }

  console.log(`[TERMS_REMINDER_BACKFILL] Sending one-time reminders to ${legacyProviders.length} provider(s)`);
  let sent = 0;

  for (const provider of legacyProviders) {
    try {
      const delivered = await sendLegacyTermsReminder(provider);
      if (delivered) {
        sent += 1;
        console.log(`[TERMS_REMINDER_BACKFILL] Reminder sent to ${provider.phone}`);
      }
    } catch (error) {
      console.error(
        '[TERMS_REMINDER_BACKFILL_ERROR]',
        JSON.stringify(
          {
            phone: provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }
  }

  return { scanned: providers.length, eligible: legacyProviders.length, sent };
}

async function runCurrentWaitingTermsReminderBackfill() {
  const providers = await listProviders();
  const eligibleProviders = providers.filter((provider) => isCurrentWaitingForTermsWithoutReminder(provider));

  if (!eligibleProviders.length) {
    console.log('[TERMS_REMINDER_CURRENT_BACKFILL] No current waiting providers need a reminder');
    return { scanned: providers.length, eligible: 0, sent: 0 };
  }

  console.log(`[TERMS_REMINDER_CURRENT_BACKFILL] Sending one-time reminders to ${eligibleProviders.length} provider(s)`);
  let sent = 0;

  for (const provider of eligibleProviders) {
    try {
      const reminderKind = await sendTermsReminder(provider.phone, 'terms-reminder-manual-backfill');
      const sentAt = new Date().toISOString();
      await updateProvider(provider.phone, {
        termsSentAt: getTermsSentAt(provider) || (provider.verification && provider.verification.reviewedAt) || sentAt,
        termsReminderSentAt: sentAt,
        termsReminderCount: getTermsReminderCount(provider) + 1,
        termsReminderKind: reminderKind
      });
      await appendHistory(provider.phone, {
        type: 'system',
        event: TERMS_REMINDER_HISTORY_EVENT,
        reminderKind,
        source: 'current_backfill'
      });
      sent += 1;
      console.log(`[TERMS_REMINDER_CURRENT_BACKFILL] Reminder sent to ${provider.phone}`);
    } catch (error) {
      console.error(
        '[TERMS_REMINDER_CURRENT_BACKFILL_ERROR]',
        JSON.stringify(
          {
            phone: provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }
  }

  return { scanned: providers.length, eligible: eligibleProviders.length, sent };
}

async function reconcileAcceptedTermsProviders(targetPhones = null) {
  const providers = await listProviders();
  const targetSet = Array.isArray(targetPhones) && targetPhones.length ? new Set(targetPhones) : null;
  const stuckAcceptedProviders = providers.filter((provider) => {
    if (!provider || !provider.phone || provider.termsAccepted) {
      return false;
    }

    if (provider.status !== STATUS.AWAITING_TERMS_ACCEPTANCE) {
      return false;
    }

    if (targetSet && !targetSet.has(provider.phone)) {
      return false;
    }

    return Boolean(getLastTermsAcceptHistoryEntry(provider));
  });

  if (!stuckAcceptedProviders.length) {
    console.log('[TERMS_ACCEPT_RECONCILE] No stuck accepted providers found');
    return { scanned: providers.length, fixed: 0 };
  }

  console.log(`[TERMS_ACCEPT_RECONCILE] Reconciling ${stuckAcceptedProviders.length} accepted provider(s)`);
  let fixed = 0;

  for (const provider of stuckAcceptedProviders) {
    try {
      const lastAcceptEntry = getLastTermsAcceptHistoryEntry(provider);
      await finalizeTermsAcceptance(
        provider.phone,
        provider,
        'bot',
        { completedAt: lastAcceptEntry && lastAcceptEntry.at ? lastAcceptEntry.at : new Date().toISOString() }
      );
      fixed += 1;
      console.log(`[TERMS_ACCEPT_RECONCILE] Completed ${provider.phone}`);
    } catch (error) {
      console.error(
        '[TERMS_ACCEPT_RECONCILE_ERROR]',
        JSON.stringify(
          {
            phone: provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }
  }

  return { scanned: providers.length, fixed };
}

function startTermsReminderScheduler() {
  if (termsReminderInterval) {
    return termsReminderInterval;
  }

  const intervalMs = Math.max(1, config.termsReminderCheckIntervalMinutes) * 60 * 1000;
  termsReminderInterval = setInterval(() => {
    runTermsReminderSweep().catch((error) => {
      console.error('[TERMS_REMINDER_SCHEDULER_ERROR]', error);
    });
  }, intervalMs);

  return termsReminderInterval;
}

async function sendOptionalAgentHelpButton(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.optionalAgentHelp,
    buttons: [{ id: BUTTON_IDS.CONNECT_PULSO_AGENT, title: UI_TEXT.optionalAgentHelpTitle }]
  });
}

async function sendRegionSelectionList(phone) {
  await sendAndLog(phone, 'list', {
    body: 'Welcome to Pulso.\nPlease select your region.\n\nPulso-ലേക്ക് സ്വാഗതം.\nതാങ്കളുടെ region തിരഞ്ഞെടുക്കുക.',
    buttonText: UI_TEXT.regionButtonText || 'Select',
    sections: [
      {
        title: 'Region options',
        rows: REGION_OPTIONS
      }
    ]
  });
}

async function assignProviderFlow(phone, flowId, assignmentSource = 'user_selection') {
  const flow = getFlowConfig(flowId);
  await updateProvider(phone, {
    region: flow.region,
    language: flow.language,
    flowId: flow.id,
    flowAssignedAt: new Date().toISOString(),
    flowAssignmentSource: assignmentSource
  });
  await appendHistory(phone, {
    type: 'system',
    event: 'flow_assigned',
    flowId: flow.id,
    region: flow.region,
    language: flow.language,
    assignmentSource
  });
}

async function startFlow(phone) {
  const provider = await getOrCreateProvider(phone);
  if (!provider.flowId) {
    await updateStatus(phone, STATUS.AWAITING_REGION_SELECTION, 1.5);
    await sendRegionSelectionList(phone);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2);
  await sendQualificationList(phone);
}

async function handleRegionSelection(phone, message) {
  const flowId = parseRegion(message);
  if (!flowId) {
    await sendAndLog(phone, 'text', 'Please select Kerala or Karnataka to continue.');
    await sendRegionSelectionList(phone);
    return;
  }

  await assignProviderFlow(phone, flowId);
  const provider = await getProvider(phone);
  await runWithProviderFlow(provider, async () => {
    await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2);
    await sendQualificationList(phone);
  });
}

async function handleQualification(phone, message) {
  const qualification = parseQualification(message);
  if (isQualificationDeclined(message)) {
    await updateProvider(phone, {
      status: STATUS.NEEDS_HUMAN_REVIEW,
      currentStep: 2,
      qualification: null
    });
    await sendAndLog(phone, 'text', MESSAGES.notEligible);
    return;
  }

  if (qualification === 'go_back') {
    await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2, { qualification: null });
    await sendQualificationList(phone);
    return;
  }

  if (qualification === 'none_of_these') {
    await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2, { qualification: null });
    await sendAndLog(phone, 'text', MESSAGES.qualificationCertificateRequired);
    await sendQualificationHelpButtons(phone);
    return;
  }

  if (!qualification) {
    await sendAndLog(phone, 'text', MESSAGES.qualificationRetry);
    await sendQualificationList(phone);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_INTEREST, 4, { qualification });
  await sendAndLog(phone, 'text', MESSAGES.workingModel);
  await sendInterestButtons(phone);
}

async function handleInterest(phone, message) {
  if (isNotInterested(message)) {
    await updateProvider(phone, {
      status: STATUS.NOT_INTERESTED_RESTARTABLE,
      currentStep: 4,
      interestConfirmed: false
    });
    await sendAndLog(phone, 'text', MESSAGES.notInterested);
    return;
  }

  if (!isInterested(message)) {
    await sendAndLog(phone, 'text', MESSAGES.interestRetry);
    await sendInterestButtons(phone);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_DUTY_HOUR_PREFERENCE, 5, { interestConfirmed: true });
  await sendDutyHourPreferenceButtons(phone);
}

async function handleDutyHourPreference(phone, message) {
  const dutyHourPreference = parseDutyHourPreference(message);
  if (!dutyHourPreference) {
    await sendAndLog(phone, 'text', MESSAGES.dutyHourPreferenceRetry);
    await sendDutyHourPreferenceButtons(phone);
    return;
  }

  await notify8HourNoStayOrFood(phone, dutyHourPreference);
  await updateStatus(phone, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE, 6, {
    dutyHourPreference,
    sampleDutyState: {
      stage: dutyHourPreference === 'both' ? 'both_prompt' : 'initial_prompt',
      initialChoice: dutyHourPreference,
      alternateChoice: getOtherDutyPreference(dutyHourPreference)
    }
  });
  await sendSampleDutyOfferPrompt(phone);
}

async function handleSampleDutyOfferPreference(phone, message) {
  const provider = await getProvider(phone);
  const sampleDutyState = provider && provider.sampleDutyState
    ? provider.sampleDutyState
    : {
        stage: 'initial_prompt',
        initialChoice: provider ? provider.dutyHourPreference : null,
        alternateChoice: getOtherDutyPreference(provider ? provider.dutyHourPreference : null)
      };

  if (sampleDutyState.stage === 'final_choice') {
    const finalChoice = parseDutyHourPreference(message);
    if (!finalChoice) {
      await sendAndLog(phone, 'text', MESSAGES.sampleDutyFinalChoiceRetry);
      await sendFinalDutyChoiceButtons(phone);
      return;
    }

    await moveToExpectedDuties(phone, finalChoice);
    return;
  }

  const action = parseSampleDutyOfferPreference(message);
  if (!action) {
    await sendAndLog(phone, 'text', MESSAGES.sampleDutyOfferRetry);
    if (sampleDutyState.stage === 'other_prompt') {
      await sendOtherSamplePrompt(phone, sampleDutyState.alternateChoice);
      return;
    }
    await sendSampleDutyOfferPrompt(phone);
    return;
  }

  if (action === 'show') {
    if (sampleDutyState.initialChoice === 'both') {
      await sendAndLog(phone, 'text', MESSAGES.sampleDutyOffer8Hour);
      await sendAndLog(phone, 'text', MESSAGES.sampleDutyOffer24Hour);
      await moveToExpectedDuties(phone, 'both');
      return;
    }

    if (sampleDutyState.stage === 'other_prompt') {
      await sendAndLog(phone, 'text', getSampleDutyMessage(sampleDutyState.alternateChoice));
      await updateProvider(phone, {
        sampleDutyState: {
          ...sampleDutyState,
          stage: 'final_choice'
        }
      });
      await sendFinalDutyChoiceButtons(phone);
      return;
    }

    await sendAndLog(phone, 'text', getSampleDutyMessage(sampleDutyState.initialChoice));
    await updateProvider(phone, {
      sampleDutyState: {
        ...sampleDutyState,
        stage: 'other_prompt'
      }
    });
    await sendOtherSamplePrompt(phone, sampleDutyState.alternateChoice);
    return;
  }

  await moveToExpectedDuties(phone, sampleDutyState.initialChoice);
}

async function handleExpectedDutiesConfirmation(phone, message) {
  const action = parseExpectedDutiesResponse(message);
  if (action === 'decline') {
    await updateProvider(phone, {
      status: STATUS.NOT_INTERESTED_RESTARTABLE,
      currentStep: 6,
      expectedDutiesAccepted: false
    });
    await sendAndLog(phone, 'text', MESSAGES.expectedDutiesDeclined);
    return;
  }

  if (action !== 'accept') {
    await sendAndLog(phone, 'text', MESSAGES.expectedDutiesRetry);
    await sendExpectedDutiesFlow(phone);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_CERTIFICATE, 8, { expectedDutiesAccepted: true });
  await sendAndLog(phone, 'text', MESSAGES.certificateRequest);
}

async function addCertificate(phone, message) {
  const attachment = await archiveIncomingMedia(phone, message, 'certificate');
  const provider = (await getProvider(phone)) || (await getOrCreateProvider(phone));

  await updateProvider(phone, {
    documents: {
      ...provider.documents,
      certificateReceived: true,
      certificateAttachments: [
        ...(provider.documents.certificateAttachments || []),
        { ...attachment, receivedAt: new Date().toISOString() }
      ]
    }
  });
}

async function finalizeCertificateCollection(phone) {
  clearPendingCertificatePrompt(phone);
  clearPendingCertificateRetry(phone);
  const provider = await getProvider(phone);

  if (hasCompletedProfile(provider)) {
    await updateStatus(phone, STATUS.VERIFICATION_PENDING, 13, {
      verification: {
        status: 'pending',
        notes: '',
        reviewedAt: null,
        reviewedBy: null,
        notificationSentAt: null
      }
    });
    const refreshedProvider = await getProvider(phone);
    const attachments = refreshedProvider && refreshedProvider.documents
      ? refreshedProvider.documents.certificateAttachments || []
      : [];
    const notificationSent = await notifyCertificateUploaded(refreshedProvider, attachments);
    if (notificationSent) {
      await updateProvider(phone, {
        verification: {
          notificationSentAt: new Date().toISOString()
        }
      });
    }
    await appendHistory(phone, { type: 'system', event: 'verification_queue_created' });
    await sendAndLog(phone, 'text', MESSAGES.verificationPending);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_NAME, 9);
  await sendAndLog(phone, 'text', MESSAGES.nameQuestion);
}

async function adminUploadCertificateFiles(phone, files, uploadedBy = 'admin') {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  const uploads = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!uploads.length) {
    throw new Error('At least one certificate file is required');
  }

  const providerDir = path.join(config.mediaStorageDir, phone, 'certificate');
  ensureDir(providerDir);

  const existingAttachments = provider.documents && provider.documents.certificateAttachments
    ? provider.documents.certificateAttachments
    : [];
  const remainingSlots = Math.max(0, 4 - existingAttachments.length);
  if (!remainingSlots) {
    throw new Error('Certificate upload limit already reached for this provider');
  }

  const acceptedFiles = uploads.slice(0, remainingSlots);
  const archivedAt = new Date().toISOString();
  const attachments = acceptedFiles.map((file, index) => {
    const baseName = file.originalname || `manual-upload-${Date.now()}-${index}`;
    const safeName = String(baseName).replace(/[^\w.-]+/g, '_');
    const targetPath = path.join(providerDir, safeName);
    fs.writeFileSync(targetPath, file.buffer);

    return {
      id: null,
      type: file.mimetype && file.mimetype.startsWith('image/') ? 'image' : 'document',
      category: 'certificate',
      fileName: safeName,
      mimeType: file.mimetype || 'application/octet-stream',
      bytes: file.size || file.buffer.length,
      storagePath: targetPath,
      archived: true,
      archiveStatus: 'manual_upload',
      uploadedBy,
      archivedAt,
      receivedAt: archivedAt
    };
  });

  await updateProvider(phone, {
    documents: {
      ...provider.documents,
      certificateReceived: true,
      certificateAttachments: [...existingAttachments, ...attachments]
    }
  });
  await appendHistory(phone, {
    type: 'system',
    event: 'admin_certificate_uploaded',
    count: attachments.length,
    uploadedBy
  });

  const refreshedProvider = await getProvider(phone);
  if (!hasCompletedProfile(refreshedProvider)) {
    return refreshedProvider;
  }

  const alreadyApproved =
    refreshedProvider &&
    refreshedProvider.verification &&
    refreshedProvider.verification.status === 'verified';
  if (alreadyApproved || (refreshedProvider && refreshedProvider.termsAccepted)) {
    return refreshedProvider;
  }

  await updateStatus(phone, STATUS.VERIFICATION_PENDING, 13, {
    verification: {
      status: 'pending',
      notes: '',
      reviewedAt: null,
      reviewedBy: null,
      notificationSentAt: null
    }
  });
  const verificationProvider = await getProvider(phone);
  const notificationSent = await notifyCertificateUploaded(
    verificationProvider,
    verificationProvider && verificationProvider.documents
      ? verificationProvider.documents.certificateAttachments || []
      : []
  );
  if (notificationSent) {
    await updateProvider(phone, {
      verification: {
        notificationSentAt: new Date().toISOString()
      }
    });
  }
  await appendHistory(phone, { type: 'system', event: 'verification_queue_created' });
  return getProvider(phone);
}

async function handleCertificate(phone, message) {
  const provider = (await getProvider(phone)) || (await getOrCreateProvider(phone));
  const attachments = provider && provider.documents ? provider.documents.certificateAttachments || [] : [];
  const collectionAction = parseCertificateCollectionAction(message);

  if (collectionAction === 'continue') {
    clearPendingCertificatePrompt(phone);
    clearPendingCertificateRetry(phone);
    if (!attachments.length) {
      scheduleCertificateRetry(phone);
      return;
    }

    await finalizeCertificateCollection(phone);
    return;
  }

  if (collectionAction === 'add_more') {
    clearPendingCertificatePrompt(phone);
    clearPendingCertificateRetry(phone);
    if (!attachments.length) {
      scheduleCertificateRetry(phone);
      return;
    }

    await sendIfChanged(phone, provider, 'text', MESSAGES.certificateRetry);
    return;
  }

  const kind = classifyDocument(message);
  if (kind !== 'certificate') {
    if (attachments.length) {
      return;
    }
    scheduleCertificateRetry(phone);
    return;
  }

  clearPendingCertificateRetry(phone);

  if (attachments.length >= 4) {
    await sendAndLog(phone, 'text', MESSAGES.certificateUploadLimitReached);
    await finalizeCertificateCollection(phone);
    return;
  }

  await addCertificate(phone, message);
  const refreshedProvider = await getProvider(phone);
  const refreshedAttachments = refreshedProvider && refreshedProvider.documents
    ? refreshedProvider.documents.certificateAttachments || []
    : [];

  if (refreshedAttachments.length >= 4) {
    await sendAndLog(phone, 'text', MESSAGES.certificateUploadLimitReached);
    await finalizeCertificateCollection(phone);
    return;
  }

  scheduleCertificateCollectionPrompt(phone);
}

async function requestAdditionalDocument(phone, requestedBy, note) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  return runWithProviderFlow(provider, async () => {
  const trimmedNote = String(note || '').trim();
  if (!trimmedNote) {
    throw new Error('Custom note is required');
  }

  const reviewer = String(requestedBy || config.adminDefaultReviewer || 'ops-team').trim();
  const requestedAt = new Date().toISOString();

  await updateProvider(phone, {
    status: STATUS.ADDITIONAL_DOCUMENT_REQUESTED,
    currentStep: 13,
    documents: {
      ...provider.documents,
      additionalDocumentRequest: {
        status: 'pending',
        note: trimmedNote,
        requestedAt,
        requestedBy: reviewer,
        fulfilledAt: null
      }
    }
  });
  await appendHistory(phone, { type: 'system', event: 'additional_document_requested' });
  await sendAndLog(phone, 'text', buildAdditionalDocumentMessage(trimmedNote), reviewer);
  const updatedProvider = await getProvider(phone);
  await notifyAdditionalDocumentRequested(updatedProvider, reviewer, trimmedNote);
  return updatedProvider;
  });
}

async function handleAdditionalDocument(phone, message) {
  const provider = (await getProvider(phone)) || (await getOrCreateProvider(phone));
  const request = provider && provider.documents ? provider.documents.additionalDocumentRequest : null;
  const kind = classifyDocument(message);

  if (!request || request.status !== 'pending') {
    await updateProvider(phone, {
      status: STATUS.VERIFICATION_PENDING,
      currentStep: 13
    });
    await sendAndLog(phone, 'text', MESSAGES.verificationStillPending);
    return;
  }

  if (kind !== 'certificate') {
    await sendAndLog(phone, 'text', MESSAGES.additionalDocumentRetry);
    return;
  }

  const attachment = await archiveIncomingMedia(phone, message, 'additional-document');
  const receivedAt = new Date().toISOString();

  await updateProvider(phone, {
    status: STATUS.VERIFICATION_PENDING,
    currentStep: 13,
    verification: {
      status: 'pending'
    },
    documents: {
      ...provider.documents,
      additionalDocumentAttachments: [
        ...((provider.documents && provider.documents.additionalDocumentAttachments) || []),
        { ...attachment, receivedAt }
      ],
      additionalDocumentRequest: {
        ...(request || {}),
        status: 'fulfilled',
        fulfilledAt: receivedAt
      }
    }
  });
  await appendHistory(phone, { type: 'system', event: 'additional_document_received' });
  const updatedProvider = await getProvider(phone);
  await notifyAdditionalDocumentUploaded(
    updatedProvider,
    { ...attachment, receivedAt },
    updatedProvider && updatedProvider.documents ? updatedProvider.documents.additionalDocumentRequest : null
  );
  await sendAndLog(phone, 'text', MESSAGES.additionalDocumentReceived);
  await sendAndLog(phone, 'text', MESSAGES.verificationPending);
}

async function handleName(phone, message) {
  const name = getMessageText(message).trim();
  if (!name) {
    await sendAndLog(phone, 'text', MESSAGES.nameQuestion);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_AGE, 10, { fullName: name });
  await sendAndLog(phone, 'text', MESSAGES.ageQuestion);
}

async function handleAge(phone, message) {
  const ageAction = parseAgeCorrectionAction(message);
  if (ageAction === 'retry') {
    await updateStatus(phone, STATUS.AWAITING_AGE, 10, { age: null });
    await sendAndLog(phone, 'text', MESSAGES.ageQuestion);
    return;
  }

  if (ageAction === 'exit') {
    await updateProvider(phone, {
      status: STATUS.AGE_REJECTED,
      currentStep: 10
    });
    await sendAndLog(phone, 'text', MESSAGES.ageFinalRejection);
    await sendAgeFinalRejectionButtons(phone);
    return;
  }

  const age = parseAge(message);
  if (!age) {
    await sendAndLog(phone, 'text', MESSAGES.ageRetry);
    return;
  }

  if (age > 50) {
    await updateProvider(phone, {
      status: STATUS.AWAITING_AGE,
      currentStep: 10,
      age
    });
    await sendAndLog(phone, 'text', MESSAGES.ageAboveLimit);
    await sendAgeCorrectionButtons(phone);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_SEX, 11, { age });
  await sendSexButtons(phone);
}

async function handleAgeRejected(phone, message) {
  const ageAction = parseAgeCorrectionAction(message);
  if (ageAction === 'edit_after_rejection' || ageAction === 'retry') {
    await updateStatus(phone, STATUS.AWAITING_AGE, 10, { age: null });
    await sendAndLog(phone, 'text', MESSAGES.ageQuestion);
    return;
  }

  if (ageAction === 'close_after_rejection' || ageAction === 'exit') {
    await updateProvider(phone, {
      status: STATUS.NEEDS_HUMAN_REVIEW,
      currentStep: 10
    });
    await sendAndLog(phone, 'text', MESSAGES.ageRejectionClosed);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.ageFinalRejection);
  await sendAgeFinalRejectionButtons(phone);
}

async function handleSex(phone, message) {
  const sex = parseSex(message);
  if (!sex) {
    await sendAndLog(phone, 'text', MESSAGES.sexRetry);
    await sendSexButtons(phone);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_DISTRICT, 12, { sex, districtListPage: 1 });
  await sendDistrictList(phone);
}

async function handleDistrict(phone, message) {
  const provider = await getProvider(phone);
  const pageSize = UI_TEXT.districtPageSize || 7;
  const pageCount = Math.max(1, Math.ceil(DISTRICTS.length / pageSize));
  const currentPage = Math.min(Math.max(Number(provider && provider.districtListPage) || 1, 1), pageCount);
  const listAction = parseDistrictListAction(message);
  if (listAction === 'next') {
    await updateProvider(phone, { districtListPage: Math.min(currentPage + 1, pageCount) });
    await sendDistrictList(phone);
    return;
  }
  if (listAction === 'previous') {
    await updateProvider(phone, { districtListPage: Math.max(currentPage - 1, 1) });
    await sendDistrictList(phone);
    return;
  }

  const district = parseDistrict(message);
  if (!district) {
    await sendAndLog(phone, 'text', MESSAGES.districtRetry);
    await sendDistrictList(phone);
    return;
  }

  await updateStatus(phone, STATUS.VERIFICATION_PENDING, 13, {
    district,
    districtListPage: 1,
    verification: {
      status: 'pending',
      notes: '',
      reviewedAt: null,
      reviewedBy: null,
      notificationSentAt: null
    }
  });
  const updatedProvider = await getProvider(phone);
  const attachments = updatedProvider && updatedProvider.documents ? updatedProvider.documents.certificateAttachments || [] : [];
  const notificationSent = await notifyCertificateUploaded(updatedProvider, attachments);
  if (notificationSent) {
    await updateProvider(phone, {
      verification: {
        notificationSentAt: new Date().toISOString()
      }
    });
  }
  await appendHistory(phone, { type: 'system', event: 'verification_queue_created' });
  await sendAndLog(phone, 'text', MESSAGES.verificationPending);
}

async function handleTerms(phone, message) {
  const provider = await getProvider(phone);
  const action = parseTermsAcceptance(message);
  const resumeRequested = parseTermsReminderResume(message);
  if (action === 'connect_agent') {
    await handleAgentHelpRequest(phone);
    return;
  }

  if (resumeRequested && hasReminderBeenSent(provider)) {
    await updateProvider(phone, {
      termsReminderReplyReceivedAt: new Date().toISOString()
    });
    await sendAndLog(phone, 'text', MESSAGES.termsReminderResume);
    await sendAndLog(phone, 'text', MESSAGES.termsIntro);
    await sendTermsButtons(phone);
    return;
  }

  if (action === 'accept') {
    await finalizeTermsAcceptance(phone, provider, 'bot');
    return;
  }

  if (action === 'decline') {
    await updateProvider(phone, {
      status: STATUS.NOT_INTERESTED_RESTARTABLE,
      currentStep: 14,
      termsAccepted: false,
      termsDeclinedAt: new Date().toISOString()
    });
    await sendAndLog(phone, 'text', MESSAGES.termsDeclined);
    return;
  }

  await sendTermsButtons(phone);
}

async function handlePulsoAppInstallInterest(phone, message) {
  const action = parsePulsoAppInstallInterest(message);
  if (action === 'android' || action === 'iphone') {
    await handlePulsoAppDeviceSelection(phone, action);
    return;
  }

  if (action === 'need_help' || action === 'yes') {
    if (action === 'yes') {
      await sendPulsoAppDeviceButtons(phone);
      return;
    }
    await updateProvider(phone, {
      pulsoAppRequired: true,
      pulsoAppActivationStatus: 'help_requested',
      pulsoAppPromptStage: MOBILE_APP_STAGE_HELP_REASON,
      mobileAppCampaignStage: MOBILE_APP_STAGE_HELP_REASON,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.HELP_REQUESTED,
      pulsoAppHelpRequestedAt: new Date().toISOString()
    });
    await sendPulsoAppHelpReasonButtons(phone);
    return;
  }

  if (action === 'no') {
    await updateProvider(phone, {
      pulsoAppRequired: true,
      pulsoAppActivationStatus: 'later_selected',
      pulsoAppPromptStage: MOBILE_APP_STAGE_DEVICE,
      mobileAppCampaignStage: MOBILE_APP_STAGE_DEVICE,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.LATER_SELECTED,
      pulsoAppLaterSelectedAt: new Date().toISOString()
    });
    await sendAndLog(phone, 'text', MESSAGES.pulsoAppInstallDeclined);
    await sendPulsoAppDeviceButtons(phone);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.pulsoAppInstallRetry);
  await sendPulsoAppInstallInterestButtons(phone);
}

async function handlePulsoAppDevice(phone, message) {
  const device = parsePulsoAppDevice(message);
  if (device === 'need_help') {
    await updateProvider(phone, {
      pulsoAppRequired: true,
      pulsoAppActivationStatus: 'help_requested',
      pulsoAppPromptStage: MOBILE_APP_STAGE_HELP_REASON,
      mobileAppCampaignStage: MOBILE_APP_STAGE_HELP_REASON,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.HELP_REQUESTED,
      pulsoAppHelpRequestedAt: new Date().toISOString()
    });
    await sendPulsoAppHelpReasonButtons(phone);
    return;
  }

  if (device === 'iphone' || device === 'android') {
    await handlePulsoAppDeviceSelection(phone, device);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.pulsoAppDeviceRetry);
  await sendPulsoAppDeviceButtons(phone);
}

async function handlePulsoAppDeviceSelection(phone, device) {
  if (device === 'iphone') {
    await appendHistory(phone, {
      type: 'system',
      event: 'mobile_app_campaign_device_selected',
      device: MOBILE_APP_CAMPAIGN_STATUS.DEVICE_IPHONE
    });
    await updateProvider(phone, {
      pulsoAppRequired: true,
      pulsoAppDevice: 'iphone',
      mobileAppCampaignDevice: 'iphone',
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.IPHONE_LINK_SENT,
      pulsoAppActivationStatus: 'link_sent',
      pulsoAppPromptStage: MOBILE_APP_STAGE_INSTALLED_CONFIRMATION,
      mobileAppCampaignStage: MOBILE_APP_STAGE_INSTALLED_CONFIRMATION,
      pulsoAppLinkSentAt: new Date().toISOString()
    });
    await sendAndLog(phone, 'text', MESSAGES.pulsoAppIphoneLink);
    await sendPulsoAppInstalledConfirmationButtons(phone);
    return;
  }

  if (device === 'android') {
    await appendHistory(phone, {
      type: 'system',
      event: 'mobile_app_campaign_device_selected',
      device: MOBILE_APP_CAMPAIGN_STATUS.DEVICE_ANDROID
    });
    await updateProvider(phone, {
      pulsoAppRequired: true,
      pulsoAppDevice: 'android',
      mobileAppCampaignDevice: 'android',
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.ANDROID_LINK_SENT,
      pulsoAppActivationStatus: 'link_sent',
      pulsoAppPromptStage: MOBILE_APP_STAGE_INSTALLED_CONFIRMATION,
      mobileAppCampaignStage: MOBILE_APP_STAGE_INSTALLED_CONFIRMATION,
      pulsoAppLinkSentAt: new Date().toISOString()
    });
    await sendAndLog(phone, 'text', MESSAGES.pulsoAppAndroidLink);
    await sendPulsoAppInstalledConfirmationButtons(phone);
    return;
  }
}

async function handlePulsoAppInstalledConfirmation(phone, message) {
  const action = parsePulsoAppActivationAction(message);

  if (action === 'installed') {
    const now = new Date().toISOString();
    await updateProvider(phone, {
      pulsoAppInstalledConfirmedAt: now,
      pulsoAppActivationStatus: 'pending_verification',
      pulsoAppPromptStage: null,
      mobileAppCampaignStage: null,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.ACTIVATION_PENDING
    });
    await appendHistory(phone, { type: 'system', event: 'pulso_app_installed_confirmed' });
    await sendPostOnboardingWrapUp(phone);
    return;
  }

  if (action === 'need_help') {
    await updateProvider(phone, {
      pulsoAppActivationStatus: 'help_requested',
      pulsoAppPromptStage: null,
      mobileAppCampaignStage: null,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.HELP_REQUESTED,
      pulsoAppHelpRequestedAt: new Date().toISOString(),
      agentHelpRequested: true,
      agentHelpRequestedAt: new Date().toISOString()
    });
    await appendHistory(phone, { type: 'system', event: 'pulso_app_help_requested', reason: 'general_help' });
    const updatedProvider = await getProvider(phone);
    await notifyAgentHelpRequested(updatedProvider);
    await sendPostOnboardingWrapUp(phone);
    return;
  }

  if (action === 'later') {
    await updateProvider(phone, {
      pulsoAppActivationStatus: 'later_selected',
      pulsoAppPromptStage: null,
      mobileAppCampaignStage: null,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.LATER_SELECTED,
      pulsoAppLaterSelectedAt: new Date().toISOString()
    });
    await appendHistory(phone, { type: 'system', event: 'pulso_app_not_installed_selected' });
    await sendPostOnboardingWrapUp(phone);
    return;
  }

  await sendPulsoAppInstalledConfirmationButtons(phone);
}

async function handlePulsoAppHelpReason(phone, message) {
  const reason = parsePulsoAppHelpReason(message);
  if (!reason) {
    await sendPulsoAppHelpReasonButtons(phone);
    return;
  }

  const messageByReason = {
    install_help: MESSAGES.pulsoAppInstallHelp,
    login_otp_issue: MESSAGES.pulsoAppLoginOtpHelp,
    no_smartphone: MESSAGES.pulsoAppNoSmartphone
  };

  await updateProvider(phone, {
    pulsoAppActivationStatus: 'help_requested',
    pulsoAppHelpReason: reason,
    pulsoAppHelpRequestedAt: new Date().toISOString(),
    pulsoAppPromptStage: MOBILE_APP_STAGE_ACTIVATION_PENDING,
    mobileAppCampaignStage: MOBILE_APP_STAGE_ACTIVATION_PENDING,
    mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.HELP_REQUESTED,
    agentHelpRequested: true,
    agentHelpRequestedAt: new Date().toISOString()
  });
  await appendHistory(phone, { type: 'system', event: 'pulso_app_help_requested', reason });
  await sendAndLog(phone, 'text', messageByReason[reason]);
  const updatedProvider = await getProvider(phone);
  await notifyAgentHelpRequested(updatedProvider);
}

async function sendPulsoAppPendingOptions(phone) {
  await sendAndLog(phone, 'text', MESSAGES.mobileAppLinkHelp);
  await sendPulsoAppDeviceButtons(phone);
}

async function handleCompleted(phone, message) {
  const provider = await getProvider(phone);
  const mobileAppStage = provider && (provider.mobileAppCampaignStage || provider.pulsoAppPromptStage);
  if (mobileAppStage === MOBILE_APP_STAGE_INSTALL_INTEREST) {
    await handlePulsoAppInstallInterest(phone, message);
    return;
  }

  if (mobileAppStage === MOBILE_APP_STAGE_DEVICE) {
    await handlePulsoAppDevice(phone, message);
    return;
  }

  if (mobileAppStage === MOBILE_APP_STAGE_INSTALLED_CONFIRMATION) {
    await handlePulsoAppInstalledConfirmation(phone, message);
    return;
  }

  if (mobileAppStage === MOBILE_APP_STAGE_HELP_REASON) {
    await handlePulsoAppHelpReason(phone, message);
    return;
  }

  if (mobileAppStage === MOBILE_APP_STAGE_ACTIVATION_PENDING) {
    const activationAction = parsePulsoAppActivationAction(message);
    if (activationAction === 'need_help') {
      await updateProvider(phone, {
        pulsoAppActivationStatus: 'help_requested',
        pulsoAppPromptStage: MOBILE_APP_STAGE_HELP_REASON,
        mobileAppCampaignStage: MOBILE_APP_STAGE_HELP_REASON,
        mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.HELP_REQUESTED,
        pulsoAppHelpRequestedAt: new Date().toISOString()
      });
      await sendPulsoAppHelpReasonButtons(phone);
      return;
    }
    await sendPulsoAppPendingOptions(phone);
    return;
  }

  const requestedDeviceLink = parsePulsoAppDevice(message);
  if (requestedDeviceLink === 'iphone') {
    await handlePulsoAppDeviceSelection(phone, 'iphone');
    return;
  }
  if (requestedDeviceLink === 'android') {
    await handlePulsoAppDeviceSelection(phone, 'android');
    return;
  }
  if (requestedDeviceLink === 'need_help') {
    await updateProvider(phone, {
      pulsoAppActivationStatus: 'help_requested',
      pulsoAppPromptStage: MOBILE_APP_STAGE_HELP_REASON,
      mobileAppCampaignStage: MOBILE_APP_STAGE_HELP_REASON,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.HELP_REQUESTED,
      pulsoAppHelpRequestedAt: new Date().toISOString()
    });
    await sendPulsoAppHelpReasonButtons(phone);
    return;
  }

  const action = parseTermsAcceptance(message);
  if (action === 'connect_agent') {
    await handleAgentHelpRequest(phone);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.completed);
  if (provider && provider.pulsoAppRequired && provider.pulsoAppActivationStatus !== 'verified') {
    await sendPulsoAppPendingOptions(phone);
    return;
  }

  if (canRequestAgentHelp(provider)) {
    await sendOptionalAgentHelpButton(phone);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.agentHelpAlreadyRequested);
}

async function markPulsoAppActivationVerified(phone, verifiedBy = config.adminDefaultReviewer) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  return runWithProviderFlow(provider, async () => {
    const verifiedAt = new Date().toISOString();
    await updateProvider(phone, {
      pulsoAppRequired: true,
      pulsoAppActivationStatus: 'verified',
      pulsoAppActivationVerifiedAt: verifiedAt,
      pulsoAppActivationVerifiedBy: verifiedBy || config.adminDefaultReviewer,
      pulsoAppPromptStage: null,
      mobileAppCampaignStage: null,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.APP_VERIFIED,
      mobileAppCampaignCompletedAt: verifiedAt
    });
    await appendHistory(phone, {
      type: 'system',
      event: 'pulso_app_activation_verified',
      verifiedBy: verifiedBy || config.adminDefaultReviewer
    });
    await sendAndLog(phone, 'text', MESSAGES.pulsoAppActivationVerified, verifiedBy || config.adminDefaultReviewer);
    return getProvider(phone);
  });
}

async function clearReviewerWorkflow(phone) {
  const provider = await getProvider(phone);
  await updateProvider(phone, buildReviewerWorkflowPatch(provider && provider.verification && provider.verification.reviewerWorkflow, null));
}

async function handleReviewerMessage(phone, message) {
  const reviewAction = parseReviewerAction(message);
  const providerPhone = reviewAction && reviewAction.phone ? reviewAction.phone : null;

  if (reviewAction && reviewAction.action === 'note_text') {
    const candidates = await listProviders();
    const pendingProvider = candidates.find(
      (candidate) =>
        candidate &&
        candidate.verification &&
        candidate.verification.reviewerWorkflow &&
        candidate.verification.reviewerWorkflow.reviewerPhone === phone &&
        ['awaiting_note', 'awaiting_additional_document_note'].includes(candidate.verification.reviewerWorkflow.stage)
    );

    if (!pendingProvider) {
      await sendText(phone, 'No reviewer note is pending right now.');
      return;
    }

    const note = (reviewAction.note || '').trim();
    if (!note) {
      await sendText(phone, 'Please send a non-empty note.');
      return;
    }

    const workflow = pendingProvider.verification.reviewerWorkflow;
    if (workflow.stage === 'awaiting_additional_document_note') {
      await updateProvider(
        pendingProvider.phone,
        buildReviewerWorkflowPatch(workflow, {
          note,
          stage: 'awaiting_additional_document_confirmation'
        })
      );
      const refreshedProvider = await getProvider(pendingProvider.phone);
      await requestAdditionalDocumentConfirmation(refreshedProvider, note, phone);
      return;
    }

    await updateProvider(
      pendingProvider.phone,
      buildReviewerWorkflowPatch(workflow, {
        note,
        stage: 'awaiting_reject_confirmation'
      })
    );
    const refreshedProvider = await getProvider(pendingProvider.phone);
    await requestRejectNoteOrConfirmation(
      refreshedProvider,
      refreshedProvider.verification.reviewerWorkflow.reasonLabel,
      note,
      phone
    );
    return;
  }

  if (!reviewAction || !providerPhone) {
    await sendText(phone, 'Review command not recognized. Use the Approve/Reject button or send APPROVE <provider-phone>.');
    return;
  }

  const provider = await getProvider(providerPhone);
  if (!provider) {
    await sendText(phone, `Provider not found for ${providerPhone}.`);
    return;
  }

  if (reviewAction.action === 'cancel') {
    await clearReviewerWorkflow(providerPhone);
    await sendText(phone, `Cancelled review action for ${providerPhone}.`);
    return;
  }

  if (reviewAction.action === 'approve') {
    await requestReviewConfirmation(provider, reviewAction.action, phone);
    return;
  }

  if (reviewAction.action === 'request_additional_document') {
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: 'awaiting_additional_document_note',
        note: ''
      })
    );
    const refreshedProvider = await getProvider(providerPhone);
    await promptAdditionalDocumentNoteEntry(refreshedProvider, phone);
    return;
  }

  if (reviewAction.action === 'reject') {
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: 'choose_reject_reason',
        reason: null,
        reasonLabel: null,
        note: ''
      })
    );
    const refreshedProvider = await getProvider(providerPhone);
    await requestRejectReason(refreshedProvider, phone);
    return;
  }

  if (reviewAction.action === 'confirm_approve') {
    if (provider.verification && provider.verification.status === 'verified') {
      await sendText(phone, `Certificate is already approved for ${providerPhone}.`);
      return;
    }

    await clearReviewerWorkflow(providerPhone);
    await approveCertificate(providerPhone, phone, 'Approved from reviewer WhatsApp');
    await sendText(phone, `Approved certificate for ${providerPhone}.`);
    return;
  }

  if (provider.verification && provider.verification.status === 'rejected' && reviewAction.action === 'confirm_reject') {
    await sendText(phone, `Certificate is already rejected for ${providerPhone}.`);
    return;
  }

  const rejectReason = getRejectReasonDetails(reviewAction.action);
  if (rejectReason) {
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: 'awaiting_note_or_reject',
        reason: rejectReason.code,
        reasonLabel: rejectReason.label,
        rejectMessageKey: rejectReason.rejectMessageKey || null,
        note: ''
      })
    );
    const refreshedProvider = await getProvider(providerPhone);
    await requestRejectNoteOrConfirmation(refreshedProvider, rejectReason.label, '', phone);
    return;
  }

  if (reviewAction.action === 'add_note') {
    const workflow = provider.verification && provider.verification.reviewerWorkflow;
    if (!workflow || !workflow.reason) {
      await sendText(phone, 'Choose a reject reason first.');
      return;
    }

    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(workflow, {
        stage: 'awaiting_note'
      })
    );
    await promptRejectNoteEntry(provider, workflow.reasonLabel, phone);
    return;
  }

  if (reviewAction.action === 'confirm_reject') {
    const workflow = provider.verification && provider.verification.reviewerWorkflow;
    const customProviderMessage = workflow && workflow.note ? workflow.note.trim() : '';
    const noteParts = [];
    if (workflow && workflow.reasonLabel) {
      noteParts.push(`Reason: ${workflow.reasonLabel}`);
    }
    if (workflow && workflow.note) {
      noteParts.push(workflow.note);
    }
    const finalNote = noteParts.join(' | ') || 'Rejected from reviewer WhatsApp';
    const requestReupload =
      workflow &&
      ['request_reupload', 'cv_instead_of_certificate', 'wrong_image_instead_of_certificate'].includes(workflow.reason);
    const rejectMessageKey = workflow && workflow.rejectMessageKey ? workflow.rejectMessageKey : null;
    const isAgeLimitRejected = workflow && workflow.reason === 'age_limit_exceeded';
    const isPermanentRejected = workflow && workflow.reason === 'permanent_reject';

    await clearReviewerWorkflow(providerPhone);
    await rejectCertificate(providerPhone, phone, finalNote, {
      providerMessage: customProviderMessage || null,
      requestReupload,
      rejectMessageKey,
      nextStatus:
        isAgeLimitRejected
          ? STATUS.AGE_REJECTED
          : isPermanentRejected
            ? STATUS.CERTIFICATE_REJECTED_PERMANENT
            : undefined,
      nextStep: isAgeLimitRejected ? 10 : isPermanentRejected ? 13 : undefined,
      resetCertificate: !isAgeLimitRejected && !isPermanentRejected
    });
    if (isAgeLimitRejected) {
      await sendAgeFinalRejectionButtons(providerPhone);
    }
    await sendText(phone, `Rejected certificate for ${providerPhone}.`);
    return;
  }

  if (reviewAction.action === 'confirm_request_additional_document') {
    const workflow = provider.verification && provider.verification.reviewerWorkflow;
    const customNote = workflow && workflow.note ? workflow.note.trim() : '';
    if (!customNote) {
      await sendText(phone, 'Add a note before sending the additional document request.');
      return;
    }

    await clearReviewerWorkflow(providerPhone);
    await requestAdditionalDocument(providerPhone, phone, customNote);
    await sendText(phone, `Requested an additional document for ${providerPhone}.`);
    return;
  }

  await sendText(phone, 'Review command not recognized. Use the Approve/Reject button or send APPROVE <provider-phone>.');
}

async function processIncomingMessage(phone, message) {
  if (isReviewerPhone(phone)) {
    await handleReviewerMessage(phone, message);
    return;
  }

  if (isPreOnboardedPhone(phone)) {
    return;
  }

  const provider = await getOrCreateProvider(phone);

  if (hasProcessedMessage(provider, message.id)) {
    return;
  }

  await recordInbound(phone, message);

  if (provider.status === STATUS.AWAITING_REGION_SELECTION) {
    await handleRegionSelection(phone, message);
    return;
  }

  if (provider.status === STATUS.NEW) {
    await startFlow(phone);
    return;
  }

  await runWithProviderFlow(provider, async () => {
  if (provider.status === STATUS.NOT_INTERESTED_RESTARTABLE) {
    await startFlow(phone);
    return;
  }

  if (provider.status === STATUS.AWAITING_PULSO_AGENT) {
    if (canRequestAgentHelp(provider)) {
      await handleAgentHelpRequest(phone);
      return;
    }

    await sendAndLog(phone, 'text', MESSAGES.agentHelpAlreadyRequested);
    return;
  }

  switch (provider.status) {
    case STATUS.AWAITING_QUALIFICATION:
      await handleQualification(phone, message);
      return;
    case STATUS.AWAITING_INTEREST:
      await handleInterest(phone, message);
      return;
    case STATUS.AWAITING_DUTY_HOUR_PREFERENCE:
      await handleDutyHourPreference(phone, message);
      return;
    case STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE:
      await handleSampleDutyOfferPreference(phone, message);
      return;
    case STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION:
      await handleExpectedDutiesConfirmation(phone, message);
      return;
    case STATUS.AWAITING_CERTIFICATE:
      await handleCertificate(phone, message);
      return;
    case STATUS.AWAITING_NAME:
      await handleName(phone, message);
      return;
    case STATUS.AWAITING_AGE:
      await handleAge(phone, message);
      return;
    case STATUS.AGE_REJECTED:
      await handleAgeRejected(phone, message);
      return;
    case STATUS.CERTIFICATE_REJECTED_PERMANENT:
      await sendAndLog(phone, 'text', MESSAGES.certificateRejectedPermanent);
      return;
    case STATUS.AWAITING_SEX:
      await handleSex(phone, message);
      return;
    case STATUS.AWAITING_DISTRICT:
      await handleDistrict(phone, message);
      return;
    case STATUS.VERIFICATION_PENDING:
      await sendAndLog(phone, 'text', MESSAGES.verificationStillPending);
      return;
    case STATUS.ADDITIONAL_DOCUMENT_REQUESTED:
      await handleAdditionalDocument(phone, message);
      return;
    case STATUS.AWAITING_TERMS_ACCEPTANCE:
      await handleTerms(phone, message);
      return;
    case STATUS.COMPLETED:
      await handleCompleted(phone, message);
      return;
    default:
      await sendAndLog(phone, 'text', MESSAGES.notInterested);
  }
  });
}

async function approveCertificate(phone, reviewedBy, notes) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  return runWithProviderFlow(provider, async () => {
  await updateProvider(phone, {
    status: STATUS.AWAITING_TERMS_ACCEPTANCE,
    currentStep: 14,
    termsSentAt: new Date().toISOString(),
    termsReminderSentAt: null,
    termsReminderCount: 0,
    termsReminderKind: null,
    termsReminderReplyReceivedAt: null,
    termsDeclinedAt: null,
    verification: {
      status: 'verified',
      notes: notes || '',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy || config.adminDefaultReviewer
    }
  });
  await appendHistory(phone, { type: 'system', event: 'certificate_verified' });
  await sendAndLog(phone, 'text', MESSAGES.certificateApproved, reviewedBy || config.adminDefaultReviewer);
  await sendAndLog(phone, 'text', MESSAGES.termsIntro, reviewedBy || config.adminDefaultReviewer);
  await sendTermsButtons(phone);
  const updatedProvider = await getProvider(phone);
  await notifyCertificateReviewed(
    updatedProvider,
    'approved',
    reviewedBy || config.adminDefaultReviewer,
    notes || ''
  );
  return updatedProvider;
  });
}

async function rejectCertificate(phone, reviewedBy, notes, options = {}) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  return runWithProviderFlow(provider, async () => {
  const nextStatus = options.nextStatus || STATUS.AWAITING_CERTIFICATE;
  const nextStep = options.nextStep || 5;
  const resetCertificate = options.resetCertificate !== false;

  await updateProvider(phone, {
    status: nextStatus,
    currentStep: nextStep,
    verification: {
      status: 'rejected',
      notes: notes || '',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy || config.adminDefaultReviewer
    },
    documents: {
      ...provider.documents,
      certificateReceived: resetCertificate ? false : provider.documents && provider.documents.certificateReceived,
      certificateAttachments: resetCertificate ? [] : provider.documents && provider.documents.certificateAttachments
    }
  });
  await appendHistory(phone, { type: 'system', event: 'certificate_rejected' });
  const rejectMessage =
    options.providerMessage
      ? options.providerMessage
      : options.rejectMessageKey && MESSAGES[options.rejectMessageKey]
      ? MESSAGES[options.rejectMessageKey]
      : options.requestReupload
        ? MESSAGES.certificateReuploadRequested
        : MESSAGES.certificateRejected;
  await sendAndLog(phone, 'text', rejectMessage, reviewedBy || config.adminDefaultReviewer);
  const updatedProvider = await getProvider(phone);
  await notifyCertificateReviewed(
    updatedProvider,
    'rejected',
    reviewedBy || config.adminDefaultReviewer,
    notes || ''
  );
  return updatedProvider;
  });
}

module.exports = {
  processIncomingMessage,
  approveCertificate,
  rejectCertificate,
  requestAdditionalDocument,
  markPulsoAppActivationVerified,
  runMobileAppCampaignForCompletedProviders,
  reconcileAcceptedTermsProviders,
  runCurrentWaitingTermsReminderBackfill,
  runLegacyTermsReminderBackfill,
  runTermsReminderSweep,
  startTermsReminderScheduler,
  startFlow,
  adminUploadCertificateFiles
};
