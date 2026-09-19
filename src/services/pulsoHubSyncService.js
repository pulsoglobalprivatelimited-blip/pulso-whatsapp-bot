const axios = require('axios');
const config = require('../config');
const { FLOWS } = require('../flow');
const { inferProviderRegion } = require('./regionService');

function buildProviderSyncPayload(provider) {
  const flow = provider && provider.flowId ? FLOWS[provider.flowId] : null;

  return {
    phone: provider.phone || '',
    region: inferProviderRegion(provider) || '',
    language: provider.language || (flow && flow.language) || '',
    flowId: provider.flowId || '',
    qualification: provider.qualification || '',
    fullName: provider.fullName || '',
    age: provider.age ?? null,
    sex: provider.sex || '',
    district: provider.district || '',
    dutyHourPreference: provider.dutyHourPreference || '',
    status: provider.status || '',
    termsAccepted: provider.termsAccepted === true,
    completedAt: provider.completedAt || null,
    verification: provider.verification || {},
    // Set when the person is onboarding through the Pulso app: the hub pushes
    // the reviewer's decision to this user, and activates them on Accept.
    appUid: provider.appUid || '',
    // Raised when WhatsApp could not put the review alert in front of anybody.
    // The hub turns this into an ops alert, so a caregiver never waits on a
    // review nobody knows to do.
    certificateReviewAlertFailed: isCertificateReviewAlertFailed(provider),
    certificateReviewAlert: buildCertificateReviewAlertSummary(provider),
  };
}

function getReviewAlertState(provider) {
  return provider && provider.verification && provider.verification.reviewAlert
    ? provider.verification.reviewAlert
    : null;
}

function isCertificateReviewAlertFailed(provider) {
  const state = getReviewAlertState(provider);
  return Boolean(state && state.failed === true && state.delivered !== true);
}

function buildCertificateReviewAlertSummary(provider) {
  const state = getReviewAlertState(provider);
  if (!state) {
    return null;
  }

  const failedMessage = (state.messages || []).find(
    (message) => message && message.status === 'failed' && message.error
  );
  // With two template versions live, "which one failed" is the first question
  // anyone asks of a failed alert.
  const templateName =
    (failedMessage && failedMessage.templateName) ||
    (state.messages || []).map((message) => message && message.templateName).find(Boolean) ||
    null;

  return {
    delivered: state.delivered === true,
    failed: state.failed === true,
    retryCount: state.retryCount || 0,
    lastSentAt: state.lastSentAt || null,
    templateName,
    recipients: Array.from(
      new Set((state.messages || []).map((message) => message && message.to).filter(Boolean))
    ),
    errorCode: failedMessage && failedMessage.error ? failedMessage.error.code || null : null,
    errorDetail: failedMessage && failedMessage.error ? failedMessage.error.detail || null : null,
  };
}

// The same endpoint the finished-onboarding sync uses. Sending the whole
// provider keeps the hub's mirror in one shape, so the alert arrives with the
// caregiver's name and number already on it.
async function reportCertificateReviewAlertFailure(provider) {
  if (!provider || !provider.phone) {
    return { ok: false, skipped: true, reason: 'missing_provider' };
  }

  try {
    const result = await syncProviderToPulsoHub(provider);
    console.log(
      '[OPS_REVIEW_ALERT_ESCALATED]',
      JSON.stringify(
        {
          providerPhone: provider.phone,
          skipped: result.skipped === true,
          reason: result.reason || null,
        },
        null,
        2
      )
    );
    return result;
  } catch (error) {
    console.error(
      '[OPS_REVIEW_ALERT_ESCALATION_ERROR]',
      JSON.stringify(
        {
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null,
        },
        null,
        2
      )
    );
    return { ok: false, skipped: false, error: error.message };
  }
}

async function syncProviderToPulsoHub(provider) {
  const url = String(config.pulsoHubBotSyncUrl || '').trim();
  const secret = String(config.pulsoHubBotSyncSecret || '').trim();

  if (!url || !secret) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_sync_configuration',
    };
  }

  const payload = buildProviderSyncPayload(provider);
  const response = await axios.post(url, payload, {
    headers: {
      'content-type': 'application/json',
      'x-pulso-bot-secret': secret,
    },
    timeout: 15000,
  });

  return {
    ok: true,
    skipped: false,
    payload,
    data: response.data,
  };
}

module.exports = {
  buildProviderSyncPayload,
  isCertificateReviewAlertFailed,
  reportCertificateReviewAlertFailure,
  syncProviderToPulsoHub,
};
