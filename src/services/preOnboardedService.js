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

function isPreOnboardedPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? preOnboardedSet.has(normalized) : false;
}

module.exports = {
  normalizePhone,
  isPreOnboardedPhone
};
