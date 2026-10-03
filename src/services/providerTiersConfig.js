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

// Repriced by the founder on 29 Sep 2026 (Basic 600/500, GDA 700/600, Nurse
// 1400/1200 per 24h/8h). These are only the fallback for an unreadable
// app_config/provider_tiers; every message reads the live doc first.
const DEFAULTS = {
  basic: { payout24h: 600, payout8h: 500 },
  gda: { payout24h: 700, payout8h: 600 },
  nurse: { payout24h: 1400, payout8h: 1200 }
};
const TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;

function posInt(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Above this age Pulso offers the Basic rate whatever the certificate says.
// In the same document as the rates because it is the same kind of decision and
// gets changed the same way — by the founder, without a deploy.
const BASIC_TIER_AGE_THRESHOLD = 45;

function normalize(doc) {
  const tiers = doc && doc.tiers && typeof doc.tiers === 'object' ? doc.tiers : {};
  const out = { basicTierAgeThreshold: posInt(doc && doc.basicTierAgeThreshold, BASIC_TIER_AGE_THRESHOLD) };
  for (const t of Object.keys(DEFAULTS)) {
    const s = tiers[t] && typeof tiers[t] === 'object' ? tiers[t] : {};
    out[t] = {
      payout24h: posInt(s.payout24h, DEFAULTS[t].payout24h),
      payout8h: posInt(s.payout8h, DEFAULTS[t].payout8h)
    };
    // What the bot tells a band, when it differs from the payout floor
    // (flow.js tierFigures). Carried only when set.
    for (const k of ['shown8h', 'shown24h', 'shownFrom8h', 'shownTo8h', 'shownFrom24h', 'shownTo24h', 'sample8h', 'sample24h']) {
      const n = posInt(s[k], 0);
      if (n > 0) out[t][k] = n;
    }
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
  // `no_certificate` is what she picked; `basic_caregiver` is what the reviewer
  // approved. Both are the Basic tier — nothing else is, so `other_caregiving`
  // stays GDA on purpose.
  if (q === 'basic_caregiver' || q === 'no_certificate' || q === 'nursing_student') return 'basic';
  return 'gda';
}

module.exports = { getProviderTiers, tierForQualification, normalize, DEFAULTS, BASIC_TIER_AGE_THRESHOLD, _resetCache: () => { cached = null; cachedAt = 0; } };
