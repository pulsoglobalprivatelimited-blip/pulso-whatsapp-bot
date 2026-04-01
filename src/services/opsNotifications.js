const config = require('../config');
const {
  sendText,
  sendButtons,
  sendImageById,
  sendDocumentById
} = require('./metaClient');

const REVIEW_ACTIONS = {
  APPROVE: 'review_approve_',
  REJECT: 'review_reject_',
  CONFIRM_APPROVE: 'review_confirm_approve_',
  CONFIRM_REJECT: 'review_confirm_reject_',
  CANCEL: 'review_cancel_'
};

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isReviewerPhone(phone) {
  return normalizePhone(phone) === normalizePhone(config.ownerNotificationPhone);
}

function joinLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function formatStatus(value) {
  return String(value || '').replace(/_/g, ' ');
}

function formatProviderSummary(provider) {
  return [
    provider && provider.fullName ? `Name: ${provider.fullName}` : null,
    provider && provider.phone ? `Phone: ${provider.phone}` : null,
    provider && provider.qualification ? `Qualification: ${provider.qualification.toUpperCase()}` : null,
    provider && provider.district ? `District: ${provider.district}` : null,
    provider && provider.status ? `Status: ${formatStatus(provider.status)}` : null
  ];
}

function buildReviewButtons(providerPhone) {
  return [
    { id: `${REVIEW_ACTIONS.APPROVE}${providerPhone}`, title: 'Approve' },
    { id: `${REVIEW_ACTIONS.REJECT}${providerPhone}`, title: 'Reject' }
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

async function sendOpsNotification(body) {
  const to = normalizePhone(config.ownerNotificationPhone);
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

async function sendReviewMedia(provider, attachment) {
  const to = normalizePhone(config.ownerNotificationPhone);
  if (!to || !attachment || !attachment.id) {
    return null;
  }

  const caption = joinLines([
    'Provider certificate for review',
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

async function notifyCertificateUploaded(provider, attachment) {
  const to = normalizePhone(config.ownerNotificationPhone);
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

  return sendReviewMedia(provider, attachment);
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

async function requestReviewConfirmation(provider, action) {
  const to = normalizePhone(config.ownerNotificationPhone);
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

function parseReviewerAction(message) {
  const replyId =
    message &&
    message.interactive &&
    message.interactive.button_reply &&
    message.interactive.button_reply.id;

  if (replyId && replyId.startsWith(REVIEW_ACTIONS.APPROVE)) {
    return {
      action: 'approve',
      phone: replyId.slice(REVIEW_ACTIONS.APPROVE.length)
    };
  }

  if (replyId && replyId.startsWith(REVIEW_ACTIONS.REJECT)) {
    return {
      action: 'reject',
      phone: replyId.slice(REVIEW_ACTIONS.REJECT.length)
    };
  }

  if (replyId && replyId.startsWith(REVIEW_ACTIONS.CONFIRM_APPROVE)) {
    return {
      action: 'confirm_approve',
      phone: replyId.slice(REVIEW_ACTIONS.CONFIRM_APPROVE.length)
    };
  }

  if (replyId && replyId.startsWith(REVIEW_ACTIONS.CONFIRM_REJECT)) {
    return {
      action: 'confirm_reject',
      phone: replyId.slice(REVIEW_ACTIONS.CONFIRM_REJECT.length)
    };
  }

  if (replyId && replyId.startsWith(REVIEW_ACTIONS.CANCEL)) {
    return {
      action: 'cancel',
      phone: replyId.slice(REVIEW_ACTIONS.CANCEL.length)
    };
  }

  const text = String(
    (message && message.text && message.text.body) ||
      (message && message.button && message.button.text) ||
      ''
  ).trim();

  const match = text.match(/^(approve|reject)\s+(\+?\d+)/i);
  if (!match) {
    return null;
  }

  return {
    action: match[1].toLowerCase(),
    phone: normalizePhone(match[2])
  };
}

module.exports = {
  isReviewerPhone,
  notifyCertificateUploaded,
  notifyCertificateReviewed,
  parseReviewerAction,
  requestReviewConfirmation
};
