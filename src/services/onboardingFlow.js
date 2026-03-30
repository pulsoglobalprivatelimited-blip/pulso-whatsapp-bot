const config = require('../config');
const { MESSAGES, STATUS, BUTTON_IDS, QUALIFICATIONS } = require('../flow');
const { sendText, sendButtons, sendList } = require('./metaClient');
const {
  getOrCreateProvider,
  updateProvider,
  appendHistory,
  getProvider
} = require('./providerService');
const {
  getMessageText,
  parseQualification,
  isQualificationDeclined,
  isInterested,
  isNotInterested,
  parseAge,
  parseSex,
  parseDistrict,
  parseTermsAcceptance,
  classifyDocument
} = require('./messageParser');
const { archiveIncomingMedia } = require('./mediaStorage');

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

async function sendTermsButtons(phone) {
  await sendAndLog(phone, 'buttons', {
    body: MESSAGES.termsQuestion,
    buttons: [
      { id: BUTTON_IDS.TERMS_ACCEPT, title: 'സ്വീകരിക്കുന്നു' },
      { id: BUTTON_IDS.TERMS_HELP, title: 'സഹായം വേണം' }
    ]
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
      status: STATUS.NEEDS_HUMAN_REVIEW,
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

  await updateStatus(phone, STATUS.AWAITING_CERTIFICATE, 5, { interestConfirmed: true });
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

async function handleCertificate(phone, message) {
  const kind = classifyDocument(message);
  if (kind !== 'certificate') {
    const provider = (await getProvider(phone)) || (await getOrCreateProvider(phone));
    await sendIfChanged(phone, provider, 'text', MESSAGES.certificateRetry);
    return;
  }

  await addCertificate(phone, message);
  await updateStatus(phone, STATUS.AWAITING_NAME, 6);
  await sendAndLog(phone, 'text', MESSAGES.nameQuestion);
}

async function handleName(phone, message) {
  const name = getMessageText(message).trim();
  if (!name) {
    await sendAndLog(phone, 'text', MESSAGES.nameQuestion);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_AGE, 7, { fullName: name });
  await sendAndLog(phone, 'text', MESSAGES.ageQuestion);
}

async function handleAge(phone, message) {
  const age = parseAge(message);
  if (!age) {
    await sendAndLog(phone, 'text', MESSAGES.ageRetry);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_SEX, 8, { age });
  await sendSexButtons(phone);
}

async function handleSex(phone, message) {
  const sex = parseSex(message);
  if (!sex) {
    await sendAndLog(phone, 'text', MESSAGES.sexRetry);
    await sendSexButtons(phone);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_DISTRICT, 9, { sex });
  await sendAndLog(phone, 'text', MESSAGES.districtQuestion);
}

async function handleDistrict(phone, message) {
  const district = parseDistrict(message);
  if (!district) {
    await sendAndLog(phone, 'text', MESSAGES.districtRetry);
    return;
  }

  await updateStatus(phone, STATUS.VERIFICATION_PENDING, 10, {
    district,
    verification: {
      status: 'pending',
      notes: '',
      reviewedAt: null,
      reviewedBy: null
    }
  });
  await appendHistory(phone, { type: 'system', event: 'verification_queue_created' });
  await sendAndLog(phone, 'text', MESSAGES.verificationPending);
}

async function handleTerms(phone, message) {
  const action = parseTermsAcceptance(message);
  if (action === 'accept') {
    await updateStatus(phone, STATUS.COMPLETED, 12, { termsAccepted: true });
    await sendAndLog(phone, 'text', MESSAGES.termsAccepted);
    return;
  }

  if (action === 'help') {
    await sendAndLog(phone, 'text', MESSAGES.termsHelp);
    return;
  }

  await sendTermsButtons(phone);
}

async function processIncomingMessage(phone, message) {
  const provider = await getOrCreateProvider(phone);

  if (hasProcessedMessage(provider, message.id)) {
    return;
  }

  await recordInbound(phone, message);

  if (provider.status === STATUS.NEW) {
    await startFlow(phone);
    return;
  }

  switch (provider.status) {
    case STATUS.AWAITING_QUALIFICATION:
      await handleQualification(phone, message);
      return;
    case STATUS.AWAITING_INTEREST:
      await handleInterest(phone, message);
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
      await sendAndLog(phone, 'text', MESSAGES.completed);
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
  return getProvider(phone);
}

async function rejectCertificate(phone, reviewedBy, notes) {
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
  await sendAndLog(phone, 'text', MESSAGES.certificateRejected, reviewedBy || config.adminDefaultReviewer);
  return getProvider(phone);
}

module.exports = {
  processIncomingMessage,
  approveCertificate,
  rejectCertificate,
  startFlow
};
