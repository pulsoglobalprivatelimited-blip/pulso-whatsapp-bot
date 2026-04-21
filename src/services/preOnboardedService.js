const preOnboardedNumbers = require('../data/preOnboardedNumbers.json');

function normalizePhone(phone) {
  if (!phone) {
    return null;
  }

  let normalized = String(phone).replace(/\D/g, '');
  if (!normalized) {
    return null;
  }

  if (normalized.length === 10) {
    normalized = `91${normalized}`;
  } else if (normalized.length === 11 && normalized.startsWith('0')) {
    normalized = `91${normalized.slice(1)}`;
  }

  return normalized;
}

const preOnboardedSet = new Set(
  preOnboardedNumbers
    .map(normalizePhone)
    .filter(Boolean)
);

// Numbers in this set should always be allowed to enter the bot flow,
// even if they appear in the pre-onboarded suppression list.
const replyEligibleSet = new Set(
  ['9207887114']
    .map(normalizePhone)
    .filter(Boolean)
);

function isPreOnboardedPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return false;
  }

  if (replyEligibleSet.has(normalized)) {
    return false;
  }

  return preOnboardedSet.has(normalized);
}

module.exports = {
  normalizePhone,
  isPreOnboardedPhone
};
