const axios = require('axios');
const config = require('../config');

function buildProviderSyncPayload(provider) {
  return {
    phone: provider.phone || '',
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
  };
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
  syncProviderToPulsoHub,
};
