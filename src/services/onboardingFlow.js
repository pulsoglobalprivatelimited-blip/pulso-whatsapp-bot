const config = require('../config');
const fs = require('fs');
const path = require('path');
const { MESSAGES, STATUS, BUTTON_IDS, QUALIFICATIONS, DISTRICTS } = require('../flow');
const { sendText, sendButtons, sendList } = require('./metaClient');
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
  parseCertificateCollectionAction,
  classifyDocument
} = require('./messageParser');
const { archiveIncomingMedia } = require('./mediaStorage');

const pendingCertificatePromptTimers = new Map();
const pendingCertificateRetryTimers = new Map();
const CERTIFICATE_PROMPT_DEBOUNCE_MS = 5000;
const AGENT_HELP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

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
      { id: BUTTON_IDS.CERTIFICATE_ADD_MORE, title: 'കൂടുതൽ അയക്കാം' },
      { id: BUTTON_IDS.CERTIFICATE_CONTINUE, title: 'തുടരാം' }
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

      const attachments = provider.documents && provider.documents.certificateAttachments
        ? provider.documents.certificateAttachments
        : [];

      if (!attachments.length || attachments.length >= 4) {
        return;
      }

      await sendCertificateCollectionButtons(phone, provider);
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

      const attachments = provider.documents && provider.documents.certificateAttachments
        ? provider.documents.certificateAttachments
        : [];

      if (attachments.length) {
        return;
      }

      await sendIfChanged(phone, provider, 'text', MESSAGES.certificateRetry);
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
    buttonText: 'തിരഞ്ഞെടുക്കുക',
    sections: [
      {
        title: 'Qualification options',
        rows: QUALIFICATIONS
      }
    ]
  });
}

async function sendDistrictList(phone) {
  const provider = await getProvider(phone);
  const page = provider && provider.districtListPage === 2 ? 2 : 1;
  const rows = page === 1
    ? [
        ...DISTRICTS.slice(0, 7),
        {
          id: BUTTON_IDS.DISTRICT_PAGE_NEXT,
          title: 'അടുത്ത list',
          description: 'ജില്ല ഇവിടെ ഇല്ലെങ്കിൽ തുറക്കുക'
        }
      ]
    : [
        ...DISTRICTS.slice(7, 14),
        {
          id: BUTTON_IDS.DISTRICT_PAGE_PREVIOUS,
          title: 'ആദ്യ list',
          description: 'മുൻപത്തെ ജില്ലകൾ കാണുക'
        }
      ];

  await sendAndLog(phone, 'list', {
    body: page === 1 ? MESSAGES.districtQuestion : MESSAGES.districtListQuestion,
    buttonText: 'ജില്ല തിരഞ്ഞെടുക്കുക',
    sections: [
      {
        title: 'District options',
        rows
      }
    ]
  });
}

async function sendQualificationHelpButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.qualificationGoBack,
    buttons: [{ id: BUTTON_IDS.QUALIFICATION_GO_BACK, title: 'തിരികെ പോകുക' }]
  });
}

async function sendInterestButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.interestQuestion,
    buttons: [
      { id: BUTTON_IDS.INTEREST_YES, title: 'താൽപര്യമുണ്ട്' },
      { id: BUTTON_IDS.INTEREST_NO, title: 'താൽപര്യമില്ല' }
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
      { id: BUTTON_IDS.DUTY_HOUR_BOTH, title: 'രണ്ടും' }
    ]
  });
  await sendAndLog(phone, 'text', '8 hour (8 am to 6 pm) - 900rs per day\n24 hour - 1200 rs per day');
}

async function sendSampleDutyOfferPrompt(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.sampleDutyOfferQuestion,
    buttons: [
      { id: BUTTON_IDS.SAMPLE_DUTY_YES, title: 'കാണാം' },
      { id: BUTTON_IDS.SAMPLE_DUTY_NO, title: 'വേണ്ട' }
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
      { id: BUTTON_IDS.SAMPLE_DUTY_YES, title: 'കാണാം' },
      { id: BUTTON_IDS.SAMPLE_DUTY_NO, title: 'വേണ്ട' }
    ]
  });
}

async function sendFinalDutyChoiceButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.sampleDutyFinalChoiceQuestion,
    buttons: [
      { id: BUTTON_IDS.DUTY_HOUR_8, title: '8 hour' },
      { id: BUTTON_IDS.DUTY_HOUR_24, title: '24 hour' },
      { id: BUTTON_IDS.DUTY_HOUR_BOTH, title: 'രണ്ടും' }
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
      { id: BUTTON_IDS.EXPECTED_DUTIES_YES, title: 'തയ്യാറാണ്' },
      { id: BUTTON_IDS.EXPECTED_DUTIES_NO, title: 'താൽപര്യമില്ല' }
    ]
  });
}

async function sendAgeCorrectionButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.ageAboveLimitOptions,
    buttons: [
      { id: BUTTON_IDS.AGE_RETRY_ENTRY, title: 'വയസ് വീണ്ടും നൽകാം' },
      { id: BUTTON_IDS.AGE_CONFIRM_EXIT, title: 'ശരി' }
    ]
  });
}

async function sendAgeFinalRejectionButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.ageFinalRejectionOptions,
    buttons: [
      { id: BUTTON_IDS.AGE_EDIT_AFTER_REJECTION, title: 'വയസ് തിരുത്താം' },
      { id: BUTTON_IDS.AGE_CLOSE_AFTER_REJECTION, title: 'ശരി' }
    ]
  });
}

async function sendTermsButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.termsQuestion,
    buttons: [
      { id: BUTTON_IDS.TERMS_ACCEPT, title: 'സ്വീകരിക്കുന്നു' },
      { id: BUTTON_IDS.TERMS_DECLINE, title: 'സ്വീകരിക്കുന്നില്ല' }
    ]
  });
}

async function sendOptionalAgentHelpButton(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.optionalAgentHelp,
    buttons: [{ id: BUTTON_IDS.CONNECT_PULSO_AGENT, title: 'കൂടുതൽ സഹായം' }]
  });
}

async function startFlow(phone) {
  await getOrCreateProvider(phone);
  await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2);
  await sendQualificationList(phone);
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
  const listAction = parseDistrictListAction(message);
  if (listAction === 'next') {
    await updateProvider(phone, { districtListPage: 2 });
    await sendDistrictList(phone);
    return;
  }
  if (listAction === 'previous') {
    await updateProvider(phone, { districtListPage: 1 });
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
  const action = parseTermsAcceptance(message);
  if (action === 'connect_agent') {
    await handleAgentHelpRequest(phone);
    return;
  }

  if (action === 'accept') {
    await updateStatus(phone, STATUS.COMPLETED, 15, {
      termsAccepted: true,
      agentHelpRequested: false,
      agentHelpRequestedAt: null,
      completedAt: new Date().toISOString()
    });
    await appendHistory(phone, { type: 'system', event: 'onboarding_completed' });
    await sendAndLog(phone, 'text', MESSAGES.termsAccepted);
    await sendAndLog(phone, 'text', MESSAGES.postOnboardingSupport);
    await sendAndLog(phone, 'text', MESSAGES.postOnboardingContactSupport);
    await sendAndLog(phone, 'text', MESSAGES.postOnboardingLinks);
    await sendOptionalAgentHelpButton(phone);
    const provider = await getProvider(phone);
    await notifyOnboardingCompleted(provider);
    return;
  }

  if (action === 'decline') {
    await updateProvider(phone, {
      status: STATUS.NOT_INTERESTED_RESTARTABLE,
      currentStep: 14,
      termsAccepted: false
    });
    await sendAndLog(phone, 'text', MESSAGES.termsDeclined);
    return;
  }

  await sendTermsButtons(phone);
}

async function handleCompleted(phone, message) {
  const provider = await getProvider(phone);
  const action = parseTermsAcceptance(message);
  if (action === 'connect_agent') {
    await handleAgentHelpRequest(phone);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.completed);
  if (canRequestAgentHelp(provider)) {
    await sendOptionalAgentHelpButton(phone);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.agentHelpAlreadyRequested);
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

  if (provider.status === STATUS.NEW) {
    await startFlow(phone);
    return;
  }

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
}

async function approveCertificate(phone, reviewedBy, notes) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  await updateProvider(phone, {
    status: STATUS.AWAITING_TERMS_ACCEPTANCE,
    currentStep: 11,
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
}

async function rejectCertificate(phone, reviewedBy, notes, options = {}) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

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
}

module.exports = {
  processIncomingMessage,
  approveCertificate,
  rejectCertificate,
  requestAdditionalDocument,
  startFlow,
  adminUploadCertificateFiles
};
