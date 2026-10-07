/* "Active providers (online now)" on the desk (founder, 7 Oct 2026).
   The online switch (users.isAvailable) lives in the pulso-hub project. This
   asks its onlineProvidersFromBot function, over the shared secret the
   provider sync already uses, for the phones switched on right now. Cached a
   minute so a desk refresh does not wake the function every time. */
const axios = require('axios');
const config = require('../config');

const SYNC_FUNCTION = 'syncprovideronboardingfrombot';
const ONLINE_FUNCTION = 'onlineProvidersFromBot';
const CACHE_MS = 60 * 1000;
let cache = { at: 0, value: null };

/** Same project, same Cloud Run hash: the URL follows from the sync URL. */
function onlineUrl() {
  const explicit = String(config.pulsoHubOnlineProvidersUrl || '').trim();
  if (explicit) return explicit;
  const sync = String(config.pulsoHubBotSyncUrl || '').trim();
  if (!sync || !sync.toLowerCase().includes(SYNC_FUNCTION)) return '';
  return sync.replace(new RegExp(SYNC_FUNCTION, 'i'), ONLINE_FUNCTION);
}

async function getOnlineProviderPhones({ now = Date.now(), post = axios.post } = {}) {
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;
  const url = onlineUrl();
  const secret = String(config.pulsoHubBotSyncSecret || '').trim();
  if (!url || !secret) {
    const error = new Error('Online providers are not configured on this server');
    error.statusCode = 503;
    throw error;
  }
  const response = await post(url, {}, {
    headers: { 'content-type': 'application/json', 'x-pulso-bot-secret': secret },
    timeout: 20000
  });
  const data = response.data || {};
  const value = {
    at: Number(data.at) || now,
    phones: Array.isArray(data.phones) ? data.phones.map((p) => String(p)) : []
  };
  cache = { at: now, value };
  return value;
}

function resetOnlineProvidersCache() {
  cache = { at: 0, value: null };
}

module.exports = { getOnlineProviderPhones, onlineUrl, resetOnlineProvidersCache };
