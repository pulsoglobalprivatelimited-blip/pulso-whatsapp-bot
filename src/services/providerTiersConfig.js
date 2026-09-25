'use strict';

/**
 * The care-tier matrix, read from pulso-hub's app_config/provider_tiers.
 *
 * The same document the booking screens price from, so the rate a Basic
 * caregiver reads in their terms is the rate the agency's screen shows. Cached
 * for a minute; a missing or unreadable doc falls back to the figures that
 * shipped on 25 Sep 2026, so the terms can never quote ₹0.
 */
const { getHubFirestore } = require('./hubStorage');

const DEFAULTS = {
  basic: { payout24h: 750, payout8h: 600 },
  gda: { payout24h: 1200, payout8h: 900 },
  nurse: { payout24h: 1800, payout8h: 1500 }
};
const TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;

function posInt(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalize(doc) {
  const tiers = doc && doc.tiers && typeof doc.tiers === 'object' ? doc.tiers : {};
  const out = {};
  for (const t of Object.keys(DEFAULTS)) {
    const s = tiers[t] && typeof tiers[t] === 'object' ? tiers[t] : {};
    out[t] = {
      payout24h: posInt(s.payout24h, DEFAULTS[t].payout24h),
      payout8h: posInt(s.payout8h, DEFAULTS[t].payout8h)
    };
  }
  return out;
}

async function getProviderTiers() {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  let doc = null;
  try {
    const snap = await getHubFirestore().doc('app_config/provider_tiers').get();
    doc = snap.exists ? snap.data() : null;
  } catch (error) {
    console.error('[PROVIDER_TIERS_CONFIG_READ_FAILED]', error && error.message);
  }
  cached = normalize(doc);
  cachedAt = now;
  return cached;
}

/** The tier a reviewer-approved qualification lands in. */
function tierForQualification(qualification) {
  const q = String(qualification || '').trim().toLowerCase();
  if (['gnm', 'bsc_nursing', 'post_basic_bsc_nursing', 'msc_nursing'].includes(q)) return 'nurse';
  if (q === 'basic_caregiver') return 'basic';
  return 'gda';
}

module.exports = { getProviderTiers, tierForQualification, normalize, DEFAULTS, _resetCache: () => { cached = null; cachedAt = 0; } };
