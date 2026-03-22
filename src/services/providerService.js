const { getProvider, listProviders, saveProvider } = require('./storage');
const { STATUS } = require('../flow');

function now() {
  return new Date().toISOString();
}

async function createProvider(phone) {
  const provider = {
    phone,
    source: 'meta_ads_whatsapp',
    status: STATUS.NEW,
    currentStep: 1,
    qualification: null,
    interestConfirmed: false,
    dutyPreference: null,
    documents: {
      cvReceived: false,
      certificateReceived: false,
      cvAttachments: [],
      certificateAttachments: []
    },
    verification: {
      status: 'not_started',
      notes: '',
      reviewedAt: null,
      reviewedBy: null
    },
    history: [],
    createdAt: now(),
    updatedAt: now()
  };

  provider.history.push({ at: now(), type: 'system', event: 'provider_created' });
  return saveProvider(phone, provider);
}

async function getOrCreateProvider(phone) {
  return (await getProvider(phone)) || createProvider(phone);
}

async function updateProvider(phone, patch) {
  const provider = await getOrCreateProvider(phone);
  const next = {
    ...provider,
    ...patch,
    documents: {
      ...provider.documents,
      ...(patch.documents || {})
    },
    verification: {
      ...provider.verification,
      ...(patch.verification || {})
    },
    updatedAt: now()
  };

  return saveProvider(phone, next);
}

async function appendHistory(phone, event) {
  const provider = await getOrCreateProvider(phone);
  provider.history.push({ at: now(), ...event });
  provider.updatedAt = now();
  return saveProvider(phone, provider);
}

module.exports = {
  createProvider,
  getOrCreateProvider,
  updateProvider,
  appendHistory,
  listProviders,
  getProvider
};
