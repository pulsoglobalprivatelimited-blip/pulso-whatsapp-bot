const { getProvider, saveProvider } = require('./storage');
const {
  applyReviewAlertStatus,
  buildReviewAlertState,
  trackReviewAlertMessages
} = require('./reviewAlertDelivery');
const { reportCertificateReviewAlertFailure } = require('./pulsoHubSyncService');

// One place that decides what happens when the reviewer's alert does not land.
// The bot cannot raise the notification in the Pulso app itself — recipients,
// preferences and the test sandbox all live in Pulso's functions — so it sends
// the caregiver over with the failure on the record and lets the hub alert ops.

function buildVerificationNotificationPatch(notificationResult, previousReviewAlert) {
  if (!notificationResult || !notificationResult.sent) {
    return null;
  }

  return {
    notificationSentAt: new Date().toISOString(),
    notificationRecipients: notificationResult.recipients || [],
    notificationAttempts: notificationResult.attempts || [],
    reviewAlert: buildReviewAlertState(notificationResult, previousReviewAlert || {})
  };
}

async function recordReviewAlertSend(providerPhone, notificationPatch) {
  const state = notificationPatch ? notificationPatch.reviewAlert : null;
  if (!state) {
    return;
  }

  await trackReviewAlertMessages(providerPhone, state);

  // Some failures are known the moment the send returns — no archived file to
  // put in the template, or Meta refusing it outright. There will be no status
  // webhook for those, so escalate now rather than wait for one.
  if (state.failed && !state.delivered) {
    await escalateReviewAlertFailure(providerPhone);
  }
}

async function escalateReviewAlertFailure(providerPhone) {
  const provider = await getProvider(providerPhone);
  if (!provider) {
    return null;
  }

  console.error(
    '[OPS_REVIEW_ALERT_UNDELIVERED]',
    JSON.stringify(
      {
        providerPhone,
        reviewAlert: provider.verification ? provider.verification.reviewAlert || null : null
      },
      null,
      2
    )
  );

  const result = await reportCertificateReviewAlertFailure(provider);

  // When ops were told, so the dashboard and a later sweep can both see that
  // this caregiver is already on somebody's list.
  if (result && result.ok) {
    await saveProvider(providerPhone, {
      verification: { reviewAlert: { alertedAt: new Date().toISOString() } }
    });
  }

  return result;
}

// Called for every WhatsApp status webhook. Almost all of them belong to
// ordinary caregiver messages and fall straight through.
async function handleReviewAlertStatus(status) {
  const outcome = await applyReviewAlertStatus(status);
  if (!outcome || !outcome.becameFailed) {
    return outcome;
  }

  await escalateReviewAlertFailure(outcome.providerPhone);
  return outcome;
}

module.exports = {
  buildVerificationNotificationPatch,
  escalateReviewAlertFailure,
  handleReviewAlertStatus,
  recordReviewAlertSend
};
