const config = require('../config');
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
  parseReviewerAction,
  notifyCertificateUploaded,
  notifyCertificateReviewed,
  notifyOnboardingCompleted,
  promptRejectNoteEntry,
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

function buildAgentHelpMessage() {
  const supportNumber = String(config.agentHelpWhatsappNumber || '').replace(/\D/g, '');
  const helpLink = supportNumber ? `https://wa.me/${supportNumber}` : '';

  return [
    'ശരി. കൂടുതൽ സഹായത്തിനായി Pulso support agent-നെ നേരിട്ട് WhatsApp-ൽ ബന്ധപ്പെടാം.',
    supportNumber ? `Support number: +${supportNumber}` : null,
    helpLink ? `WhatsApp link: ${helpLink}` : null
  ].filter(Boolean).join('\n');
}

async function handleAgentHelpRequest(phone) {
  await updateProvider(phone, {
    agentHelpRequested: true,
    status: STATUS.AWAITING_PULSO_AGENT
  });

  await appendHistory(phone, { type: 'system', event: 'agent_help_requested' });
  const provider = await getProvider(phone);
  await sendAndLog(phone, 'text', buildAgentHelpMessage());
  await notifyAgentHelpRequested(provider);
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
      { id: BUTTON_IDS.DUTY_HOUR_24, title: '24 hour' }
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
  return value === '24_hour' ? '8_hour' : '24_hour';
}

function getSampleDutyMessage(value) {
  return value === '24_hour' ? MESSAGES.sampleDutyOffer24Hour : MESSAGES.sampleDutyOffer8Hour;
}

function getOtherSampleQuestion(value) {
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
      { id: BUTTON_IDS.DUTY_HOUR_24, title: '24 hour' }
    ]
  });
}

async function notify8HourNoStayOrFood(phone, dutyHourPreference) {
  if (dutyHourPreference !== '8_hour') {
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
      stage: 'initial_prompt',
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
        reviewedBy: null
      }
    });
    const refreshedProvider = await getProvider(phone);
    const attachments = refreshedProvider && refreshedProvider.documents
      ? refreshedProvider.documents.certificateAttachments || []
      : [];
    await notifyCertificateUploaded(refreshedProvider, attachments);
    await appendHistory(phone, { type: 'system', event: 'verification_queue_created' });
    await sendAndLog(phone, 'text', MESSAGES.verificationPending);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_NAME, 9);
  await sendAndLog(phone, 'text', MESSAGES.nameQuestion);
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
      reviewedBy: null
    }
  });
  const updatedProvider = await getProvider(phone);
  const attachments = updatedProvider && updatedProvider.documents ? updatedProvider.documents.certificateAttachments || [] : [];
  await notifyCertificateUploaded(updatedProvider, attachments);
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
      agentHelpRequested: false
    });
    await sendAndLog(phone, 'text', MESSAGES.termsAccepted);
    await sendAndLog(phone, 'text', MESSAGES.postOnboardingSupport);
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
  const action = parseTermsAcceptance(message);
  if (action === 'connect_agent') {
    await handleAgentHelpRequest(phone);
    return;
  }

  await sendAndLog(phone, 'text', MESSAGES.completed);
  await sendOptionalAgentHelpButton(phone);
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
        candidate.verification.reviewerWorkflow.stage === 'awaiting_note'
    );

    if (!pendingProvider) {
      await sendText(phone, 'No rejection note is pending right now.');
      return;
    }

    const note = (reviewAction.note || '').trim();
    if (!note) {
      await sendText(phone, 'Please send a non-empty note.');
      return;
    }

    await updateProvider(
      pendingProvider.phone,
      buildReviewerWorkflowPatch(pendingProvider.verification.reviewerWorkflow, {
        note,
        stage: 'awaiting_reject_confirmation'
      })
    );
    const refreshedProvider = await getProvider(pendingProvider.phone);
    await requestRejectNoteOrConfirmation(
      refreshedProvider,
      refreshedProvider.verification.reviewerWorkflow.reasonLabel,
      note
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
    await requestReviewConfirmation(provider, reviewAction.action);
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
    await requestRejectReason(refreshedProvider);
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
    await requestRejectNoteOrConfirmation(refreshedProvider, rejectReason.label, '');
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
    await promptRejectNoteEntry(provider, workflow.reasonLabel);
    return;
  }

  if (reviewAction.action === 'confirm_reject') {
    const workflow = provider.verification && provider.verification.reviewerWorkflow;
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

    await clearReviewerWorkflow(providerPhone);
    await rejectCertificate(providerPhone, phone, finalNote, { requestReupload, rejectMessageKey });
    await sendText(phone, `Rejected certificate for ${providerPhone}.`);
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
    case STATUS.AWAITING_SEX:
      await handleSex(phone, message);
      return;
    case STATUS.AWAITING_DISTRICT:
      await handleDistrict(phone, message);
      return;
    case STATUS.VERIFICATION_PENDING:
      await sendAndLog(phone, 'text', MESSAGES.verificationStillPending);
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

  await updateProvider(phone, {
    status: STATUS.AWAITING_CERTIFICATE,
    currentStep: 5,
    verification: {
      status: 'rejected',
      notes: notes || '',
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy || config.adminDefaultReviewer
    },
    documents: {
      ...provider.documents,
      certificateReceived: false,
      certificateAttachments: []
    }
  });
  await appendHistory(phone, { type: 'system', event: 'certificate_rejected' });
  const rejectMessage =
    options.rejectMessageKey && MESSAGES[options.rejectMessageKey]
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
  startFlow
};
