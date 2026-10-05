'use strict';
/* Pulso Hub client for the admin booking bot (docs/admin_booking_bot_plan.md).

   Every read and write the booking chat makes goes through one Pulso Hub
   function, `adminBookingFromBot`, which runs the app's own booking code as the
   admin whose phone is writing. Same shared secret and the same URL pattern as
   partnerReviewService: the function lives in the sync function's project, so
   its URL follows from PULSO_HUB_BOT_SYNC_URL.

   The endpoint answers { ok: true, ... } or { ok: false, error, message }.
   A business refusal (an overlapping booking, a blocked agency) comes back as
   HTTP 200 with ok:false and a message meant for the admin; this client returns
   it as it is. Only transport failures throw. */
const axios = require('axios');
const config = require('../config');

const SYNC_FUNCTION = 'syncprovideronboardingfrombot';
// cloudfunctions.net paths are case-sensitive: the replacement carries the
// function's real name; the match stays case-insensitive.
const BOOKING_FUNCTION = 'adminBookingFromBot';
const TIMEOUT_MS = 20000;

function adminBookingUrl() {
  const explicit = String(config.pulsoHubAdminBookingUrl || '').trim();
  if (explicit) return explicit;
  const sync = String(config.pulsoHubBotSyncUrl || '').trim();
  if (!sync || !sync.toLowerCase().includes(SYNC_FUNCTION)) return '';
  return sync.replace(new RegExp(SYNC_FUNCTION, 'i'), BOOKING_FUNCTION);
}

/** POST { adminPhone, action, data }. Resolves the endpoint's JSON, including
    ok:false refusals; rejects only when the call itself fails. */
async function callAdminBooking(adminPhone, action, data = {}, { post = axios.post } = {}) {
  const url = adminBookingUrl();
  const secret = String(config.pulsoHubBotSyncSecret || '').trim();
  if (!url || !secret) {
    const error = new Error('Admin booking is not configured on this server');
    error.statusCode = 503;
    throw error;
  }

  try {
    const response = await post(
      url,
      { adminPhone, action, data: data || {} },
      { headers: { 'content-type': 'application/json', 'x-pulso-bot-secret': secret }, timeout: TIMEOUT_MS }
    );
    const body = response && response.data;
    if (!body || typeof body !== 'object') {
      return { ok: false, error: 'bad_response', message: 'Pulso Hub sent an empty answer. Try again.' };
    }
    return body;
  } catch (err) {
    // A refusal sent with an error status still carries a message for the admin.
    const body = err.response && err.response.data;
    if (body && typeof body === 'object' && body.ok === false && body.message) return body;
    // A refusal without words (a care coordinator calling an admin action gets
    // HTTP 403 { ok:false, error:'not-allowed' }) is still a refusal, not a fault.
    const status = err.response && err.response.status;
    if (body && typeof body === 'object' && body.ok === false && body.error && status >= 400 && status < 500) {
      return { ...body, message: refusalMessage(body.error) };
    }
    const message = (body && (body.message || body.error)) || err.message || 'Admin booking failed';
    const error = new Error(String(message).slice(0, 300));
    error.statusCode = (err.response && err.response.status) || 502;
    throw error;
  }
}

function refusalMessage(code) {
  if (code === 'not-allowed') return 'Pulso Hub does not allow this number to do that.';
  return `Pulso Hub refused this (${String(code).slice(0, 60)}).`;
}

/** A client bound to one admin's phone, the shape adminBookingFlow expects. */
function createHubClient(options = {}) {
  return {
    call: (adminPhone, action, data) => callAdminBooking(adminPhone, action, data, options)
  };
}

module.exports = {
  adminBookingUrl,
  callAdminBooking,
  createHubClient,
  BOOKING_FUNCTION,
  TIMEOUT_MS
};
