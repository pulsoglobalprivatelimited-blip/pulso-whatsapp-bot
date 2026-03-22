const { QUALIFICATIONS } = require('../flow');

function normalizeText(value) {
  return (value || '').trim().toLowerCase();
}

function parseQualification(text) {
  const normalized = normalizeText(text);
  return QUALIFICATIONS.find((item) => normalized.includes(item)) || null;
}

function isQualificationDeclined(text) {
  const normalized = normalizeText(text);
  return ['no', 'not', 'none', 'other', 'na'].includes(normalized);
}

function isInterested(text) {
  const normalized = normalizeText(text);
  return ['interested', 'yes interested', 'yes', 'ok', 'okay', 'haan', 'i am interested'].includes(normalized);
}

function parseDutyPreference(text) {
  const normalized = normalizeText(text).replace(/hours?/g, 'hour').replace(/hr/g, 'hour');
  if (normalized.includes('24')) {
    return '24 hour';
  }
  if (normalized.includes('8')) {
    return '8 hour';
  }
  return null;
}

function classifyDocument(message) {
  const type = message.type;
  if (!type || !['document', 'image'].includes(type)) {
    return null;
  }

  const fileName = normalizeText(message.document && message.document.filename);
  if (fileName.includes('cv') || fileName.includes('resume')) {
    return 'cv';
  }
  if (fileName.includes('cert')) {
    return 'certificate';
  }

  if (type === 'image') {
    return 'certificate';
  }

  return 'unknown';
}

module.exports = {
  normalizeText,
  parseQualification,
  isQualificationDeclined,
  isInterested,
  parseDutyPreference,
  classifyDocument
};
