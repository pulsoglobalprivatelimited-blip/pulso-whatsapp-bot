const config = require('../config');
const { getProviderTiers } = require('./providerTiersConfig');
const { getDutyDaysProgress, dutyDaysMessage, isDutyDaysQuestion, milestoneDue, milestonesCoveredBy, milestoneMessage } = require('./dutyDaysService');
const fs = require('fs');
const path = require('path');
const {
  MESSAGES,
  STATUS,
  BUTTON_IDS,
  QUALIFICATIONS,
  DISTRICTS,
  REGION_OPTIONS,
  LANGUAGE_OPTIONS,
  DEFAULT_FLOW_ID_BY_REGION,
  getFlowIdFor,
  getWorkingModelFor,
  getBasicTierAgeNoticeFor,
  getDutyHourPaymentSummaryFor,
  getSampleDutyOfferFor,
  getCertificateApprovedFor,
  getTermsRateFor,
  UI_TEXT,
  getFlowConfig,
  runWithProviderFlow
} = require('../flow');
const { sendText, sendButtons, sendList, sendTemplate, sendVideoById } = require('./metaClient');
const { getHubAppActivation } = require('./hubAppActivationService');
const {
  getOrCreateProvider,
  updateProvider,
  appendHistory,
  getProvider,
  listProviders,
  listProviderTermsReminderCandidates,
  listPendingVerificationNotificationProviders,
  listReviewerWorkflowProviders
} = require('./providerService');
const {
  getRejectReasonDetails,
  isReviewerPhone,
  isNoCertificateReviewerPhone,
  isNoCertificateProvider,
  isAboveCallReviewAge,
  reviewerDisplayName,
  notifyNoCertificateApplication,
  requestCallBasicDecision,
  requestCallRejectReason,
  requestCallRejectConfirmation,
  CALL_REJECT_REASONS,
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
  requestReviewQualificationSelection,
  requestBasicTierReasonSelection,
  requestReviewConfirmation
} = require('./opsNotifications');
const { isPreOnboardedPhone } = require('./preOnboardedService');
const {
  getMessageText,
  parseRegion,
  parseLanguage,
  parseQualification,
  isQualificationDeclined,
  isInterested,
  isNotInterested,
  parseSampleDutyOfferPreference,
  parseExpectedDutiesResponse,
  parseAge,
  parseAgeCorrectionAction,
  parseSex,
  parseDistrict,
  parseDistrictListAction,
  parseTermsAcceptance,
  parsePulsoAppInstallInterest,
  parseAgencyAnswer,
  parseAddDutyInterest,
  isAddDutyKeyword,
  isAgencyKeyword,
  parsePulsoAppDevice,
  parsePulsoAppActivationAction,
  parsePulsoAppHelpReason,
  parseTermsReminderResume,
  parseCertificateCollectionAction,
  classifyDocument
} = require('./messageParser');
const { archiveIncomingMedia, uploadBufferToFirebaseStorage } = require('./mediaStorage');
const { syncProviderToPulsoHub } = require('./pulsoHubSyncService');
const { saveProviderContact } = require('./googleContactsService');
const {
  buildVerificationNotificationPatch,
  recordReviewAlertSend
} = require('./reviewAlertEscalation');
const { inferProviderRegion, statusRequiresRegion } = require('./regionService');

const pendingCertificatePromptTimers = new Map();
const pendingCertificateRetryTimers = new Map();
const CERTIFICATE_PROMPT_DEBOUNCE_MS = 5000;
const AGENT_HELP_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const TERMS_REMINDER_HISTORY_EVENT = 'terms_acceptance_reminder_sent';
const DUTY_ACCEPT_VIDEO_HISTORY_EVENT = 'pulso_duty_accept_video_sent';
const APP_ACTIVATION_VIDEO_HISTORY_EVENT = 'pulso_app_activation_video_sent';
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
// The Duty Card question, asked once after the app step, and its follow-up.
const MOBILE_APP_STAGE_AGENCY_QUESTION = 'awaiting_agency_question';
const MOBILE_APP_STAGE_ADD_DUTY_INTEREST = 'awaiting_add_duty_interest';

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

// The paper to ask for, named after the qualification she chose: "certificate"
// alone made people send a CV (founder, 1 Oct 2026: no CV is needed).
function certificatePaperFor(provider) {
  const qualification = String((provider && provider.qualification) || '').toLowerCase();
  const papers = MESSAGES.certificatePapers || {};
  return papers[qualification] || '';
}

function buildCertificateRequestMessage(provider) {
  const paper = certificatePaperFor(provider);
  return paper ? MESSAGES.certificateRequestNamed.replace('{{paper}}', paper) : MESSAGES.certificateRequest;
}

function buildCertificateRetryMessage(provider) {
  const paper = certificatePaperFor(provider);
  return paper ? MESSAGES.certificateRetryNamed.replace('{{paper}}', paper) : MESSAGES.certificateRetry;
}

// A reviewer who got a CV types CERT as the Request doc note; she is then
// asked for her own paper, in her own language.
const CERTIFICATE_ONLY_NOTE_KEYWORDS = new Set(['cert', 'certificate', 'cv']);

function expandCertificateOnlyNote(provider, note) {
  if (!CERTIFICATE_ONLY_NOTE_KEYWORDS.has(String(note || '').trim().toLowerCase())) return note;
  const paper = certificatePaperFor(provider) || 'certificate';
  return MESSAGES.certificateOnlyNote.replace('{{paper}}', paper);
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
    } else if (kind === 'video') {
      await sendVideoById(phone, body.mediaId, body.caption);
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

function buildSendFailureDetails(error) {
  return {
    message: error && error.message ? error.message : 'send_failed',
    response: error && error.response ? error.response.data : null
  };
}

function updateStatus(phone, status, currentStep, extra = {}) {
  return updateProvider(phone, { status, currentStep, ...extra });
}

function getStepForStatus(status) {
  const statusSteps = {
    [STATUS.AWAITING_QUALIFICATION]: 2,
    [STATUS.AWAITING_INTEREST]: 4,
    [STATUS.AWAITING_DUTY_HOUR_PREFERENCE]: 5,
    [STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE]: 6,
    [STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION]: 7,
    [STATUS.AWAITING_CERTIFICATE]: 8,
    [STATUS.AWAITING_NAME]: 9,
    [STATUS.AWAITING_AGE]: 10,
    [STATUS.AWAITING_SEX]: 11,
    [STATUS.AWAITING_DISTRICT]: 12,
    [STATUS.VERIFICATION_PENDING]: 13,
    [STATUS.ADDITIONAL_DOCUMENT_REQUESTED]: 13,
    [STATUS.AWAITING_TERMS_ACCEPTANCE]: 14,
    [STATUS.COMPLETED]: 15
  };

  return statusSteps[status] || 2;
}

function normalizeApprovedQualification(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const validQualifications = ['gda', 'gnm', 'anm', 'hca', 'bsc_nursing', 'other_caregiving', 'basic_caregiver', 'nursing_student'];
  return validQualifications.includes(normalized) ? normalized : null;
}

/* Why someone is on the Basic rate. Two reasons, and both can be true at once:
   she may be over the age and have no course certificate. Recorded because the
   rate follows from it and because, if the age on file is a typo, this is the
   only record of what the decision was actually made on. */
const BASIC_TIER_REASONS = ['age_over_threshold', 'no_course_certificate'];

function normalizeBasicTierReasons(value) {
  const list = Array.isArray(value) ? value : [value];
  const clean = list
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => BASIC_TIER_REASONS.includes(item));
  return Array.from(new Set(clean));
}

/* Basic is a pay decision, so it is stored as one. Empty means "derive it from
   the qualification", which is every ordinary approval. */
function tierDecisionFor(reasons) {
  return reasons && reasons.length ? 'basic' : null;
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

async function sendCertificateRetry(phone, provider, options = {}) {
  if (options.force) {
    await sendAndLog(phone, 'text', buildCertificateRetryMessage(provider));
    return;
  }

  await sendIfChanged(phone, provider, 'text', buildCertificateRetryMessage(provider));
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

      await finalizeCertificateCollection(phone);
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

      await sendCertificateRetry(phone, provider, { force: true });
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

  const inboundEntry = provider.history.find(
    (event) => event.type === 'inbound_message' && event.payload && event.payload.id === messageId
  );
  if (!inboundEntry) {
    return false;
  }

  const payload = inboundEntry.payload || {};
  const mediaId = payload.document ? payload.document.id : payload.image ? payload.image.id : null;
  if (mediaId && payload.type && ['document', 'image'].includes(payload.type)) {
    const documents = provider.documents || {};
    if (provider.status === STATUS.AWAITING_CERTIFICATE) {
      const attachments = documents.certificateAttachments || [];
      return attachments.some((attachment) => attachment && attachment.id === mediaId);
    }

    if (provider.status === STATUS.ADDITIONAL_DOCUMENT_REQUESTED) {
      const attachments = documents.additionalDocumentAttachments || [];
      return attachments.some((attachment) => attachment && attachment.id === mediaId);
    }
  }

  return true;
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

// Pulso duties are 24-hour live-in (founder, 5 Oct 2026). There is nothing to
// choose, so this is a statement with one button that means "understood, go
// on". The pay line under it is the 24-hour figure for her band.
const DUTY_HOUR_ONLY = '24_hour';

async function sendDutyHourPreferenceButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.dutyHourPreferenceQuestion,
    buttons: [{ id: BUTTON_IDS.DUTY_HOUR_24, title: '24 hour' }]
  });
  const provider = await getProvider(phone);
  await sendAndLog(phone, 'text', getDutyHourPaymentSummaryFor(provider, await getProviderTiers()));
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

async function moveToExpectedDuties(phone) {
  await updateStatus(phone, STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION, 7, {
    dutyHourPreference: DUTY_HOUR_ONLY,
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

function hasSentTermsIntro(provider) {
  return hasHistoryEvent(
    provider,
    (entry) =>
      entry &&
      entry.type === 'outbound_message' &&
      entry.payload &&
      entry.payload.kind === 'text' &&
      entry.payload.body === MESSAGES.termsIntro
  );
}

async function sendTermsIntroIfMissing(phone, provider, sender = 'bot') {
  if (hasSentTermsIntro(provider)) {
    return false;
  }

  await sendAndLog(phone, 'text', MESSAGES.termsIntro, sender);
  return true;
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

// ---- The Duty Card ---------------------------------------------------------
// After onboarding is complete — the app step included — she is asked once
// whether she works with an agency. A yes gets the founder's benefits message
// and "add it now?"; a yes to that gets the steps. Nothing here blocks the app
// install or any other reply: an unexpected message gets one retry with the
// buttons, then the question is dropped and the chat behaves as before.

async function sendAgencyQuestionButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.agencyQuestion,
    buttons: [
      { id: BUTTON_IDS.AGENCY_YES, title: UI_TEXT.agencyYesTitle },
      { id: BUTTON_IDS.AGENCY_NO, title: UI_TEXT.agencyNoTitle }
    ]
  });
}

async function sendAddDutyInterestButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.addDutyInterestQuestion,
    buttons: [
      { id: BUTTON_IDS.ADD_DUTY_NOW, title: UI_TEXT.addDutyNowTitle },
      { id: BUTTON_IDS.ADD_DUTY_LATER, title: UI_TEXT.addDutyLaterTitle }
    ]
  });
}

// The steps, with the install line first for someone who has not got the app.
async function sendAddDutyProcedure(phone, provider) {
  const hasApp = provider && (provider.pulsoAppActivationStatus === 'verified' || provider.pulsoAppActivationStatus === 'activation_pending');
  if (!hasApp) {
    await sendAndLog(phone, 'text', MESSAGES.addDutyInstallFirst);
  }
  await sendAndLog(phone, 'text', MESSAGES.addDutyProcedure);
}

// Called at the end of both wrap-ups. Asks once per person, ever.
async function askAgencyQuestionAfterOnboarding(phone, sender = 'bot') {
  const provider = await getProvider(phone);
  if (!provider) return;
  if (hasHistoryEvent(provider, (entry) => entry && entry.type === 'system' && entry.event === 'agency_question_sent')) {
    return;
  }
  await updateProvider(phone, {
    pulsoAppPromptStage: MOBILE_APP_STAGE_AGENCY_QUESTION,
    mobileAppCampaignStage: MOBILE_APP_STAGE_AGENCY_QUESTION,
    agencyQuestionAskedAt: new Date().toISOString()
  });
  await appendHistory(phone, { type: 'system', event: 'agency_question_sent' });
  await sendAgencyQuestionButtons(phone);
}

async function clearAgencyStage(phone) {
  await updateProvider(phone, { pulsoAppPromptStage: null, mobileAppCampaignStage: null });
}

async function handleAgencyQuestion(phone, message) {
  const provider = await getProvider(phone);
  const answer = parseAgencyAnswer(message);
  if (!answer) {
    if (provider && provider.agencyQuestionRetried) {
      // Second stray message: drop the question, let the chat carry on as before.
      await clearAgencyStage(phone);
      await handleCompleted(phone, message);
      return;
    }
    await updateProvider(phone, { agencyQuestionRetried: true });
    await sendAndLog(phone, 'text', MESSAGES.agencyQuestionRetry);
    await sendAgencyQuestionButtons(phone);
    return;
  }
  await updateProvider(phone, {
    worksWithAgency: answer === 'yes',
    worksWithAgencyAnsweredAt: new Date().toISOString(),
    agencyQuestionRetried: false
  });
  await appendHistory(phone, { type: 'system', event: 'agency_question_answered', answer });
  if (answer === 'no') {
    await clearAgencyStage(phone);
    await syncAfterAgencyAnswer(phone);
    return;
  }
  await sendAndLog(phone, 'text', MESSAGES.agencyYes);
  await updateProvider(phone, {
    pulsoAppPromptStage: MOBILE_APP_STAGE_ADD_DUTY_INTEREST,
    mobileAppCampaignStage: MOBILE_APP_STAGE_ADD_DUTY_INTEREST
  });
  await sendAddDutyInterestButtons(phone);
  await syncAfterAgencyAnswer(phone);
}

async function handleAddDutyInterest(phone, message) {
  const provider = await getProvider(phone);
  const interest = parseAddDutyInterest(message);
  if (!interest) {
    if (provider && provider.addDutyInterestRetried) {
      await clearAgencyStage(phone);
      await handleCompleted(phone, message);
      return;
    }
    await updateProvider(phone, { addDutyInterestRetried: true });
    await sendAndLog(phone, 'text', MESSAGES.agencyQuestionRetry);
    await sendAddDutyInterestButtons(phone);
    return;
  }
  await updateProvider(phone, {
    addDutyInterest: interest,
    addDutyInterestAnsweredAt: new Date().toISOString(),
    addDutyInterestRetried: false,
    pulsoAppPromptStage: null,
    mobileAppCampaignStage: null
  });
  await appendHistory(phone, { type: 'system', event: 'add_duty_interest_answered', interest });
  if (interest === 'later') {
    await sendAndLog(phone, 'text', MESSAGES.addDutyLater);
    return;
  }
  await sendAddDutyProcedure(phone, provider);
}

// The hub keeps worksWithAgency on the user, so the app can lead with
// "Add my duty" for her. Best effort: a failed sync is logged, never shown.
async function syncAfterAgencyAnswer(phone) {
  try {
    const provider = await getProvider(phone);
    if (provider) await syncProviderToPulsoHub(provider);
  } catch (error) {
    console.error('[AGENCY_ANSWER_SYNC_FAILED]', phone, error && error.message);
  }
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
  await askAgencyQuestionAfterOnboarding(phone, sender);
}

async function sendMobileAppCampaignClosing(phone, sender = 'bot') {
  await updateProvider(phone, {
    pulsoAppPromptStage: null,
    mobileAppCampaignStage: null,
    mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.COMPLETED,
    mobileAppCampaignCompletedAt: new Date().toISOString()
  });
  await sendAndLog(phone, 'text', MESSAGES.mobileAppCampaignThanks, sender);
  await askAgencyQuestionAfterOnboarding(phone, sender);
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

function hasVideoSendHistory(provider, event, mediaId) {
  return hasHistoryEvent(
    provider,
    (entry) => {
      if (entry && entry.type === 'system' && entry.event === event) {
        return !entry.mediaId || entry.mediaId === mediaId;
      }

      return (
        entry &&
        entry.type === 'outbound_message' &&
        entry.payload &&
        entry.payload.kind === 'video' &&
        entry.payload.body &&
        entry.payload.body.mediaId === mediaId
      );
    }
  );
}

async function sendVideoOnce(phone, provider, mediaId, caption, event, sender = 'bot') {
  if (!mediaId) {
    console.warn(`[VIDEO_SEND_SKIPPED] ${event} media id is not configured`);
    return false;
  }

  const currentProvider = provider || (await getProvider(phone));
  if (hasVideoSendHistory(currentProvider, event, mediaId)) {
    return false;
  }

  await sendAndLog(phone, 'video', { mediaId, caption }, sender);
  await appendHistory(phone, {
    type: 'system',
    event,
    mediaId,
    sentAt: new Date().toISOString()
  });
  return true;
}

async function sendDutyAcceptVideo(phone, provider, sender = 'bot') {
  return sendVideoOnce(
    phone,
    provider,
    config.pulsoDutyAcceptVideoMediaId,
    MESSAGES.pulsoDutyAcceptVideoCaption,
    DUTY_ACCEPT_VIDEO_HISTORY_EVENT,
    sender
  );
}

async function sendPulsoAppActivationVideo(phone, provider, sender = 'bot') {
  return sendVideoOnce(
    phone,
    provider,
    config.pulsoAppActivationVideoMediaId,
    MESSAGES.pulsoAppActivationVideoCaption,
    APP_ACTIVATION_VIDEO_HISTORY_EVENT,
    sender
  );
}

async function sendOptionalVideo(sendVideo, phone, label) {
  try {
    return await sendVideo();
  } catch (error) {
    console.error(
      `[${label}]`,
      JSON.stringify(
        {
          phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return false;
  }
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
    await sendOptionalVideo(
      () => sendDutyAcceptVideo(phone, refreshedProvider, sender),
      phone,
      'DUTY_ACCEPT_VIDEO_SEND_ERROR'
    );
    await sendAndLog(phone, 'text', MESSAGES.pulsoAppActivationInstruction, sender);
    await sendOptionalVideo(
      () => sendPulsoAppActivationVideo(phone, refreshedProvider, sender),
      phone,
      'PULSO_APP_ACTIVATION_VIDEO_SEND_ERROR'
    );
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

  // Put the caregiver in the ops phone book. Kept apart from the hub sync above
  // so neither failure takes the other down, and wrapped because a contact that
  // did not save is a nuisance for ops - never a reason to fail an onboarding
  // the caregiver has already completed.
  try {
    const contactProvider = await getProvider(phone);
    const contactResult = await saveProviderContact(contactProvider);
    await updateProvider(phone, {
      contactSync: {
        status: contactResult.ok ? 'saved' : contactResult.skipped ? 'skipped' : 'failed',
        skipped: contactResult.skipped === true,
        reason: contactResult.reason || '',
        savedAt: new Date().toISOString(),
        // The handle Google gave this contact. Its presence is what stops a
        // second copy being created on any later retry or backfill run.
        resourceName: contactResult.resourceName || '',
        name: contactResult.name || '',
      },
    });
    await appendHistory(phone, {
      type: 'system',
      event: contactResult.ok ? 'google_contact_saved' : 'google_contact_skipped',
      details: {
        reason: contactResult.reason || '',
        name: contactResult.name || '',
      },
    });
  } catch (error) {
    console.error('[GOOGLE_CONTACT_SYNC_ERROR]', phone, error.message);
    await updateProvider(phone, {
      contactSync: {
        status: 'failed',
        skipped: false,
        reason: error.message || 'contact_save_failed',
        savedAt: new Date().toISOString(),
        resourceName: '',
      },
    });
    await appendHistory(phone, {
      type: 'system',
      event: 'google_contact_failed',
      details: { message: error.message || 'contact_save_failed' },
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
  await sendOptionalVideo(
    () => sendDutyAcceptVideo(provider.phone, provider, sender),
    provider.phone,
    'DUTY_ACCEPT_VIDEO_SEND_ERROR'
  );
  await sendAndLog(provider.phone, 'text', MESSAGES.pulsoAppActivationInstruction, sender);
  await sendOptionalVideo(
    () => sendPulsoAppActivationVideo(provider.phone, provider, sender),
    provider.phone,
    'PULSO_APP_ACTIVATION_VIDEO_SEND_ERROR'
  );
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

// ---- The agency question for caregivers who finished before it existed -------
// They are outside the 24-hour window, so it goes as the approved template
// `duty_card_agency_question` (English; a Malayalam body was refused by Meta
// before). The reply buttons carry "Yes" / "No", which parseAgencyAnswer reads,
// and the person is put on the same stage as a fresh caregiver, so the rest of
// the conversation is identical.
const AGENCY_QUESTION_TEMPLATE = process.env.DUTY_CARD_AGENCY_QUESTION_TEMPLATE || 'duty_card_agency_question';

function isCompletedProviderEligibleForAgencyQuestion(provider) {
  return Boolean(
    provider &&
      provider.phone &&
      provider.status === STATUS.COMPLETED &&
      provider.termsAccepted === true &&
      provider.worksWithAgency === undefined &&
      !hasHistoryEvent(provider, (entry) => entry && entry.type === 'system' && entry.event === 'agency_question_sent')
  );
}

async function runAgencyQuestionForCompletedProviders(targetPhones = null, { dryRun = false, limit = 0 } = {}) {
  const providers = await listProviders();
  const targetSet = Array.isArray(targetPhones) && targetPhones.length ? new Set(targetPhones) : null;
  let candidates = providers.filter((provider) => {
    if (targetSet && (!provider || !targetSet.has(provider.phone))) return false;
    return isCompletedProviderEligibleForAgencyQuestion(provider);
  });
  if (limit > 0) candidates = candidates.slice(0, limit);
  if (dryRun) {
    return { scanned: providers.length, eligible: candidates.length, dryRun: true, phones: candidates.map((p) => p.phone) };
  }
  const results = [];
  for (const provider of candidates) {
    const phone = provider.phone;
    try {
      await runWithProviderFlow(provider, async () => {
        // The body has one variable: her first name ("Dear caregiver" when we
        // have none), so the question reads as addressed to her.
        const firstName = String(provider.fullName || '').trim().split(/\s+/)[0] || 'Dear caregiver';
        await sendAndLog(phone, 'template', {
          name: AGENCY_QUESTION_TEMPLATE,
          languageCode: 'en',
          components: [{ type: 'body', parameters: [{ type: 'text', text: firstName.slice(0, 60) }] }]
        }, 'bot');
        await updateProvider(phone, {
          pulsoAppPromptStage: MOBILE_APP_STAGE_AGENCY_QUESTION,
          mobileAppCampaignStage: MOBILE_APP_STAGE_AGENCY_QUESTION,
          agencyQuestionAskedAt: new Date().toISOString(),
          agencyQuestionSource: 'backfill_template'
        });
        await appendHistory(phone, { type: 'system', event: 'agency_question_sent', source: 'backfill_template' });
      });
      results.push({ phone, sent: true });
    } catch (error) {
      results.push({ phone, sent: false, error: error.message || 'send_failed' });
      console.error('[AGENCY_QUESTION_BACKFILL_ERROR]', phone, error.message, error.response ? JSON.stringify(error.response.data) : '');
    }
  }
  return {
    scanned: providers.length,
    eligible: candidates.length,
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
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

// ---------------------------------------------------------------------------
// Experience certificate milestones: 90, 150 and 180 duty days.
//
// The count lives in the hub and is read, never recomputed here. Once a day is
// enough — a caregiver gains at most one day per day, and a chattier sweep only
// risks the number's quality rating for no new information.
//
// A caregiver who has not written to us in 24 hours is outside WhatsApp's free
// window, so an ordinary text will not reach her. That is exactly how the terms
// reminder has been failing silently, so this logs the skip by name instead of
// pretending it sent. A template can be set later and the sweep will use it.
// ---------------------------------------------------------------------------
const DUTY_MILESTONE_HISTORY_EVENT = 'duty_days_milestone_sent';
const WHATSAPP_FREE_WINDOW_MS = 24 * 60 * 60 * 1000;
let dutyMilestoneInterval = null;

function isInsideFreeWindow(provider, now = Date.now()) {
  const at = provider && (provider.lastInboundAt || provider.lastMessageAt);
  if (!at) return false;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return false;
  return now - ms < WHATSAPP_FREE_WINDOW_MS;
}

function milestonesAlreadySent(provider) {
  const list = provider && provider.dutyDaysMilestonesSent;
  return Array.isArray(list) ? list.map((v) => String(v)) : [];
}

async function runDutyDaysMilestoneSweep() {
  const providers = await listProviders();
  const candidates = providers.filter(
    (p) => p && p.status === STATUS.COMPLETED && (p.appProviderUid || (p.sync && p.sync.matchedUserId))
  );
  let sent = 0;
  let skippedOutsideWindow = 0;
  for (const provider of candidates) {
    try {
      const progress = await getDutyDaysProgress(provider);
      const milestone = milestoneDue(progress, milestonesAlreadySent(provider));
      if (!milestone) continue;
      if (!isInsideFreeWindow(provider)) {
        skippedOutsideWindow += 1;
        console.log('[DUTY_MILESTONE_SKIPPED_WINDOW]', provider.phone, milestone.days,
          'needs an approved template to reach her');
        continue;
      }
      await sendAndLog(provider.phone, 'text',
        milestoneMessage(milestone, progress, provider.language || 'ml'), 'duty-milestone');
      await updateProvider(provider.phone, {
        dutyDaysMilestonesSent: [...new Set([...milestonesAlreadySent(provider), ...milestonesCoveredBy(milestone)])],
        dutyDaysMilestoneLastSentAt: new Date().toISOString()
      });
      await appendHistory(provider.phone, {
        type: 'system',
        event: DUTY_MILESTONE_HISTORY_EVENT,
        milestone: milestone.days,
        completed: progress.completed
      });
      sent += 1;
      console.log('[DUTY_MILESTONE_SENT]', provider.phone, milestone.days);
    } catch (error) {
      console.error('[DUTY_MILESTONE_ERROR]', provider.phone, error && error.message);
    }
  }
  console.log(`[DUTY_MILESTONE] scanned ${candidates.length}, sent ${sent}, outside window ${skippedOutsideWindow}`);
  return { scanned: candidates.length, sent, skippedOutsideWindow };
}

function startDutyDaysMilestoneScheduler() {
  if (dutyMilestoneInterval) return dutyMilestoneInterval;
  const everyMs = 24 * 60 * 60 * 1000;
  dutyMilestoneInterval = setInterval(() => {
    runDutyDaysMilestoneSweep().catch((error) => {
      console.error('[DUTY_MILESTONE_SWEEP_ERROR]', error && error.message);
    });
  }, everyMs);
  if (typeof dutyMilestoneInterval.unref === 'function') dutyMilestoneInterval.unref();
  return dutyMilestoneInterval;
}

async function runTermsReminderSweep() {
  const providers = await listProviderTermsReminderCandidates();
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
    body: 'Please select your region.\n\nതാങ്കളുടെ region തിരഞ്ഞെടുക്കുക.',
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

// Asked before the language is known, so it carries both languages.
async function sendLanguageSelectionList(phone) {
  await sendAndLog(phone, 'buttons', {
    body: 'Please select your language.\n\nതാങ്കളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക.',
    buttons: LANGUAGE_OPTIONS
  });
}

async function handleRegionSelection(phone, message) {
  const region = parseRegion(message);
  if (!region) {
    await sendAndLog(phone, 'text', 'Please select Kerala or Karnataka to continue.');
    await sendRegionSelectionList(phone);
    return;
  }

  // The region's own default flow until the language question is answered, so
  // the record is never left without one.
  await assignProviderFlow(phone, DEFAULT_FLOW_ID_BY_REGION[region], 'region_selection');
  await updateStatus(phone, STATUS.AWAITING_LANGUAGE_SELECTION, 1.6);
  await sendLanguageSelectionList(phone);
}

async function handleLanguageSelection(phone, message) {
  const provider = await getProvider(phone);
  const region = inferProviderRegion(provider);
  if (!region) {
    await requestRegionBeforeContinuing(phone, provider || { status: STATUS.NEW });
    return;
  }

  const language = parseLanguage(message);
  if (!language) {
    await sendLanguageSelectionList(phone);
    return;
  }

  await assignProviderFlow(phone, getFlowIdFor(region, language), 'language_selection');
  const updated = await getProvider(phone);
  if (updated && updated.regionResumeStatus) {
    await resumeProviderAfterRegionSelection(phone, updated);
    return;
  }

  await runWithProviderFlow(updated, async () => {
    await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2);
    await sendQualificationList(phone);
  });
}

async function requestRegionBeforeContinuing(phone, provider) {
  await updateProvider(phone, {
    status: STATUS.AWAITING_REGION_SELECTION,
    currentStep: 1.5,
    regionResumeStatus: provider.status,
    regionResumeStep: provider.currentStep || getStepForStatus(provider.status)
  });
  await appendHistory(phone, {
    type: 'system',
    event: 'region_required_before_resume',
    previousStatus: provider.status,
    previousStep: provider.currentStep || null
  });
  await sendAndLog(
    phone,
    'text',
    'Please select your region to continue onboarding.\n\nOnboarding തുടരാൻ ദയവായി region തിരഞ്ഞെടുക്കുക.'
  );
  await sendRegionSelectionList(phone);
}

async function resumeProviderAfterRegionSelection(phone, provider) {
  const resumeStatus = provider.regionResumeStatus;
  const resumeStep = provider.regionResumeStep || getStepForStatus(resumeStatus);
  await updateProvider(phone, {
    status: resumeStatus,
    currentStep: resumeStep,
    regionResumeStatus: null,
    regionResumeStep: null
  });

  const resumedProvider = await getProvider(phone);
  await appendHistory(phone, {
    type: 'system',
    event: 'region_selected_resume_onboarding',
    resumedStatus: resumeStatus,
    resumedStep: resumeStep
  });
  await sendAndLog(phone, 'text', 'Region saved. Continuing onboarding.');
  await sendPromptForCurrentStatus(phone, resumedProvider);
}

async function sendPromptForCurrentStatus(phone, provider) {
  switch (provider && provider.status) {
    case STATUS.AWAITING_QUALIFICATION:
      await sendQualificationList(phone);
      return;
    case STATUS.AWAITING_INTEREST:
      await sendInterestButtons(phone);
      return;
    case STATUS.AWAITING_DUTY_HOUR_PREFERENCE:
      await sendDutyHourPreferenceButtons(phone);
      return;
    case STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE:
      await sendSampleDutyOfferPrompt(phone);
      return;
    case STATUS.AWAITING_EXPECTED_DUTIES_CONFIRMATION:
      await sendExpectedDutiesFlow(phone);
      return;
    case STATUS.AWAITING_CERTIFICATE: {
      const attachments = provider && provider.documents ? provider.documents.certificateAttachments || [] : [];
      if (attachments.length) {
        await sendCertificateCollectionButtons(phone, provider);
      } else {
        await sendAndLog(phone, 'text', buildCertificateRequestMessage(provider));
      }
      return;
    }
    case STATUS.AWAITING_NAME:
      await sendAndLog(phone, 'text', MESSAGES.nameQuestion);
      return;
    case STATUS.AWAITING_AGE:
      await sendAndLog(phone, 'text', MESSAGES.ageQuestion);
      return;
    case STATUS.AWAITING_SEX:
      await sendSexButtons(phone);
      return;
    case STATUS.AWAITING_DISTRICT:
      await sendDistrictList(phone);
      return;
    case STATUS.VERIFICATION_PENDING:
      await sendAndLog(phone, 'text', verificationPendingMessageFor(provider));
      return;
    case STATUS.ADDITIONAL_DOCUMENT_REQUESTED: {
      const request = provider && provider.documents ? provider.documents.additionalDocumentRequest : null;
      await sendAndLog(
        phone,
        'text',
        request && request.note ? buildAdditionalDocumentMessage(request.note) : MESSAGES.verificationPending
      );
      return;
    }
    case STATUS.AWAITING_TERMS_ACCEPTANCE:
      await sendAndLog(phone, 'text', MESSAGES.termsIntro);
      await sendTermsButtons(phone);
      return;
    case STATUS.COMPLETED:
      await sendAndLog(phone, 'text', MESSAGES.completed);
      return;
    default:
      await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2);
      await sendQualificationList(phone);
  }
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

  // Until 27 Sep 2026 "None of these" lived here and was the only branch in
  // the flow that refused anyone. It is gone; "no_certificate" is a
  // qualification like the rest and walks the same path, reading the Basic
  // rate band, and is never asked for a document (see handleExpectedDuties).
  if (!qualification) {
    await sendAndLog(phone, 'text', MESSAGES.qualificationRetry);
    await sendQualificationList(phone);
    return;
  }

  /* Age before any rate. She used to be quoted her claimed band three times —
     working model, duty hours, sample offer — and only asked her age at step 10,
     so a 52-year-old nurse read ₹48,000 a month and then met ₹21,000 at the
     terms screen. Asking first means every figure she ever sees is her own.

     It also moves the over-50 refusal here, instead of after she has uploaded a
     certificate and answered eight questions. */
  await updateStatus(phone, STATUS.AWAITING_AGE, 3, { qualification });
  await sendAndLog(phone, 'text', MESSAGES.ageQuestion);
}

/* Shared by both positions of the age question: the new one after the
   qualification, and the legacy one after the name for anyone already
   mid-flow when this shipped. */
async function continueAfterEarlyAge(phone) {
  const tiers = await getProviderTiers();
  const provider = await getProvider(phone);
  await updateStatus(phone, STATUS.AWAITING_INTEREST, 4, {});
  const notice = getBasicTierAgeNoticeFor(provider, tiers);
  if (notice) {
    await sendAndLog(phone, 'text', notice);
  }
  await sendAndLog(phone, 'text', getWorkingModelFor(provider, tiers));
  // Its own bubble, between the working model and the interest question. Inside
  // the working model this sat at character 1,836 of 1,935, below a "Read more"
  // fold that falls at about 640 - correct, and invisible. It lands here
  // because this is the moment she decides whether to go on, and 180 days of
  // work is a large thing to ask without saying what it earns her.
  await sendAndLog(phone, 'text', MESSAGES.experienceCertificateNotice);
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

// Any reply moves her on. A phone that was mid-chat when this went live may
// still show the old three buttons (8 hour / 24 hour / both), and a typed
// answer is as good as a tap: nobody waits at this step.
async function handleDutyHourPreference(phone) {
  await updateStatus(phone, STATUS.AWAITING_SAMPLE_DUTY_OFFER_PREFERENCE, 6, {
    dutyHourPreference: DUTY_HOUR_ONLY,
    sampleDutyState: null
  });
  await sendSampleDutyOfferPrompt(phone);
}

async function handleSampleDutyOfferPreference(phone, message) {
  const action = parseSampleDutyOfferPreference(message);
  if (!action) {
    // Also an old "8 hour" or "both" tap from before 6 Oct 2026, when this
    // step asked the preference a second time: ask the one open question.
    await sendAndLog(phone, 'text', MESSAGES.sampleDutyOfferRetry);
    await sendSampleDutyOfferPrompt(phone);
    return;
  }
  if (action === 'show') {
    const provider = await getProvider(phone);
    await sendAndLog(phone, 'text', getSampleDutyOfferFor(provider, await getProviderTiers(), DUTY_HOUR_ONLY));
  }
  await moveToExpectedDuties(phone);
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

  // No certificate: there is nothing to upload, so she goes straight to her
  // name. The reviewer sees her in the same queue with no attachment and rings
  // her (opsNotifications says so in the alert).
  const applicant = await getProvider(phone);
  if (applicant && String(applicant.qualification || '').toLowerCase() === 'no_certificate') {
    await updateStatus(phone, STATUS.AWAITING_NAME, 9, { expectedDutiesAccepted: true });
    await sendAndLog(phone, 'text', MESSAGES.nameQuestion);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_CERTIFICATE, 8, { expectedDutiesAccepted: true });
  await sendAndLog(phone, 'text', buildCertificateRequestMessage(applicant));
}

// A certificate the reviewer cannot be shown is not a certificate we have.
// The alert sends the file as a link to the cloud archive — an app upload has no
// Meta media id at all, and a WhatsApp media id expires in about thirty days —
// so without that link there is nothing to show, now or later. Saying "sent for
// verification" on a local-disk copy alone left the caregiver waiting for a
// review that could never start; better to ask for the file again.
function isCertificateSendable(attachment) {
  if (!attachment || !attachment.id) {
    return false;
  }

  if (attachment.cloudArchived && attachment.cloudStorageUrl) {
    return true;
  }

  // Nothing is uploaded anywhere in a dry run, so the gate would block every
  // local test.
  return attachment.cloudArchiveStatus === 'dry_run';
}

async function addCertificate(phone, message) {
  const attachment = await archiveIncomingMedia(phone, message, 'certificate');

  if (!isCertificateSendable(attachment)) {
    console.error(
      '[CERTIFICATE_ARCHIVE_FAILED]',
      JSON.stringify(
        {
          phone,
          attachmentId: attachment ? attachment.id : null,
          archiveStatus: attachment ? attachment.archiveStatus : null,
          cloudArchiveStatus: attachment ? attachment.cloudArchiveStatus : null,
          cloudError: attachment ? attachment.cloudError : null
        },
        null,
        2
      )
    );
    await appendHistory(phone, {
      type: 'system',
      event: 'certificate_archive_failed',
      attachment
    });
    await sendAndLog(phone, 'text', MESSAGES.certificateUploadFailed);
    return false;
  }

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

  return true;
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
    const notificationResult = await notifyCertificateUploaded(refreshedProvider, attachments);
    const notificationPatch = buildVerificationNotificationPatch(notificationResult);
    if (notificationPatch) {
      await updateProvider(phone, {
        verification: notificationPatch
      });
    }
    await recordReviewAlertSend(phone, notificationPatch);
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
  const attachments = [];
  for (let index = 0; index < acceptedFiles.length; index += 1) {
    const file = acceptedFiles[index];
    const baseName = file.originalname || `manual-upload-${Date.now()}-${index}`;
    const safeName = String(baseName).replace(/[^\w.-]+/g, '_');
    const targetPath = path.join(providerDir, safeName);
    fs.writeFileSync(targetPath, file.buffer);

    // A file ops uploads here never passes through Meta, so it has no media id.
    // The cloud archive is the only copy the reviewer's alert can point at.
    const mimeType = file.mimetype || 'application/octet-stream';
    const cloudUpload = await uploadBufferToFirebaseStorage(
      phone,
      'certificate',
      safeName,
      file.buffer,
      mimeType
    );

    attachments.push({
      id: null,
      type: mimeType.startsWith('image/') ? 'image' : 'document',
      category: 'certificate',
      fileName: safeName,
      mimeType,
      bytes: file.size || file.buffer.length,
      storagePath: targetPath,
      archived: true,
      archiveStatus: 'manual_upload',
      cloudArchived: cloudUpload.uploaded,
      cloudArchiveStatus: cloudUpload.cloudArchiveStatus,
      cloudStorageBucket: cloudUpload.cloudStorageBucket || null,
      cloudStoragePath: cloudUpload.cloudStoragePath || null,
      cloudStorageUrl: cloudUpload.cloudStorageUrl || null,
      cloudError: cloudUpload.cloudError || null,
      uploadedBy,
      archivedAt,
      receivedAt: archivedAt
    });
  }

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
  const notificationResult = await notifyCertificateUploaded(
    verificationProvider,
    verificationProvider && verificationProvider.documents
      ? verificationProvider.documents.certificateAttachments || []
      : []
  );
  const notificationPatch = buildVerificationNotificationPatch(notificationResult);
  if (notificationPatch) {
    await updateProvider(phone, {
      verification: notificationPatch
    });
  }
  await recordReviewAlertSend(phone, notificationPatch);
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
      await sendCertificateRetry(phone, provider, { force: true });
      return;
    }

    await finalizeCertificateCollection(phone);
    return;
  }

  if (collectionAction === 'add_more') {
    clearPendingCertificatePrompt(phone);
    clearPendingCertificateRetry(phone);
    if (!attachments.length) {
      await sendCertificateRetry(phone, provider, { force: true });
      return;
    }

    await sendCertificateRetry(phone, provider, { force: true });
    return;
  }

  const kind = classifyDocument(message);
  if (kind !== 'certificate') {
    if (attachments.length) {
      await finalizeCertificateCollection(phone);
      return;
    }
    await sendCertificateRetry(phone, provider, { force: true });
    return;
  }

  clearPendingCertificateRetry(phone);

  if (attachments.length >= 4) {
    await sendAndLog(phone, 'text', MESSAGES.certificateUploadLimitReached);
    await finalizeCertificateCollection(phone);
    return;
  }

  const added = await addCertificate(phone, message);
  if (!added) {
    return;
  }

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
  const trimmedNote = expandCertificateOnlyNote(provider, String(note || '').trim());
  if (!trimmedNote) {
    throw new Error('Custom note is required');
  }

  const reviewer = String(requestedBy || config.adminDefaultReviewer || 'ops-team').trim();
  const requestedAt = new Date().toISOString();

  await updateProvider(phone, {
    status: STATUS.ADDITIONAL_DOCUMENT_REQUESTED,
    currentStep: 13,
    verification: { ...(provider.verification || {}), needsCall: false },
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

  /* Asked at step 3 now. Anyone who was already past that point when this
     shipped has no age on file, and is asked here exactly as before. */
  const known = await getProvider(phone);
  if (known && known.age) {
    await updateStatus(phone, STATUS.AWAITING_SEX, 11, { fullName: name });
    await sendSexButtons(phone);
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

  /* No upper age limit (founder, 3 Oct 2026). Above the Basic-age threshold
     she is told now that her duties are at the Basic rate (the notice after
     this step); above 50 she is also reviewed by a phone call, by the owner
     and the second reviewer. */

  /* `interestConfirmed` is set at the duty-hours step, so it is true only for
     someone who reached the age question the old way — after the name. They
     carry on to sex as before; everyone else is at the new early position and
     goes on to the rates. */
  const asked = await getProvider(phone);
  if (asked && asked.interestConfirmed) {
    await updateStatus(phone, STATUS.AWAITING_SEX, 11, { age });
    await sendSexButtons(phone);
    return;
  }

  await updateProvider(phone, { age });
  await continueAfterEarlyAge(phone);
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
  const notificationResult = await notifyCertificateUploaded(updatedProvider, attachments);
  const notificationPatch = buildVerificationNotificationPatch(notificationResult);
  if (notificationPatch) {
    await updateProvider(phone, {
      verification: notificationPatch
    });
  }
  await recordReviewAlertSend(phone, notificationPatch);
  await appendHistory(phone, { type: 'system', event: 'verification_queue_created' });
  await sendAndLog(phone, 'text', verificationPendingMessageFor(updatedProvider));
}

/** "Your certificate has been sent for verification" is untrue for someone who
 *  has none; she is told a call is coming instead. */
function verificationPendingMessageFor(provider) {
  const qualification = String(provider && provider.qualification || '').toLowerCase();
  if (qualification === 'nursing_student' && MESSAGES.verificationPendingNursingStudent) {
    return MESSAGES.verificationPendingNursingStudent;
  }
  if (qualification !== 'no_certificate' && isAboveCallReviewAge(provider) && MESSAGES.verificationPendingBasicAge) {
    return MESSAGES.verificationPendingBasicAge;
  }
  return qualification === 'no_certificate' && MESSAGES.verificationPendingNoCertificate
    ? MESSAGES.verificationPendingNoCertificate
    : MESSAGES.verificationPending;
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

  await sendTermsIntroIfMissing(phone, provider);
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
    const updatedProvider = await getProvider(phone);
    await sendOptionalVideo(
      () => sendPulsoAppActivationVideo(phone, updatedProvider, 'bot'),
      phone,
      'PULSO_APP_ACTIVATION_VIDEO_SEND_ERROR'
    );
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
    const updatedProvider = await getProvider(phone);
    await sendOptionalVideo(
      () => sendPulsoAppActivationVideo(phone, updatedProvider, 'bot'),
      phone,
      'PULSO_APP_ACTIVATION_VIDEO_SEND_ERROR'
    );
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
    // They just tapped, so the reply window is open: if the hub already saw
    // this phone sign in, say so now instead of "we will verify".
    await syncPulsoAppActivationFromHub(phone, { source: 'installed_tap', notify: true });
    const provider = await getProvider(phone);
    await sendOptionalVideo(
      () => sendDutyAcceptVideo(phone, provider),
      phone,
      'DUTY_ACCEPT_VIDEO_SEND_ERROR'
    );
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
  if (mobileAppStage === MOBILE_APP_STAGE_AGENCY_QUESTION) {
    await handleAgencyQuestion(phone, message);
    return;
  }
  if (mobileAppStage === MOBILE_APP_STAGE_ADD_DUTY_INTEREST) {
    await handleAddDutyInterest(phone, message);
    return;
  }
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

  // She asks about the experience certificate. Answered with HER number, read
  // from the hub, so the chat and the app never disagree. Checked only after
  // onboarding is complete, because before that "certificate" means the GDA or
  // GNM certificate she was asked to upload.
  if (isDutyDaysQuestion(message)) {
    const progress = await getDutyDaysProgress(provider);
    await sendAndLog(phone, 'text', dutyDaysMessage(progress, (provider && provider.language) || 'ml'));
    return;
  }

  // "duty" resends the Duty Card steps; "agency" asks the question again.
  if (isAddDutyKeyword(message)) {
    await sendAddDutyProcedure(phone, provider);
    return;
  }
  if (isAgencyKeyword(message)) {
    await updateProvider(phone, {
      pulsoAppPromptStage: MOBILE_APP_STAGE_AGENCY_QUESTION,
      mobileAppCampaignStage: MOBILE_APP_STAGE_AGENCY_QUESTION,
      agencyQuestionRetried: false
    });
    await sendAgencyQuestionButtons(phone);
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

// verifiedBy is whoever confirmed it: an admin from the dashboard, or
// PULSO_APP_HUB_SYNC_ACTOR when the hub itself said the phone signed in. The
// hub sync passes the uid and moment it found, and may ask not to message when
// the person is outside the WhatsApp reply window.
async function markPulsoAppActivationVerified(phone, verifiedBy = config.adminDefaultReviewer, options = {}) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  const actor = verifiedBy || config.adminDefaultReviewer;
  const notify = options.notify !== false;
  const hub = options.hub || null;

  return runWithProviderFlow(provider, async () => {
    const verifiedAt = new Date().toISOString();
    await updateProvider(phone, {
      pulsoAppRequired: true,
      pulsoAppActivationStatus: 'verified',
      pulsoAppActivationVerifiedAt: verifiedAt,
      pulsoAppActivationVerifiedBy: actor,
      pulsoAppPromptStage: null,
      mobileAppCampaignStage: null,
      mobileAppCampaignStatus: MOBILE_APP_CAMPAIGN_STATUS.APP_VERIFIED,
      mobileAppCampaignCompletedAt: verifiedAt,
      ...(hub
        ? {
            pulsoAppHubUid: hub.uid || null,
            pulsoAppHubActivatedAt: hub.activatedAt || null,
            pulsoAppHubMatchStatus: hub.matchStatus || null,
            pulsoAppHubCheckedAt: verifiedAt
          }
        : {})
    });
    await appendHistory(phone, {
      type: 'system',
      event: 'pulso_app_activation_verified',
      verifiedBy: actor,
      ...(hub ? { hubUid: hub.uid || null, hubActivatedAt: hub.activatedAt || null } : {}),
      ...(notify ? {} : { notified: false })
    });
    if (notify) {
      await sendAndLog(phone, 'text', MESSAGES.pulsoAppActivationVerified, actor);
    }
    return getProvider(phone);
  });
}

const PULSO_APP_HUB_SYNC_ACTOR = 'pulso_hub_sync';
const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

// The moment of the last WhatsApp message *from* the person. Free-form text
// only reaches them within 24 hours of that, so the sweep stays quiet after.
function lastWhatsappInboundAt(provider) {
  const history = Array.isArray(provider && provider.history) ? provider.history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.type === 'inbound_message' && entry.channel !== 'app' && entry.at) {
      return entry.at;
    }
  }
  return null;
}

function isWithinWhatsappReplyWindow(provider, nowMs = Date.now()) {
  const at = lastWhatsappInboundAt(provider);
  if (!at) {
    return false;
  }
  const atMs = new Date(at).getTime();
  return Number.isFinite(atMs) && nowMs - atMs <= WHATSAPP_REPLY_WINDOW_MS;
}

// Asks the hub whether this phone has signed into the app, and if so marks the
// bot record verified without waiting for an admin. Never throws: a hub that is
// unreachable is recorded on the provider and reported, not raised, because
// this runs inside a WhatsApp turn and inside a sweep of hundreds.
//   source  - 'installed_tap' | 'sweep' | 'admin'  (kept in history)
//   notify  - true, false, or 'window' (only inside the 24h reply window)
async function syncPulsoAppActivationFromHub(phone, options = {}) {
  const source = options.source || 'sweep';
  const provider = options.provider || (await getProvider(phone));
  if (!provider) {
    return { phone, result: 'not_found' };
  }
  if (provider.pulsoAppActivationStatus === 'verified') {
    return { phone, result: 'already_verified', uid: provider.pulsoAppHubUid || null };
  }

  const checkedAt = new Date().toISOString();
  let hub;
  try {
    hub = await getHubAppActivation(phone);
  } catch (error) {
    console.error('[PULSO_APP_HUB_SYNC_ERROR]', JSON.stringify({ phone, source, message: error.message }));
    await updateProvider(phone, { pulsoAppHubCheckedAt: checkedAt, pulsoAppHubCheckError: error.message });
    return { phone, result: 'hub_error', error: error.message };
  }

  if (!hub.activated) {
    await updateProvider(phone, {
      pulsoAppHubCheckedAt: checkedAt,
      pulsoAppHubMatchStatus: hub.found ? hub.matchStatus || 'unmatched' : 'not_mirrored',
      pulsoAppHubCheckError: null
    });
    return { phone, result: hub.found ? 'not_activated' : 'not_mirrored', matchStatus: hub.matchStatus };
  }

  let notify = options.notify;
  if (notify === undefined || notify === 'window') {
    // The sweep hands in a summary without history; the window needs the
    // full record, but only now that there is something to say.
    const full = Array.isArray(provider.history) ? provider : await getProvider(phone);
    notify = isWithinWhatsappReplyWindow(full);
  }

  try {
    await markPulsoAppActivationVerified(phone, PULSO_APP_HUB_SYNC_ACTOR, { notify: Boolean(notify), hub });
  } catch (error) {
    // The record may already read verified even if the WhatsApp send failed;
    // either way this is reported, not raised.
    console.error('[PULSO_APP_HUB_SYNC_ERROR]', JSON.stringify({ phone, source, message: error.message }));
    const after = await getProvider(phone);
    if (after && after.pulsoAppActivationStatus === 'verified') {
      return { phone, result: 'verified', notified: false, uid: hub.uid, activatedAt: hub.activatedAt, error: error.message };
    }
    return { phone, result: 'verify_error', error: error.message };
  }

  await appendHistory(phone, { type: 'system', event: 'pulso_app_activation_synced_from_hub', source });
  return { phone, result: 'verified', notified: Boolean(notify), uid: hub.uid, activatedAt: hub.activatedAt };
}

async function clearReviewerWorkflow(phone) {
  const provider = await getProvider(phone);
  await updateProvider(phone, buildReviewerWorkflowPatch(provider && provider.verification && provider.verification.reviewerWorkflow, null));
}

function isPendingCertificateReview(provider) {
  return Boolean(
    provider &&
      provider.phone &&
      provider.status === STATUS.VERIFICATION_PENDING &&
      !provider.termsAccepted &&
      !provider.completedAt &&
      provider.verification &&
      provider.verification.status === 'pending'
  );
}

async function resendLatestPendingCertificateReview(reviewerPhone) {
  const candidates = await listPendingVerificationNotificationProviders();
  const pendingProvider = candidates.find(isPendingCertificateReview);
  if (!pendingProvider) {
    return false;
  }

  const attachments =
    pendingProvider && pendingProvider.documents
      ? pendingProvider.documents.certificateAttachments || []
      : [];
  const notificationResult = await notifyCertificateUploaded(pendingProvider, attachments);
  const notificationPatch = buildVerificationNotificationPatch(
    notificationResult,
    pendingProvider.verification ? pendingProvider.verification.reviewAlert : null
  );
  if (!notificationPatch) {
    return false;
  }

  await updateProvider(pendingProvider.phone, {
    verification: notificationPatch
  });
  await recordReviewAlertSend(pendingProvider.phone, notificationPatch);
  await appendHistory(pendingProvider.phone, {
    type: 'system',
    event: 'verification_notification_resent_after_reviewer_reply',
    reviewerPhone
  });
  return pendingProvider.phone;
}

// Who decided, in words, for the second tap on the same person.
function formatIstTime(iso) {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  return at.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function describeReviewDecision(provider, providerPhone) {
  const verification = (provider && provider.verification) || {};
  const who = reviewerDisplayName(verification.reviewedBy) || verification.reviewedBy || '';
  const when = formatIstTime(verification.reviewedAt);
  const tail = `${who ? ` by ${who}` : ''}${when ? ` at ${when}` : ''}`;
  if (verification.status === 'verified') return `Already approved${tail} (${providerPhone}).`;
  if (verification.status === 'rejected') return `Already rejected${tail} (${providerPhone}).`;
  return `Certificate review is not pending for ${providerPhone}.`;
}

// Taps that change the outcome. Any of them on a person someone else has
// already decided gets "Already approved by …" and does nothing, so the first
// reviewer to tap decides.
const DECIDING_REVIEW_ACTIONS = new Set([
  'call_reject_reason',
  'confirm_call_reject',
  'call_basic',
  'approve',
  'approve_basic',
  'approve_qualification',
  'basic_tier_reason',
  'confirm_approve',
  'request_additional_document',
  'confirm_request_additional_document',
  'reject',
  'add_note',
  'confirm_reject'
]);

// What the "No certificate" reviewer may do: call, approve as Basic, reject.
const NO_CERTIFICATE_REVIEWER_ACTIONS = new Set([
  'call_reject_reason',
  'confirm_call_reject',
  'approve_basic',
  'basic_tier_reason',
  'confirm_approve',
  'reject',
  'add_note',
  'confirm_reject',
  'cancel',
  'note_text'
]);

// Any text from the "No certificate" reviewer (REVIEW, hi, …) opens their
// window, so the oldest waiting "No certificate" alert can now go to them in
// full. Only to them, and only a "No certificate" one.
async function resendNoCertificateReviewTo(reviewerPhone) {
  const candidates = await listPendingVerificationNotificationProviders();
  const waiting = candidates.filter((c) => isPendingCertificateReview(c) && isNoCertificateProvider(c));
  if (!waiting.length) return null;
  const provider = waiting[0];
  await notifyNoCertificateApplication(provider, [reviewerPhone], { skipNotice: true });
  return provider.phone;
}

const NO_CERTIFICATE_REVIEWER_HELP =
  'You review "No certificate", nursing-student and above-50 applications only. Use the buttons on each alert: Call her, Approve (Basic) or Reject.';

/* Call (Basic): the paper she sent is not the certificate she claimed. She is
   sent nothing; she goes into "Needs a call" on the desk, where the reviewer
   rings her and approves her on the Basic rate or rejects her. Approving,
   rejecting or asking for a document takes her out (her status moves on). */
async function markNeedsCall(phone, by) {
  const provider = await getProvider(phone);
  if (!provider) throw new Error('Provider not found');
  if (!isPendingCertificateReview(provider)) throw new Error('Certificate review is not pending');
  await updateProvider(phone, {
    verification: {
      needsCall: true,
      needsCallAt: new Date().toISOString(),
      needsCallBy: String(by || config.adminDefaultReviewer || 'ops-team'),
      needsCallReason: 'certificate_not_valid'
    }
  });
  await appendHistory(phone, { type: 'system', event: 'needs_call_certificate_not_valid', by: String(by || '') });
  return getProvider(phone);
}

async function handleReviewerMessage(phone, message) {
  let reviewAction = parseReviewerAction(message);
  const scopedReviewer = isNoCertificateReviewerPhone(phone) && !isReviewerPhone(phone);
  // The second reviewer approves only on the Basic rate; an old "Approve"
  // button means the same thing for them.
  if (scopedReviewer && reviewAction && reviewAction.action === 'approve') {
    reviewAction = { ...reviewAction, action: 'approve_basic' };
  }
  if (
    scopedReviewer &&
    reviewAction &&
    !NO_CERTIFICATE_REVIEWER_ACTIONS.has(reviewAction.action) &&
    !getRejectReasonDetails(reviewAction.action)
  ) {
    await sendText(phone, NO_CERTIFICATE_REVIEWER_HELP);
    return;
  }
  const providerPhone = reviewAction && reviewAction.phone ? reviewAction.phone : null;

  if (reviewAction && reviewAction.action === 'note_text') {
    const candidates = await listReviewerWorkflowProviders(phone);
    const pendingProvider = candidates.find(
      (candidate) =>
        isPendingCertificateReview(candidate) &&
        candidate &&
        candidate.verification &&
        candidate.verification.reviewerWorkflow &&
        candidate.verification.reviewerWorkflow.reviewerPhone === phone &&
        ['awaiting_note', 'awaiting_additional_document_note'].includes(candidate.verification.reviewerWorkflow.stage)
    );

    if (!pendingProvider && scopedReviewer) {
      const resent = await resendNoCertificateReviewTo(phone);
      if (!resent) await sendText(phone, `No "No certificate" application is waiting right now. ${NO_CERTIFICATE_REVIEWER_HELP}`);
      return;
    }

    if (!pendingProvider) {
      const resentProviderPhone = await resendLatestPendingCertificateReview(phone);
      if (resentProviderPhone) {
        await sendText(phone, `Sent latest pending certificate review for ${resentProviderPhone}.`);
      } else {
        await sendText(phone, 'No reviewer note is pending right now.');
      }
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

  if ((!reviewAction || !providerPhone) && scopedReviewer) {
    const resent = await resendNoCertificateReviewTo(phone);
    if (!resent) await sendText(phone, `No "No certificate" application is waiting right now. ${NO_CERTIFICATE_REVIEWER_HELP}`);
    return;
  }

  if (!reviewAction || !providerPhone) {
    const resentProviderPhone = await resendLatestPendingCertificateReview(phone);
    if (resentProviderPhone) {
      await sendText(phone, `Sent latest pending certificate review for ${resentProviderPhone}.`);
    } else {
      await sendText(phone, 'Review command not recognized. Use the Approve/Reject button or send APPROVE <provider-phone>.');
    }
    return;
  }

  const provider = await getProvider(providerPhone);
  if (!provider) {
    await sendText(phone, `Provider not found for ${providerPhone}.`);
    return;
  }

  if (scopedReviewer && !isNoCertificateProvider(provider)) {
    await sendText(phone, `${providerPhone} is not a "No certificate" application. ${NO_CERTIFICATE_REVIEWER_HELP}`);
    return;
  }

  if (
    !isPendingCertificateReview(provider) &&
    (DECIDING_REVIEW_ACTIONS.has(reviewAction.action) || getRejectReasonDetails(reviewAction.action))
  ) {
    await sendText(phone, describeReviewDecision(provider, providerPhone));
    return;
  }

  /* Reject for someone reviewed by a call: three reasons, then one confirm,
     and a closing message that never asks for a certificate she does not have. */
  if (reviewAction.action === 'reject' && isNoCertificateProvider(provider)) {
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: 'choose_call_reject_reason',
        reason: null,
        reasonLabel: null,
        note: ''
      })
    );
    await requestCallRejectReason(await getProvider(providerPhone), phone);
    return;
  }

  if (reviewAction.action === 'call_reject_reason') {
    const label = CALL_REJECT_REASONS[reviewAction.reason] || reviewAction.reason;
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: 'awaiting_call_reject_confirmation',
        reason: reviewAction.reason,
        reasonLabel: label
      })
    );
    const providerMessage = await runWithProviderFlow(provider, async () => MESSAGES.callReviewRejected);
    await requestCallRejectConfirmation(await getProvider(providerPhone), reviewAction.reason, phone, providerMessage);
    return;
  }

  if (reviewAction.action === 'confirm_call_reject') {
    const workflow = provider.verification && provider.verification.reviewerWorkflow;
    if (!workflow || !workflow.reason || workflow.stage !== 'awaiting_call_reject_confirmation') {
      await requestCallRejectReason(provider, phone);
      return;
    }
    await clearReviewerWorkflow(providerPhone);
    await rejectCallReviewApplicant(providerPhone, phone, workflow.reasonLabel || workflow.reason);
    await sendText(phone, `Rejected ${provider.fullName || providerPhone} (${workflow.reasonLabel || workflow.reason}). She has been sent the closing message.`);
    return;
  }

  if (reviewAction.action === 'call_basic') {
    await markNeedsCall(providerPhone, phone);
    const refreshedProvider = await getProvider(providerPhone);
    await requestCallBasicDecision(refreshedProvider, phone);
    return;
  }

  /* Approve (Basic): someone with no certificate is taken on at the Basic rate,
     and the reason is already known (no course certificate, plus age when she
     is over the threshold), so this goes straight to Confirm approve. */
  if (reviewAction.action === 'approve_basic') {
    const tiers = await getProviderTiers();
    // Why the Basic rate: her age, the missing course certificate, or both. Above
    // 50 with a real certificate it is the age alone.
    const overAge = Number(provider.age) > Number(tiers.basicTierAgeThreshold);
    const noCourse =
      ['no_certificate', 'nursing_student', 'basic_caregiver'].includes(String(provider.qualification || '').toLowerCase()) ||
      Boolean(provider.verification && provider.verification.needsCall);
    const reasons = [];
    if (overAge) reasons.push('age_over_threshold');
    if (noCourse || !overAge) reasons.push('no_course_certificate');
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: 'awaiting_approve_confirmation',
        qualification: 'basic_caregiver',
        basicTierReasons: normalizeBasicTierReasons(reasons)
      })
    );
    const refreshedProvider = await getProvider(providerPhone);
    await requestReviewConfirmation(refreshedProvider, 'approve', phone, 'basic_caregiver');
    return;
  }

  if (reviewAction.action === 'cancel') {
    await clearReviewerWorkflow(providerPhone);
    await sendText(phone, `Cancelled review action for ${providerPhone}.`);
    return;
  }

  if (reviewAction.action === 'approve') {
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: 'awaiting_approve_qualification',
        qualification: null
      })
    );
    const refreshedProvider = await getProvider(providerPhone);
    await requestReviewQualificationSelection(refreshedProvider, phone);
    return;
  }

  if (reviewAction.action === 'approve_qualification') {
    const qualification = normalizeApprovedQualification(reviewAction.qualification);
    if (!qualification) {
      await sendText(phone, 'Choose a valid qualification before approving.');
      return;
    }

    /* One more question before the confirm, and only when it is needed: the
       Basic rate has to say why, because the sentence she reads before
       accepting the terms depends on the answer. */
    const tiers = await getProviderTiers();
    const onBasic =
      qualification === 'basic_caregiver' ||
      Number(provider.age) > Number(tiers.basicTierAgeThreshold);

    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(provider.verification && provider.verification.reviewerWorkflow, {
        reviewerPhone: phone,
        stage: onBasic ? 'awaiting_basic_tier_reason' : 'awaiting_approve_confirmation',
        qualification,
        basicTierReasons: []
      })
    );
    const refreshedProvider = await getProvider(providerPhone);
    if (onBasic) {
      await requestBasicTierReasonSelection(refreshedProvider, phone);
      return;
    }
    await requestReviewConfirmation(refreshedProvider, 'approve', phone, qualification);
    return;
  }

  if (reviewAction.action === 'basic_tier_reason') {
    const workflow = provider.verification && provider.verification.reviewerWorkflow;
    const qualification = normalizeApprovedQualification(workflow && workflow.qualification);
    if (!qualification) {
      await sendText(phone, 'Choose a qualification first.');
      return;
    }
    await updateProvider(
      providerPhone,
      buildReviewerWorkflowPatch(workflow, {
        reviewerPhone: phone,
        stage: 'awaiting_approve_confirmation',
        qualification,
        basicTierReasons: normalizeBasicTierReasons(reviewAction.reasons)
      })
    );
    const refreshedProvider = await getProvider(providerPhone);
    await requestReviewConfirmation(refreshedProvider, 'approve', phone, qualification);
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

    const workflow = provider.verification && provider.verification.reviewerWorkflow;
    const qualification = normalizeApprovedQualification(workflow && workflow.qualification);
    if (!qualification) {
      await updateProvider(
        providerPhone,
        buildReviewerWorkflowPatch(workflow, {
          reviewerPhone: phone,
          stage: 'awaiting_approve_qualification',
          qualification: null
        })
      );
      const refreshedProvider = await getProvider(providerPhone);
      await requestReviewQualificationSelection(refreshedProvider, phone);
      return;
    }

    const basicTierReasons = normalizeBasicTierReasons(workflow && workflow.basicTierReasons);
    await clearReviewerWorkflow(providerPhone);
    const approval = await approveCertificate(
      providerPhone,
      phone,
      'Approved from reviewer WhatsApp',
      qualification,
      basicTierReasons
    );
    // A second tap says so, the way the reject branch below already does.
    // Staying silent would leave the reviewer unsure whether either tap landed.
    await sendText(
      phone,
      approval.already
        ? `Certificate is already approved for ${providerPhone}${approval.reviewedBy ? ` by ${approval.reviewedBy}` : ''}.`
        : `Approved certificate for ${providerPhone}.`
    );
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
  // A tap on a duty broadcast (I'm interested / Not now) is handled there and
  // goes only to the duty-interest number; typed words fall through.
  try {
    const { handleDutyBroadcastReply } = require('./dutyBroadcast');
    if (await handleDutyBroadcastReply(phone, message)) return;
  } catch (error) {
    console.error('[DUTY_BROADCAST_REPLY_ERROR]', error.message);
  }

  if (isReviewerPhone(phone) || isNoCertificateReviewerPhone(phone)) {
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

  if (provider.status === STATUS.AWAITING_LANGUAGE_SELECTION) {
    await handleLanguageSelection(phone, message);
    return;
  }

  if (provider.status === STATUS.NEW) {
    await startFlow(phone);
    return;
  }

  if (statusRequiresRegion(provider.status) && !inferProviderRegion(provider)) {
    await requestRegionBeforeContinuing(phone, provider);
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

async function sendCertificateApprovalFollowup(phone, provider, reviewer) {
  // `provider` is re-read after approveCertificate wrote the reviewer's choice,
  // so this is the APPROVED qualification, not what the candidate claimed.
  const approvedQualification = provider && provider.qualification;
  const steps = [
    {
      name: 'certificate_approved_message',
      send: () => sendAndLog(phone, 'text', getCertificateApprovedFor(approvedQualification), reviewer)
    },
    // A Basic caregiver reads their actual pay, and why, before the terms —
    // every other qualification gets nothing extra here.
    {
      name: 'terms_rate_message',
      send: async () => {
        const line = getTermsRateFor({ qualification: approvedQualification, age: provider.age, careTier }, await getProviderTiers());
        if (!line) return false;
        await sendAndLog(phone, 'text', line, reviewer);
        return true;
      }
    },
    {
      name: 'terms_intro_message',
      send: () => sendTermsIntroIfMissing(phone, provider, reviewer)
    },
    {
      name: 'terms_acceptance_buttons',
      send: () => sendTermsButtons(phone)
    }
  ];
  const failures = [];

  for (const step of steps) {
    try {
      await step.send();
    } catch (error) {
      const failure = {
        step: step.name,
        ...buildSendFailureDetails(error)
      };
      failures.push(failure);
      console.error('[CERTIFICATE_APPROVAL_FOLLOWUP_SEND_FAILED]', phone, JSON.stringify(failure, null, 2));
    }
  }

  if (failures.length) {
    await appendHistory(phone, {
      type: 'system',
      event: 'certificate_approval_followup_send_failed',
      failures
    });
  }

  return failures.length === 0;
}

/* True once an approval has actually gone out for this provider.
   Both halves matter. `verified` alone is not enough: a provider who was
   rejected and is being approved again still carries the verification from the
   first time round, and that approval has to send. `termsSentAt` is stamped by
   the approval below, so the pair together mean "the terms have already left". */
function hasAlreadyBeenApproved(provider) {
  return Boolean(
    provider &&
      provider.verification &&
      provider.verification.status === 'verified' &&
      provider.termsSentAt
  );
}

/* Approving is idempotent. Pressing it twice — a double-click on the desk, a
   second tap on the reviewer's WhatsApp buttons, or one of each — used to send
   the provider a second approval, a second copy of the terms and a second pair
   of Accept / Decline buttons on a record that had already moved past that
   step. Now the second call reports who approved and when, and sends nothing.
   Mirrors invitePartnerAfterTermsCore in pulso-hub, which answers the same way. */
async function approveCertificate(phone, reviewedBy, notes, qualification, reasons) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  if (hasAlreadyBeenApproved(provider)) {
    return {
      provider,
      already: true,
      reviewedBy: provider.verification.reviewedBy || '',
      reviewedAt: provider.verification.reviewedAt || provider.termsSentAt || ''
    };
  }

  const approvedQualification = normalizeApprovedQualification(qualification);
  if (!approvedQualification) {
    throw new Error('Approved qualification is required');
  }

  /* The Basic rate needs a reason, whichever door it came through: the
     qualification itself, or an age above the threshold. Without one there is
     no way to tell later whether a lower rate was a decision or a slip — and
     the message she reads depends on which reason it was. */
  const basicTierReasons = normalizeBasicTierReasons(reasons);
  const tiers = await getProviderTiers();
  const landsOnBasic =
    approvedQualification === 'basic_caregiver' ||
    Number(provider.age) > Number(tiers.basicTierAgeThreshold);
  if (landsOnBasic && basicTierReasons.length === 0) {
    throw new Error('A reason is required when approving someone onto the Basic rate');
  }
  if (!landsOnBasic && basicTierReasons.length > 0) {
    throw new Error('Basic-rate reasons were given for an approval that is not on the Basic rate');
  }

  return runWithProviderFlow(provider, async () => {
  const reviewedAt = new Date().toISOString();
  const reviewer = reviewedBy || config.adminDefaultReviewer;
  const qualificationBeforeReview = provider.qualification || null;
  const candidateSelectedQualification = provider.candidateSelectedQualification || qualificationBeforeReview;
  /* A 52-year-old GNM is a nurse on the Basic rate, not a Basic Caregiver.
     Overwriting her qualification was how she stopped being findable as a
     nurse at all; the tier is stored beside it instead, which is what the
     hub's tierForProvider already expects to read. */
  const careTier = tierDecisionFor(basicTierReasons);
  await updateProvider(phone, {
    candidateSelectedQualification,
    qualification: approvedQualification,
    ...(careTier ? { careTier, basicTierReasons } : {}),
    status: STATUS.AWAITING_TERMS_ACCEPTANCE,
    currentStep: 14,
    termsSentAt: reviewedAt,
    termsReminderSentAt: null,
    termsReminderCount: 0,
    termsReminderKind: null,
    termsReminderReplyReceivedAt: null,
    termsDeclinedAt: null,
    verification: {
      status: 'verified',
      notes: notes || '',
      needsCall: false,
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy || config.adminDefaultReviewer
    }
  });
  await appendHistory(phone, {
    type: 'system',
    event: 'certificate_verified',
    approvedQualification,
    ...(careTier ? { careTier, basicTierReasons } : {})
  });
  let updatedProvider = await getProvider(phone);
  await sendCertificateApprovalFollowup(phone, updatedProvider, reviewer);
  updatedProvider = await getProvider(phone);
  await notifyCertificateReviewed(
    updatedProvider,
    'approved',
    reviewer,
    notes || ''
  );
  return { provider: updatedProvider, already: false, reviewedBy: reviewer, reviewedAt };
  });
}

/* Why an undo is refused, or '' when it can go ahead.

   The two "too late" cases are the point of this function. Once someone has
   accepted the terms they have a partner account and an app login in
   pulso-hub; rolling the record back here would leave those orphaned, with
   this desk saying "waiting for review" about a person who is already working.
   That is worse than the wrong approval it is trying to fix. */
function blockUndoReason(provider) {
  if (!provider) return 'Provider not found';
  const verification = provider.verification || {};
  if (verification.status !== 'verified') {
    return 'This certificate is not approved, so there is nothing to undo';
  }
  if (provider.termsAccepted === true) {
    return 'They have already accepted the terms — undo is not possible from here';
  }
  if (provider.status === STATUS.COMPLETED) {
    return 'They have already completed onboarding — undo is not possible from here';
  }
  return '';
}

/* Put an approved provider back in the review queue.

   The inverse of approveCertificate, and deliberately not a quiet one: it
   records who undid it and why, tells the reviewers, and tells the provider.
   They already hold "your certificate is verified" and a live pair of terms
   buttons — the record changing underneath them is not something they can see. */
async function undoApproval(phone, reviewedBy, reason) {
  const provider = await getProvider(phone);
  const blocked = blockUndoReason(provider);
  if (blocked) {
    const error = new Error(blocked);
    error.statusCode = provider ? 409 : 404;
    throw error;
  }

  return runWithProviderFlow(provider, async () => {
    const undoneAt = new Date().toISOString();
    const reviewer = reviewedBy || config.adminDefaultReviewer;
    const note = String(reason || '').trim();

    await updateProvider(phone, {
      status: STATUS.VERIFICATION_PENDING,
      currentStep: 13,
      // The terms were never accepted, so every trace of having sent them goes.
      termsSentAt: null,
      termsReminderSentAt: null,
      termsReminderCount: 0,
      termsReminderKind: null,
      termsReminderReplyReceivedAt: null,
      termsDeclinedAt: null,
      verification: {
        status: 'pending',
        notes: note,
        undoneAt,
        undoneBy: reviewer,
        undoneReason: note
      }
    });
    await appendHistory(phone, {
      type: 'system',
      event: 'certificate_approval_undone',
      undoneBy: reviewer,
      reason: note,
      undoneAt
    });

    // Best effort: the record is already correct, and a message that fails to
    // send must not roll that back or the queue starts lying again.
    try {
      await sendAndLog(phone, 'text', MESSAGES.approvalUndone, reviewer);
    } catch (error) {
      console.error(
        '[UNDO_APPROVAL_NOTICE_ERROR]',
        JSON.stringify({ phone, message: error.message })
      );
    }

    const updatedProvider = await getProvider(phone);
    await notifyCertificateReviewed(updatedProvider, 'approval undone', reviewer, note);
    return updatedProvider;
  });
}

// A call-review applicant (No certificate, nursing student, above 50) turned
// down: closed for good, her details kept, and a closing message instead of
// "upload your certificate again".
async function rejectCallReviewApplicant(phone, reviewedBy, reasonLabel) {
  return rejectCertificate(phone, reviewedBy, `Reason: ${reasonLabel} (after call)`, {
    rejectMessageKey: 'callReviewRejected',
    nextStatus: STATUS.CERTIFICATE_REJECTED_PERMANENT,
    nextStep: 13,
    resetCertificate: false
  });
}

async function rejectCertificate(phone, reviewedBy, notes, options = {}) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  // From the desk (no options): a call-review applicant gets the call-review
  // rejection, never the certificate one.
  if (!options.nextStatus && !options.rejectMessageKey && !options.providerMessage && isNoCertificateProvider(provider)) {
    options = { rejectMessageKey: 'callReviewRejected', nextStatus: STATUS.CERTIFICATE_REJECTED_PERMANENT, nextStep: 13, resetCertificate: false };
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
      needsCall: false,
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
  markNeedsCall,
  rejectCallReviewApplicant,
  // Exported for the certificate-wording test.
  buildCertificateRequestMessage,
  buildCertificateRetryMessage,
  expandCertificateOnlyNote,
  normalizeBasicTierReasons,
  BASIC_TIER_REASONS,
  processIncomingMessage,
  approveCertificate,
  undoApproval,
  blockUndoReason,
  // Exported so the idempotency rule can be tested without a Firestore.
  hasAlreadyBeenApproved,
  rejectCertificate,
  requestAdditionalDocument,
  markPulsoAppActivationVerified,
  syncPulsoAppActivationFromHub,
  isWithinWhatsappReplyWindow,
  lastWhatsappInboundAt,
  PULSO_APP_HUB_SYNC_ACTOR,
  runMobileAppCampaignForCompletedProviders,
  runAgencyQuestionForCompletedProviders,
  isCompletedProviderEligibleForAgencyQuestion,
  reconcileAcceptedTermsProviders,
  runCurrentWaitingTermsReminderBackfill,
  runLegacyTermsReminderBackfill,
  runTermsReminderSweep,
  startTermsReminderScheduler,
  runDutyDaysMilestoneSweep,
  startDutyDaysMilestoneScheduler,
  startFlow,
  adminUploadCertificateFiles
};
