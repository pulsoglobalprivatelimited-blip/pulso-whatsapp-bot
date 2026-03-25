const config = require('../config');
const { MESSAGES, STATUS } = require('../flow');
const { sendText, sendAudio, sendTermsAndConditions } = require('./metaClient');
const {
  getOrCreateProvider,
  updateProvider,
  appendHistory,
  getProvider
} = require('./providerService');
const {
  normalizeText,
  parseQualification,
  isQualificationDeclined,
  isInterested,
  parseDutyPreference,
  classifyDocument
} = require('./messageParser');
const { archiveIncomingMedia } = require('./mediaStorage');

async function sendAndLog(phone, kind, body, sender) {
  try {
    if (kind === 'audio') {
      await sendAudio(phone, body);
    } else if (kind === 'terms') {
      await sendTermsAndConditions(phone, body);
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

async function startFlow(phone) {
  await getOrCreateProvider(phone);
  await updateStatus(phone, STATUS.AWAITING_QUALIFICATION, 2);
  await sendAndLog(phone, 'text', MESSAGES.qualificationQuestion);
}

function recordInbound(phone, message) {
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

function lastOutboundBody(provider) {
  if (!provider || !Array.isArray(provider.history)) {
    return null;
  }

  for (let index = provider.history.length - 1; index >= 0; index -= 1) {
    const event = provider.history[index];
    if (event.type === 'outbound_message' && event.payload && event.payload.kind === 'text') {
      return event.payload.body;
    }
  }

  return null;
}

async function sendTextIfChanged(phone, provider, body) {
  if (lastOutboundBody(provider) === body) {
    return;
  }

  await sendAndLog(phone, 'text', body);
}

async function handleQualification(phone, text) {
  const qualification = parseQualification(text);
  if (isQualificationDeclined(text)) {
    await updateProvider(phone, {
      status: STATUS.NEEDS_HUMAN_REVIEW,
      currentStep: 3,
      qualification: null
    });
    await sendAndLog(phone, 'text', MESSAGES.notEligible);
    return;
  }

  if (!qualification) {
    await sendAndLog(phone, 'text', MESSAGES.qualificationRetry);
    return;
  }

  await updateStatus(phone, STATUS.VOICE_NOTE_SENT, 4, { qualification });
  await sendAndLog(phone, 'audio', config.voiceNoteMediaId);
  await sendAndLog(phone, 'text', MESSAGES.voiceNoteIntro);
  await updateStatus(phone, STATUS.AWAITING_INTEREST, 5);
}

async function handleInterest(phone, text) {
  if (!isInterested(text)) {
    await sendAndLog(phone, 'text', MESSAGES.interestedPrompt);
    return;
  }

  await updateStatus(phone, STATUS.AWAITING_DOCUMENTS, 6, { interestConfirmed: true });
  await sendAndLog(phone, 'text', MESSAGES.documentsRequest);
}

async function addAttachment(targetList, phone, message, category) {
  const attachment = await archiveIncomingMedia(phone, message, category);
  targetList.push({
    ...attachment,
    receivedAt: new Date().toISOString()
  });
}

async function handleDocuments(phone, message) {
  const provider = (await getProvider(phone)) || (await getOrCreateProvider(phone));
  let kind = classifyDocument(message);

  if (kind === 'certificate' && message.type === 'image') {
    if (provider.documents.certificateReceived && !provider.documents.cvReceived) {
      kind = 'cv';
    } else if (provider.documents.cvReceived && !provider.documents.certificateReceived) {
      kind = 'certificate';
    }
  }

  if (!kind) {
    await sendTextIfChanged(
      phone,
      provider,
      'Please send your CV and certificate as an image or document so we can continue.'
    );
    return;
  }

  const nextDocuments = {
    ...provider.documents,
    cvAttachments: [...provider.documents.cvAttachments],
    certificateAttachments: [...provider.documents.certificateAttachments]
  };

  if (kind === 'cv') {
    nextDocuments.cvReceived = true;
    await addAttachment(nextDocuments.cvAttachments, phone, message, 'cv');
  } else if (kind === 'certificate' || kind === 'unknown') {
    nextDocuments.certificateReceived = true;
    await addAttachment(nextDocuments.certificateAttachments, phone, message, 'certificate');
  }

  const hasRequiredDocuments = nextDocuments.cvReceived && nextDocuments.certificateReceived;

  await updateProvider(phone, {
    documents: nextDocuments,
    status: hasRequiredDocuments ? STATUS.VERIFICATION_PENDING : STATUS.AWAITING_DOCUMENTS,
    currentStep: hasRequiredDocuments ? 9 : 6,
    verification: hasRequiredDocuments
      ? { status: 'pending', notes: '', reviewedAt: null, reviewedBy: null }
      : provider.verification
  });

  if (!hasRequiredDocuments) {
    const missing = [];
    if (!nextDocuments.cvReceived) missing.push('CV');
    if (!nextDocuments.certificateReceived) missing.push('certificate');
    await sendTextIfChanged(
      phone,
      provider,
      `We have received part of your documents. Please send your ${missing.join(' and ')} to continue.`
    );
    return;
  }

  await updateProvider(phone, { currentStep: 8 });
  await appendHistory(phone, { type: 'system', event: 'verification_queue_created' });
  await updateProvider(phone, { currentStep: 9 });
  await sendAndLog(phone, 'text', MESSAGES.documentsAck);
}

async function handleDutyPreference(phone, text) {
  const dutyPreference = parseDutyPreference(text);
  if (!dutyPreference) {
    await sendAndLog(phone, 'text', MESSAGES.dutyRetry);
    return;
  }

  await updateStatus(phone, STATUS.COMPLETED, 12, { dutyPreference });
  await sendAndLog(phone, 'text', MESSAGES.completion);
  await sendAndLog(phone, 'terms', config.termsAndConditionsUrl);
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

  const text = normalizeText(message.text && message.text.body);

  switch (provider.status) {
    case STATUS.AWAITING_QUALIFICATION:
      await handleQualification(phone, text);
      return;
    case STATUS.VOICE_NOTE_SENT:
    case STATUS.AWAITING_INTEREST:
      await handleInterest(phone, text);
      return;
    case STATUS.AWAITING_DOCUMENTS:
      await handleDocuments(phone, message);
      return;
    case STATUS.VERIFICATION_PENDING:
      await sendAndLog(phone, 'text', 'Your documents are under review. We will update you once certificate verification is complete.');
      return;
    case STATUS.CERTIFICATE_REJECTED:
      await handleDocuments(phone, message);
      return;
    case STATUS.AWAITING_DUTY_PREFERENCE:
      await handleDutyPreference(phone, text);
      return;
    case STATUS.COMPLETED:
      await sendAndLog(phone, 'text', 'Your onboarding flow is already completed. Our team will contact you if anything else is required.');
      return;
    default:
      await sendAndLog(phone, 'text', 'A team member will assist you shortly.');
  }
}

async function approveCertificate(phone, reviewedBy, notes) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  await updateProvider(phone, {
    status: STATUS.AWAITING_DUTY_PREFERENCE,
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
  return getProvider(phone);
}

async function rejectCertificate(phone, reviewedBy, notes) {
  const provider = await getProvider(phone);
  if (!provider) {
    throw new Error('Provider not found');
  }

  await updateProvider(phone, {
    status: STATUS.CERTIFICATE_REJECTED,
    currentStep: 10,
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
