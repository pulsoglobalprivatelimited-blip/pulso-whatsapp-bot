const config = require('../config');
const {
  sendText,
  sendButtons,
  sendList,
  sendImageById,
  sendDocumentById
} = require('./metaClient');

const REVIEW_ACTIONS = {
  APPROVE: 'review_approve_',
  REJECT: 'review_reject_',
  REQUEST_ADDITIONAL_DOCUMENT: 'review_request_additional_document_',
  REASON_REUPLOAD: 'review_reason_reupload_',
  REASON_CV_INSTEAD_OF_CERTIFICATE: 'review_reason_cv_instead_',
  REASON_WRONG_IMAGE: 'review_reason_wrong_image_',
  REASON_AGE_LIMIT_EXCEEDED: 'review_reason_age_limit_',
  REASON_OTHER: 'review_reason_other_',
  ADD_NOTE: 'review_add_note_',
  CONFIRM_REQUEST_ADDITIONAL_DOCUMENT: 'review_confirm_request_additional_document_',
  CONFIRM_REJECT: 'review_confirm_reject_',
  CONFIRM_APPROVE: 'review_confirm_approve_',
  CANCEL: 'review_cancel_'
};

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function getOpsNotificationPhone() {
  return normalizePhone(config.agentHelpWhatsappNumber) || normalizePhone(config.ownerNotificationPhone);
}

function getCertificateReviewPhone() {
  return normalizePhone(config.ownerNotificationPhone) || getOpsNotificationPhone();
}

function getReviewerPhones() {
  return [
    normalizePhone(config.agentHelpWhatsappNumber),
    normalizePhone(config.ownerNotificationPhone),
    normalizePhone('917736129809')
  ].filter(Boolean);
}

function isReviewerPhone(phone) {
  return getReviewerPhones().includes(normalizePhone(phone));
}

function joinLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function formatStatus(value) {
  return String(value || '').replace(/_/g, ' ');
}

function formatDutyHourPreference(value) {
  if (value === '8_hour') return '8 hour';
  if (value === '24_hour') return '24 hour';
  if (value === 'both') return 'Both';
  return value || '-';
}

function formatProviderSummary(provider) {
  return [
    `Name: ${(provider && provider.fullName) || '-'}`,
    `Phone: ${(provider && provider.phone) || '-'}`,
    `Age: ${(provider && provider.age) || '-'}`,
    `Sex: ${(provider && provider.sex) || '-'}`,
    `Preferred duty hour: ${formatDutyHourPreference(provider && provider.dutyHourPreference)}`,
    `Qualification: ${provider && provider.qualification ? provider.qualification.toUpperCase() : '-'}`,
    `District: ${(provider && provider.district) || '-'}`,
    `Status: ${provider && provider.status ? formatStatus(provider.status) : '-'}`
  ];
}

function buildProviderChatLink(phone) {
  const normalizedPhone = normalizePhone(phone);
  return normalizedPhone ? `https://wa.me/${normalizedPhone}` : null;
}

function buildProviderIntroMessage(provider, senderName = 'Abdul') {
  const name = provider && provider.fullName ? provider.fullName : null;
  return [
    `നമസ്കാരം${name ? ` ${name}` : ''},`,
    `ഞാൻ ${senderName}, Pulso support team-ിൽ നിന്നാണ് message ചെയ്യുന്നത്.`,
    'താങ്കൾ കൂടുതൽ സഹായം ആവശ്യപ്പെട്ടതായി കണ്ടു.',
    'എങ്ങനെ സഹായിക്കാം?'
  ].join(' ');
}

function buildProviderPrefilledChatLink(provider, senderName = 'Abdul') {
  const chatLink = buildProviderChatLink(provider && provider.phone);
  if (!chatLink) {
    return null;
  }

  return `${chatLink}?text=${encodeURIComponent(buildProviderIntroMessage(provider, senderName))}`;
}

function buildReviewButtons(providerPhone) {
  return [
    { id: `${REVIEW_ACTIONS.APPROVE}${providerPhone}`, title: 'Approve' },
    { id: `${REVIEW_ACTIONS.REJECT}${providerPhone}`, title: 'Reject' },
    { id: `${REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT}${providerPhone}`, title: 'Request doc' }
  ];
}

function buildConfirmationButtons(providerPhone, action) {
  if (action === 'approve') {
    return [
      { id: `${REVIEW_ACTIONS.CONFIRM_APPROVE}${providerPhone}`, title: 'Confirm approve' },
      { id: `${REVIEW_ACTIONS.CANCEL}${providerPhone}`, title: 'Cancel' }
    ];
  }

  return [
    { id: `${REVIEW_ACTIONS.CONFIRM_REJECT}${providerPhone}`, title: 'Confirm reject' },
    { id: `${REVIEW_ACTIONS.CANCEL}${providerPhone}`, title: 'Cancel' }
  ];
}

function buildRejectReasonButtons(providerPhone) {
  return [
    { id: `${REVIEW_ACTIONS.REASON_REUPLOAD}${providerPhone}`, title: 'Request reupload' },
    { id: `${REVIEW_ACTIONS.REASON_CV_INSTEAD_OF_CERTIFICATE}${providerPhone}`, title: 'CV instead' },
    { id: `${REVIEW_ACTIONS.REASON_WRONG_IMAGE}${providerPhone}`, title: 'Wrong image' },
    { id: `${REVIEW_ACTIONS.REASON_AGE_LIMIT_EXCEEDED}${providerPhone}`, title: 'Age limit exceeded' },
    { id: `${REVIEW_ACTIONS.REASON_OTHER}${providerPhone}`, title: 'Other reason' }
  ];
}

function buildRejectReasonRows(providerPhone) {
  return buildRejectReasonButtons(providerPhone).map((button) => ({
    id: button.id,
    title: button.title
  }));
}

function buildRejectFollowupButtons(providerPhone) {
  return [
    { id: `${REVIEW_ACTIONS.ADD_NOTE}${providerPhone}`, title: 'Add note' },
    { id: `${REVIEW_ACTIONS.CONFIRM_REJECT}${providerPhone}`, title: 'Reject now' },
    { id: `${REVIEW_ACTIONS.CANCEL}${providerPhone}`, title: 'Cancel' }
  ];
}

async function sendOpsNotification(body) {
  const to = getCertificateReviewPhone();
  if (!to) {
    return null;
  }

  try {
    return await sendText(to, body);
  } catch (error) {
    console.error(
      '[OPS_NOTIFICATION_ERROR]',
      JSON.stringify(
        {
          to,
          body,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function sendNotificationTo(phone, body, logLabel) {
  const to = normalizePhone(phone);
  if (!to) {
    return null;
  }

  try {
    const result = await sendText(to, body);
    console.log(
      '[OPS_NOTIFICATION_SENT]',
      JSON.stringify(
        {
          to,
          logLabel,
          preview: body.slice(0, 140)
        },
        null,
        2
      )
    );
    return result;
  } catch (error) {
    console.error(
      `[${logLabel}]`,
      JSON.stringify(
        {
          to,
          body,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

function getReviewerDestination(reviewerPhone) {
  return normalizePhone(reviewerPhone) || getCertificateReviewPhone();
}

async function sendReviewMedia(provider, attachment, index, total) {
  const to = getCertificateReviewPhone();
  if (!to || !attachment || !attachment.id) {
    return null;
  }

  const caption = joinLines([
    total > 1 ? `Provider certificate for review (${index}/${total})` : 'Provider certificate for review',
    provider && provider.phone ? `Phone: ${provider.phone}` : null
  ]);

  try {
    if (attachment.type === 'image') {
      return await sendImageById(to, attachment.id, caption);
    }

    return await sendDocumentById(to, attachment.id, attachment.fileName || undefined, caption);
  } catch (error) {
    console.error(
      '[OPS_REVIEW_MEDIA_ERROR]',
      JSON.stringify(
        {
          to,
          attachmentId: attachment.id,
          attachmentType: attachment.type,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function sendAdditionalDocumentMedia(provider, attachment) {
  const to = getCertificateReviewPhone();
  if (!to || !attachment || !attachment.id) {
    return null;
  }

  const caption = joinLines([
    'Requested additional document uploaded',
    provider && provider.phone ? `Phone: ${provider.phone}` : null,
    attachment.fileName ? `File: ${attachment.fileName}` : null
  ]);

  try {
    if (attachment.type === 'image') {
      return await sendImageById(to, attachment.id, caption);
    }

    return await sendDocumentById(to, attachment.id, attachment.fileName || undefined, caption);
  } catch (error) {
    console.error(
      '[OPS_ADDITIONAL_DOC_MEDIA_ERROR]',
      JSON.stringify(
        {
          to,
          attachmentId: attachment.id,
          attachmentType: attachment.type,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function notifyCertificateUploaded(provider, attachments) {
  const to = getCertificateReviewPhone();
  if (!to) {
    return null;
  }

  const body = joinLines([
    'New certificate uploaded for review.',
    ...formatProviderSummary(provider),
    'Tap below to approve or reject.'
  ]);

  try {
    await sendButtons(to, body, buildReviewButtons(provider.phone));
  } catch (error) {
    console.error(
      '[OPS_REVIEW_BUTTON_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider && provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
  }

  const files = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
  for (let index = 0; index < files.length; index += 1) {
    await sendReviewMedia(provider, files[index], index + 1, files.length);
  }

  return null;
}

async function notifyCertificateReviewed(provider, decision, reviewedBy, notes) {
  const body = joinLines([
    `Pulso alert: certificate ${decision}`,
    ...formatProviderSummary(provider),
    reviewedBy ? `Reviewer: ${reviewedBy}` : null,
    notes ? `Notes: ${notes}` : null
  ]);

  return sendOpsNotification(body);
}

async function notifyAdditionalDocumentRequested(provider, requestedBy, note) {
  const body = joinLines([
    'Pulso alert: additional document requested',
    ...formatProviderSummary(provider),
    requestedBy ? `Requested by: ${requestedBy}` : null,
    note ? `Note: ${note}` : null
  ]);

  return sendOpsNotification(body);
}

async function notifyAdditionalDocumentUploaded(provider, attachment, request) {
  const to = getCertificateReviewPhone();
  const body = joinLines([
    'Pulso alert: requested additional document uploaded',
    ...formatProviderSummary(provider),
    request && request.note ? `Requested note: ${request.note}` : null,
    attachment && attachment.fileName ? `File: ${attachment.fileName}` : null,
    'Tap below to approve, reject, or request another document.'
  ]);

  if (to && provider && provider.phone) {
    try {
      await sendButtons(to, body, buildReviewButtons(provider.phone));
    } catch (error) {
      console.error(
        '[OPS_ADDITIONAL_DOC_BUTTON_ERROR]',
        JSON.stringify(
          {
            to,
            providerPhone: provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
      await sendOpsNotification(body);
    }
  } else {
    await sendOpsNotification(body);
  }

  await sendAdditionalDocumentMedia(provider, attachment);
  return null;
}

async function notifyOnboardingCompleted(provider) {
  const body = joinLines([
    'Pulso alert: onboarding completed',
    ...formatProviderSummary(provider)
  ]);

  const recipients = [
    getCertificateReviewPhone(),
    normalizePhone('917736129809')
  ].filter(Boolean)
    .filter((phone, index, list) => list.indexOf(phone) === index);

  for (const recipient of recipients) {
    await sendNotificationTo(recipient, body, 'OPS_ONBOARDING_COMPLETED_ERROR');
  }

  return null;
}

async function notifyAgentHelpRequested(provider) {
  const helpNumber = normalizePhone(config.agentHelpWhatsappNumber);
  const backupHelpNumber = normalizePhone('917736129809');
  const recipients = [
    { phone: helpNumber, senderName: 'Abdul' },
    { phone: backupHelpNumber, senderName: 'Ashmila' }
  ]
    .filter((entry) => entry.phone)
    .filter((entry, index, list) => list.findIndex((item) => item.phone === entry.phone) === index);
  if (!recipients.length) {
    return null;
  }

  console.log(
    '[AGENT_HELP_REQUESTED]',
    JSON.stringify(
      {
        providerPhone: provider && provider.phone ? provider.phone : null,
        recipients: recipients.map((entry) => entry.phone)
      },
      null,
      2
    )
  );

  for (const recipient of recipients) {
    const body = joinLines([
      'Pulso alert: provider requested additional help',
      ...formatProviderSummary(provider),
      provider && provider.updatedAt ? `Requested at: ${provider.updatedAt}` : null,
      buildProviderChatLink(provider && provider.phone) ? `Open chat: ${buildProviderChatLink(provider.phone)}` : null,
      buildProviderPrefilledChatLink(provider, recipient.senderName)
        ? `Open chat with intro: ${buildProviderPrefilledChatLink(provider, recipient.senderName)}`
        : null,
      `Intro message: ${buildProviderIntroMessage(provider, recipient.senderName)}`
    ]);
    await sendNotificationTo(recipient.phone, body, 'AGENT_HELP_NOTIFICATION_ERROR');
  }

  return null;
}

async function requestReviewConfirmation(provider, action, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const actionLabel = action === 'approve' ? 'approve' : 'reject';
  const body = joinLines([
    `Please confirm: ${actionLabel} certificate?`,
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendButtons(to, body, buildConfirmationButtons(provider.phone, action));
  } catch (error) {
    console.error(
      '[OPS_REVIEW_CONFIRMATION_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          action,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function requestRejectReason(provider, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    'Choose the reject reason.',
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendList(to, body, 'Choose reason', [
      {
        title: 'Reject reason',
        rows: buildRejectReasonRows(provider.phone)
      }
    ]);
  } catch (error) {
    console.error(
      '[OPS_REJECT_REASON_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function requestRejectNoteOrConfirmation(provider, reasonLabel, note, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    `Reject reason: ${reasonLabel}`,
    note ? `Current note: ${note}` : 'You can add a note or reject now.',
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendButtons(to, body, buildRejectFollowupButtons(provider.phone));
  } catch (error) {
    console.error(
      '[OPS_REJECT_NOTE_OR_CONFIRM_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function promptAdditionalDocumentNoteEntry(provider, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    'Send the note for the additional document request now.',
    'Example: Please upload Aadhaar front side.',
    'Your next WhatsApp text will be saved as the request note.'
  ]);

  return sendNotificationTo(to, body, 'OPS_ADDITIONAL_DOC_NOTE_PROMPT_ERROR');
}

async function requestAdditionalDocumentConfirmation(provider, note, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    'Please confirm: request additional document?',
    note ? `Note: ${note}` : null,
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendButtons(to, body, [
      { id: `${REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT}${provider.phone}`, title: 'Edit note' },
      { id: `${REVIEW_ACTIONS.CONFIRM_REQUEST_ADDITIONAL_DOCUMENT}${provider.phone}`, title: 'Send request' },
      { id: `${REVIEW_ACTIONS.CANCEL}${provider.phone}`, title: 'Cancel' }
    ]);
  } catch (error) {
    console.error(
      '[OPS_ADDITIONAL_DOC_CONFIRM_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function promptRejectNoteEntry(provider, reasonLabel, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to) {
    return null;
  }

  const body = joinLines([
    `Send the note for rejection now.`,
    `Reason: ${reasonLabel}`,
    'Your next WhatsApp text will be saved as the rejection note.'
  ]);

  return sendNotificationTo(to, body, 'OPS_REJECT_NOTE_PROMPT_ERROR');
}

function getRejectReasonDetails(action) {
  if (action === 'reason_reupload') {
    return {
      code: 'request_reupload',
      label: 'Request reupload',
      rejectMessageKey: 'certificateReuploadRequested'
    };
  }

  if (action === 'reason_cv_instead_of_certificate') {
    return {
      code: 'cv_instead_of_certificate',
      label: 'CV instead of certificate',
      rejectMessageKey: 'certificateCvUploaded'
    };
  }

  if (action === 'reason_wrong_image') {
    return {
      code: 'wrong_image_instead_of_certificate',
      label: 'Wrong image',
      rejectMessageKey: 'certificateWrongImageUploaded'
    };
  }

  if (action === 'reason_age_limit_exceeded') {
    return {
      code: 'age_limit_exceeded',
      label: 'Age limit exceeded',
      rejectMessageKey: 'ageFinalRejection'
    };
  }

  if (action === 'reason_other') {
    return {
      code: 'other_reason',
      label: 'Other reason',
      rejectMessageKey: 'certificateRejected'
    };
  }

  return null;
}

function parseReviewerAction(message) {
  const replyId =
    message &&
    message.interactive &&
    message.interactive.button_reply &&
    message.interactive.button_reply.id;
  const listReplyId =
    message &&
    message.interactive &&
    message.interactive.list_reply &&
    message.interactive.list_reply.id;
  const interactiveReplyId = replyId || listReplyId;

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.APPROVE)) {
    return {
      action: 'approve',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.APPROVE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REJECT)) {
    return {
      action: 'reject',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REJECT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT)) {
    return {
      action: 'request_additional_document',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_REUPLOAD)) {
    return {
      action: 'reason_reupload',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_REUPLOAD.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_CV_INSTEAD_OF_CERTIFICATE)) {
    return {
      action: 'reason_cv_instead_of_certificate',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_CV_INSTEAD_OF_CERTIFICATE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_WRONG_IMAGE)) {
    return {
      action: 'reason_wrong_image',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_WRONG_IMAGE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_AGE_LIMIT_EXCEEDED)) {
    return {
      action: 'reason_age_limit_exceeded',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_AGE_LIMIT_EXCEEDED.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_OTHER)) {
    return {
      action: 'reason_other',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_OTHER.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.ADD_NOTE)) {
    return {
      action: 'add_note',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.ADD_NOTE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CONFIRM_APPROVE)) {
    return {
      action: 'confirm_approve',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CONFIRM_APPROVE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CONFIRM_REQUEST_ADDITIONAL_DOCUMENT)) {
    return {
      action: 'confirm_request_additional_document',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CONFIRM_REQUEST_ADDITIONAL_DOCUMENT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CONFIRM_REJECT)) {
    return {
      action: 'confirm_reject',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CONFIRM_REJECT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CANCEL)) {
    return {
      action: 'cancel',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CANCEL.length)
    };
  }

  const text = String(
    (message && message.text && message.text.body) ||
      (message && message.button && message.button.text) ||
      ''
  ).trim();

  const match = text.match(/^(approve|reject)\s+(\+?\d+)/i);
  if (match) {
    return {
      action: match[1].toLowerCase(),
      phone: normalizePhone(match[2])
    };
  }

  return {
    action: 'note_text',
    note: text
  };
}

module.exports = {
  getRejectReasonDetails,
  isReviewerPhone,
  notifyAgentHelpRequested,
  notifyAdditionalDocumentRequested,
  notifyAdditionalDocumentUploaded,
  notifyCertificateUploaded,
  notifyCertificateReviewed,
  notifyOnboardingCompleted,
  parseReviewerAction,
  promptAdditionalDocumentNoteEntry,
  promptRejectNoteEntry,
  requestAdditionalDocumentConfirmation,
  requestRejectNoteOrConfirmation,
  requestRejectReason,
  requestReviewConfirmation
};
