const config = require('../config');
const {
  getProvider,
  listPendingVerificationNotificationProviders,
  saveProvider
} = require('./storage');
const { notifyCertificateUploaded } = require('./opsNotifications');
const {
  buildVerificationNotificationPatch,
  escalateReviewAlertFailure,
  recordReviewAlertSend
} = require('./reviewAlertEscalation');

// A caregiver told "sent for verification" whose alert never reached a reviewer
// used to sit there until somebody happened to open the dashboard. This sweep
// looks for exactly that — pending review, nothing delivered — and sends the
// alert again. It gives up after three tries and leaves the ops alert standing,
// because past that point the problem is not one that retrying fixes.
const MAX_REVIEW_ALERT_RETRIES = 3;

function getMaxPerSweep() {
  return Math.max(1, config.certificateReviewCatchUpMaxPerSweep);
}

function lastAttemptMs(provider) {
  const reviewAlert = getReviewAlert(provider);
  return (
    parseTimestamp(reviewAlert && reviewAlert.lastSentAt) ||
    parseTimestamp(provider.verification && provider.verification.notificationSentAt) ||
    parseTimestamp(provider.updatedAt) ||
    0
  );
}

let catchUpInterval = null;

function getStaleAfterMs() {
  return Math.max(1, config.certificateReviewCatchUpStaleMinutes) * 60 * 1000;
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReviewAlert(provider) {
  return provider && provider.verification ? provider.verification.reviewAlert || null : null;
}

function isAwaitingReview(provider) {
  return Boolean(
    provider &&
      provider.phone &&
      provider.status === 'certificate_verification_pending' &&
      !provider.termsAccepted &&
      !provider.completedAt &&
      provider.verification &&
      provider.verification.status === 'pending'
  );
}

function needsCatchUp(provider, now = Date.now()) {
  if (!isAwaitingReview(provider)) {
    return false;
  }

  const reviewAlert = getReviewAlert(provider);
  if (reviewAlert && reviewAlert.delivered === true) {
    return false;
  }

  if (reviewAlert && (reviewAlert.retryCount || 0) >= MAX_REVIEW_ALERT_RETRIES) {
    return false;
  }

  // A delivery receipt that has not arrived is not the same as an alert that
  // never went out. WhatsApp can take longer than the stale window to confirm,
  // and resending on that silence sent reviewers a second copy of a message
  // they already had. Only a send that actually failed is worth retrying:
  // nothing to act on, or every actionable message rejected.
  if (reviewAlert && !reviewAlert.failed && !reviewAlert.undeliverable) {
    return false;
  }

  // An alert sent a minute ago may simply not have been delivered yet; only a
  // silence longer than the window counts as stuck. Records from before this
  // tracking existed have no reviewAlert at all, so fall back to the last time
  // anything touched them.
  const lastAttemptAt =
    parseTimestamp(reviewAlert && reviewAlert.lastSentAt) ||
    parseTimestamp(provider.verification && provider.verification.notificationSentAt) ||
    parseTimestamp(provider.updatedAt);

  if (lastAttemptAt === null) {
    return true;
  }

  return now - lastAttemptAt >= getStaleAfterMs();
}

async function retryReviewAlert(provider) {
  const attachments =
    provider && provider.documents ? provider.documents.certificateAttachments || [] : [];
  const previous = getReviewAlert(provider);

  const notificationResult = await notifyCertificateUploaded(provider, attachments);
  const notificationPatch = buildVerificationNotificationPatch(notificationResult, {
    ...(previous || {}),
    retryCount: (previous && previous.retryCount ? previous.retryCount : 0) + 1
  });

  if (!notificationPatch) {
    // Nothing went out at all. Count the try so this cannot loop forever, and
    // make sure ops have been told.
    const retryCount = (previous && previous.retryCount ? previous.retryCount : 0) + 1;
    await saveProvider(provider.phone, {
      verification: {
        reviewAlert: {
          ...(previous || {}),
          retryCount,
          failed: true,
          delivered: false,
          lastSentAt: new Date().toISOString()
        }
      }
    });
    await escalateReviewAlertFailure(provider.phone);
    return { phone: provider.phone, sent: false, retryCount };
  }

  await saveProvider(provider.phone, { verification: notificationPatch });
  await recordReviewAlertSend(provider.phone, notificationPatch);

  return {
    phone: provider.phone,
    sent: true,
    retryCount: notificationPatch.reviewAlert ? notificationPatch.reviewAlert.retryCount : null
  };
}

async function runCertificateReviewCatchUpSweep({ dryRun = false } = {}) {
  const providers = await listPendingVerificationNotificationProviders();
  const now = Date.now();
  // Longest wait first, and only a few each time. The first sweep after this
  // shipped found eight caregivers who had been waiting up to a week; sending
  // all of their alerts in one burst would bury the reviewer and raise eight ops
  // alerts at once. A handful every half hour clears the same backlog.
  const waiting = providers
    .filter((provider) => needsCatchUp(provider, now))
    .sort((a, b) => lastAttemptMs(a) - lastAttemptMs(b));
  const candidates = waiting.slice(0, getMaxPerSweep());

  if (!candidates.length) {
    console.log('[REVIEW_CATCH_UP] Nothing waiting on an undelivered reviewer alert');
    return { checked: providers.length, retried: 0, results: [] };
  }

  console.log(
    '[REVIEW_CATCH_UP]',
    JSON.stringify({
      checked: providers.length,
      waiting: waiting.length,
      candidates: candidates.map((p) => p.phone),
      dryRun
    })
  );

  if (dryRun) {
    return { checked: providers.length, retried: 0, results: candidates.map((p) => ({ phone: p.phone, sent: false, dryRun: true })) };
  }

  const results = [];
  for (const candidate of candidates) {
    try {
      // The list query returns a projection; the resend needs the whole record.
      const provider = (await getProvider(candidate.phone)) || candidate;
      results.push(await retryReviewAlert(provider));
    } catch (error) {
      console.error(
        '[REVIEW_CATCH_UP_ERROR]',
        JSON.stringify({ phone: candidate.phone, message: error.message })
      );
      results.push({ phone: candidate.phone, sent: false, error: error.message });
    }
  }

  return { checked: providers.length, retried: results.filter((r) => r.sent).length, results };
}

function startCertificateReviewCatchUpScheduler() {
  if (catchUpInterval) {
    return catchUpInterval;
  }

  const intervalMs = Math.max(1, config.certificateReviewCatchUpIntervalMinutes) * 60 * 1000;
  catchUpInterval = setInterval(() => {
    runCertificateReviewCatchUpSweep().catch((error) => {
      console.error('[REVIEW_CATCH_UP_SCHEDULER_ERROR]', error);
    });
  }, intervalMs);

  return catchUpInterval;
}

module.exports = {
  MAX_REVIEW_ALERT_RETRIES,
  lastAttemptMs,
  needsCatchUp,
  runCertificateReviewCatchUpSweep,
  startCertificateReviewCatchUpScheduler
};
