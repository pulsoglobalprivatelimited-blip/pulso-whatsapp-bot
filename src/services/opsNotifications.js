const config = require('../config');
const { sendText } = require('./metaClient');

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function joinLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function formatProviderSummary(provider) {
  return [
    provider && provider.fullName ? `Name: ${provider.fullName}` : null,
    provider && provider.phone ? `Phone: ${provider.phone}` : null,
    provider && provider.qualification ? `Qualification: ${provider.qualification.toUpperCase()}` : null,
    provider && provider.district ? `District: ${provider.district}` : null,
    provider && provider.status ? `Status: ${provider.status.replace(/_/g, ' ')}` : null
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

async function notifyCertificateUploaded(provider) {
  const body = joinLines([
    'Pulso alert: certificate uploaded',
    ...formatProviderSummary(provider)
  ]);

  return sendOpsNotification(body);
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

module.exports = {
  notifyCertificateUploaded,
  notifyCertificateReviewed
};
