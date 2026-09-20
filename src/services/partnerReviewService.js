/* Partner document review for the Booking Inbox.
   The work happens in the pulso-hub project, which owns the enquiry, the
   document in Storage and the WhatsApp number. This app reaches it over the
   same shared secret the provider sync already uses, so there is one
   implementation of approve/ask-again rather than a second copy here. */
const axios = require('axios');
const config = require('../config');

const SYNC_FUNCTION = 'syncprovideronboardingfrombot';
// The cloudfunctions.net path is case-sensitive, so the replacement has to
// carry the function's real name; the match below stays case-insensitive.
const REVIEW_FUNCTION = 'partnerReviewFromBot';

/** Both functions live in one project and share the Cloud Run hash, so the
    review URL follows from the configured sync URL. */
function reviewUrl() {
  const explicit = String(config.pulsoHubPartnerReviewUrl || '').trim();
  if (explicit) return explicit;
  const sync = String(config.pulsoHubBotSyncUrl || '').trim();
  if (!sync || !sync.toLowerCase().includes(SYNC_FUNCTION)) return '';
  return sync.replace(new RegExp(SYNC_FUNCTION, 'i'), REVIEW_FUNCTION);
}

async function callPartnerReview(action, payload = {}) {
  const url = reviewUrl();
  const secret = String(config.pulsoHubBotSyncSecret || '').trim();
  if (!url || !secret) {
    const error = new Error('Partner review is not configured on this server');
    error.statusCode = 503;
    throw error;
  }

  try {
    const response = await axios.post(
      url,
      { action, ...payload },
      { headers: { 'content-type': 'application/json', 'x-pulso-bot-secret': secret }, timeout: 20000 },
    );
    return response.data;
  } catch (err) {
    const status = err.response?.status || 502;
    const message = err.response?.data?.error || err.message || 'Partner review failed';
    const error = new Error(String(message).slice(0, 300));
    error.statusCode = status === 401 ? 502 : status;
    throw error;
  }
}

module.exports = {
  reviewUrl,
  getPartnerDocumentUrl: (phone) => callPartnerReview('document', { phone }),
  approvePartnerEnquiry: (phone, actorLabel) => callPartnerReview('approve', { phone, actorLabel }),
  askPartnerAgain: (phone, reason, actorLabel) => callPartnerReview('askAgain', { phone, reason, actorLabel }),
};
