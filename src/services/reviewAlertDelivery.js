const { getFirestore, getProvider, saveProvider } = require('./storage');

// WhatsApp accepts a message and only tells you later that it could not be
// delivered — a re-engagement refusal (131047) arrives as a status webhook
// seconds after the send returned a message id. The bot recorded those sends as
// `ok` and never read the webhook back, so a certificate alert that never
// reached anybody still looked sent on the dashboard, and the caregiver waited.
// This joins the two: every message id the alert produced is written down here,
// and each status that comes back updates the caregiver's record.

const MESSAGE_LOOKUP_COLLECTION = 'reviewAlertMessages';

// The messages that actually let a reviewer act: the new self-contained
// template, and the interactive buttons of the old path. The bare
// `review_template` is only a nudge — today's incident was it arriving alone —
// so its delivery does not count as the alert getting through.
const ACTIONABLE_ALERT_TYPES = ['review_template_v2', 'review_buttons'];
const TRACKED_ALERT_TYPES = [...ACTIONABLE_ALERT_TYPES, 'review_template', 'review_media'];

const DELIVERED_STATUSES = ['delivered', 'read'];

function lookupDocId(messageId) {
  return String(messageId || '').replace(/\//g, '_');
}

function collectAlertMessages(attempts) {
  const records = [];
  for (const attempt of Array.isArray(attempts) ? attempts : []) {
    if (!attempt || !TRACKED_ALERT_TYPES.includes(attempt.type)) {
      continue;
    }
    for (const message of Array.isArray(attempt.messages) ? attempt.messages : []) {
      if (!message || !message.id) continue;
      records.push({
        id: message.id,
        to: attempt.to || null,
        type: attempt.type,
        templateName: attempt.templateName || null,
        actionable: ACTIONABLE_ALERT_TYPES.includes(attempt.type),
        status: 'sent',
        error: null,
        at: attempt.at || new Date().toISOString()
      });
    }
  }
  return records;
}

// An attempt that threw on the way out never gets a status webhook, so its
// failure has to be read straight from the send result.
function hasSendFailure(attempts) {
  return (Array.isArray(attempts) ? attempts : []).some(
    (attempt) => attempt && ACTIONABLE_ALERT_TYPES.includes(attempt.type) && attempt.ok === false
  );
}

function summarizeReviewAlert(messages, previous = {}) {
  const actionable = messages.filter((message) => message.actionable);
  const delivered = actionable.some((message) => DELIVERED_STATUSES.includes(message.status));
  const failed =
    actionable.length > 0 && actionable.every((message) => message.status === 'failed');

  return {
    ...previous,
    messages,
    delivered,
    // When delivery landed, so the state can be read later. `delivered` alone
    // could not tell a receipt from two minutes ago from one from two days ago.
    deliveredAt: delivered ? previous.deliveredAt || new Date().toISOString() : previous.deliveredAt || null,
    failed,
    // Nothing to act on at all is a failure of the same kind: the reviewer was
    // never given a way in.
    undeliverable: actionable.length === 0
  };
}

function buildReviewAlertState(notificationResult, previous = {}) {
  const attempts = notificationResult ? notificationResult.attempts || [] : [];
  const messages = collectAlertMessages(attempts);
  const state = summarizeReviewAlert(messages, {
    retryCount: previous.retryCount || 0,
    alertedAt: previous.alertedAt || null,
    lastSentAt: new Date().toISOString()
  });

  if (!state.delivered && (state.undeliverable || hasSendFailure(attempts))) {
    state.failed = true;
  }

  return state;
}

async function trackReviewAlertMessages(providerPhone, reviewAlertState) {
  const messages = reviewAlertState ? reviewAlertState.messages || [] : [];
  if (!messages.length) {
    return 0;
  }

  const db = getFirestore();
  const batch = db.batch();
  for (const message of messages) {
    batch.set(
      db.collection(MESSAGE_LOOKUP_COLLECTION).doc(lookupDocId(message.id)),
      {
        messageId: message.id,
        providerPhone,
        to: message.to,
        type: message.type,
        actionable: message.actionable,
        sentAt: message.at
      },
      { merge: true }
    );
  }
  await batch.commit();
  return messages.length;
}

function describeStatusError(status) {
  const error = Array.isArray(status.errors) && status.errors.length ? status.errors[0] : null;
  if (!error) return null;
  return {
    code: error.code || null,
    title: error.title || null,
    detail: (error.error_data && error.error_data.details) || error.message || null
  };
}

// Returns the caregiver whose alert this status belongs to, and what the status
// did to it — or null when the message is not a reviewer alert at all, which is
// almost every status the webhook delivers.
async function applyReviewAlertStatus(status) {
  if (!status || !status.id || !status.status) {
    return null;
  }

  const db = getFirestore();
  const lookup = await db.collection(MESSAGE_LOOKUP_COLLECTION).doc(lookupDocId(status.id)).get();
  if (!lookup.exists) {
    return null;
  }

  const { providerPhone } = lookup.data() || {};
  if (!providerPhone) {
    return null;
  }

  const provider = await getProvider(providerPhone);
  const previous =
    provider && provider.verification && provider.verification.reviewAlert
      ? provider.verification.reviewAlert
      : null;
  if (!previous || !Array.isArray(previous.messages)) {
    return null;
  }

  const wasFailed = previous.failed === true;
  const messages = previous.messages.map((message) =>
    message.id === status.id
      ? { ...message, status: status.status, error: describeStatusError(status) || message.error || null }
      : message
  );

  const state = summarizeReviewAlert(messages, {
    retryCount: previous.retryCount || 0,
    alertedAt: previous.alertedAt || null,
    lastSentAt: previous.lastSentAt || null
  });

  await saveProvider(providerPhone, { verification: { reviewAlert: state } });

  return {
    providerPhone,
    provider,
    reviewAlert: state,
    becameFailed: state.failed && !wasFailed,
    becameDelivered: state.delivered && previous.delivered !== true
  };
}

module.exports = {
  summarizeReviewAlert,
  ACTIONABLE_ALERT_TYPES,
  applyReviewAlertStatus,
  buildReviewAlertState,
  collectAlertMessages,
  trackReviewAlertMessages
};
