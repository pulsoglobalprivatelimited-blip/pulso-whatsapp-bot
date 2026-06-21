const {
  getProvider,
  listProviders,
  listProviderSummaries,
  listProviderTermsReminderCandidates,
  listPendingVerificationNotificationProviders,
  listReviewerWorkflowProviders,
  saveProvider
} = require('./storage');
const { STATUS } = require('../flow');
const { applyRegionDefaults, inferProviderRegion, statusRequiresRegion } = require('./regionService');

function now() {
  return new Date().toISOString();
}

async function createProvider(phone) {
  const provider = {
    phone,
    source: 'meta_ads_whatsapp',
    region: null,
    language: null,
    flowId: null,
    flowAssignedAt: null,
    flowAssignmentSource: null,
    status: STATUS.NEW,
    currentStep: 1,
    qualification: null,
    interestConfirmed: false,
    dutyHourPreference: null,
    expectedDutiesAccepted: null,
    agentHelpRequested: false,
    agentHelpRequestedAt: null,
    fullName: null,
    age: null,
    sex: null,
    district: null,
    districtListPage: 1,
    termsAccepted: false,
    completedAt: null,
    pulsoAppRequired: false,
    pulsoAppDevice: null,
    pulsoAppLinkSentAt: null,
    pulsoAppInstalledConfirmedAt: null,
    pulsoAppActivationStatus: null,
    pulsoAppActivationVerifiedAt: null,
    pulsoAppActivationVerifiedBy: null,
    pulsoAppHelpReason: null,
    pulsoAppHelpRequestedAt: null,
    documents: {
      cvReceived: false,
      certificateReceived: false,
      cvAttachments: [],
      certificateAttachments: [],
      additionalDocumentAttachments: [],
      additionalDocumentRequest: null
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
  const next = applyRegionDefaults({
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
  });

  if (Object.prototype.hasOwnProperty.call(patch, 'status') && statusRequiresRegion(next.status) && !inferProviderRegion(next)) {
    throw new Error('Provider region is required before continuing onboarding');
  }

  return saveProvider(phone, next);
}

function inboundPreview(payload) {
  if (!payload) return 'Message received';
  if (payload.text && payload.text.body) return payload.text.body;
  if (payload.button && payload.button.text) return payload.button.text;
  if (payload.interactive && payload.interactive.button_reply) {
    return payload.interactive.button_reply.title || 'Button reply';
  }
  if (payload.interactive && payload.interactive.list_reply) {
    return payload.interactive.list_reply.title || 'List reply';
  }
  if (payload.document) return payload.document.filename || 'Document uploaded';
  if (payload.image) return payload.image.caption || 'Image uploaded';
  return 'Message received';
}

function outboundPreview(entry) {
  const payload = entry.payload || {};
  let body = 'Message sent';
  if (payload.kind === 'text') {
    body = payload.body || body;
  } else if (payload.body && payload.body.body) {
    body = payload.body.body;
  } else if (payload.kind) {
    body = payload.kind;
  }
  const sender = entry.sender && entry.sender !== 'bot' ? entry.sender : 'Bot';
  return `${sender}: ${body}`;
}

// Short single-line summary of a history entry, denormalized onto the provider
// doc so the Inbox chat list can show a WhatsApp-style preview without reading
// each provider's full history.
function summarizeHistoryEntry(entry) {
  if (!entry) return { direction: 'system', preview: '' };
  let direction = 'system';
  let preview = '';
  if (entry.type === 'inbound_message') {
    direction = 'in';
    preview = inboundPreview(entry.payload);
  } else if (entry.type === 'outbound_message') {
    direction = 'out';
    preview = outboundPreview(entry);
  } else {
    preview = String(entry.event || 'system update').replace(/_/g, ' ');
  }
  return { direction, preview: preview.slice(0, 120) };
}

async function appendHistory(phone, event) {
  const provider = await getOrCreateProvider(phone);
  const at = now();
  provider.history.push({ at, ...event });
  const summary = summarizeHistoryEntry(event);
  provider.lastMessageAt = at;
  provider.lastMessageDirection = summary.direction;
  provider.lastMessagePreview = summary.preview;
  provider.updatedAt = at;
  return saveProvider(phone, provider);
}

module.exports = {
  createProvider,
  getOrCreateProvider,
  updateProvider,
  appendHistory,
  listProviders,
  listProviderSummaries,
  listProviderTermsReminderCandidates,
  listPendingVerificationNotificationProviders,
  listReviewerWorkflowProviders,
  getProvider
};
