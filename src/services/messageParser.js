const { BUTTON_IDS, DISTRICTS } = require('../flow');

function normalizeText(value) {
  return (value || '').trim().toLowerCase();
}

function getInteractiveReplyId(message) {
  if (!message || !message.interactive) {
    return null;
  }

  return (
    (message.interactive.button_reply && message.interactive.button_reply.id) ||
    (message.interactive.list_reply && message.interactive.list_reply.id) ||
    null
  );
}

function getMessageText(message) {
  if (!message) {
    return '';
  }

  if (message.text && message.text.body) {
    return message.text.body;
  }

  if (message.button && message.button.text) {
    return message.button.text;
  }

  if (message.interactive && message.interactive.button_reply && message.interactive.button_reply.title) {
    return message.interactive.button_reply.title;
  }

  if (message.interactive && message.interactive.list_reply && message.interactive.list_reply.title) {
    return message.interactive.list_reply.title;
  }

  return '';
}

function parseQualification(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.QUALIFICATION_GDA) return 'gda';
  if (replyId === BUTTON_IDS.QUALIFICATION_GNM) return 'gnm';
  if (replyId === BUTTON_IDS.QUALIFICATION_ANM) return 'anm';
  if (replyId === BUTTON_IDS.QUALIFICATION_OTHER_CAREGIVING) return 'other_caregiving';

  const normalized = normalizeText(getMessageText(message));
  if (normalized.includes('gda')) return 'gda';
  if (normalized.includes('gnm')) return 'gnm';
  if (normalized.includes('anm')) return 'anm';
  if (
    normalized.includes('caregiving') ||
    normalized.includes('care giving') ||
    normalized.includes('experience in caregiving')
  ) {
    return 'other_caregiving';
  }
  return null;
}

function isQualificationDeclined(message) {
  const normalized = normalizeText(getMessageText(message));
  return ['no', 'not', 'none', 'na'].includes(normalized);
}

function isInterested(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.INTEREST_YES) return true;
  if (replyId === BUTTON_IDS.INTEREST_NO) return false;

  const normalized = normalizeText(getMessageText(message));
  return ['താൽപര്യമുണ്ട്', 'interested', 'yes interested', 'yes', 'ok', 'okay', 'haan', 'i am interested'].includes(normalized);
}

function isNotInterested(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.INTEREST_NO) return true;

  const normalized = normalizeText(getMessageText(message));
  return ['താൽപര്യമില്ല', 'not interested', 'no'].includes(normalized);
}

function parseAge(message) {
  const normalized = normalizeText(getMessageText(message));
  const match = normalized.match(/\d{1,3}/);
  if (!match) return null;

  const age = Number(match[0]);
  if (age < 18 || age > 99) return null;
  return age;
}

function parseSex(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.SEX_MALE) return 'Male';
  if (replyId === BUTTON_IDS.SEX_FEMALE) return 'Female';

  const normalized = normalizeText(getMessageText(message));
  if (['male', 'man', 'm'].includes(normalized)) return 'Male';
  if (['female', 'woman', 'f'].includes(normalized)) return 'Female';
  return null;
}

function parseTermsAcceptance(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.TERMS_ACCEPT) return 'accept';
  if (replyId === BUTTON_IDS.TERMS_HELP) return 'help';

  const normalized = normalizeText(getMessageText(message));
  if (['സ്വീകരിക്കുന്നു', 'accept', 'accepted', 'ok', 'yes'].includes(normalized)) return 'accept';
  if (['സഹായം വേണം', 'help', 'need help'].includes(normalized)) return 'help';
  return null;
}

function parseDistrict(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId) {
    const districtById = DISTRICTS.find((district) => district.id === replyId);
    if (districtById) {
      return districtById.value;
    }
  }

  const normalized = normalizeText(getMessageText(message));
  if (!normalized) {
    return null;
  }

  const districtByTitle = DISTRICTS.find(
    (district) =>
      normalizeText(district.title) === normalized || normalizeText(district.value) === normalized
  );

  return districtByTitle ? districtByTitle.value : null;
}

function classifyDocument(message) {
  const type = message && message.type;
  if (!type || !['document', 'image'].includes(type)) {
    return null;
  }

  return 'certificate';
}

module.exports = {
  normalizeText,
  getMessageText,
  getInteractiveReplyId,
  parseQualification,
  isQualificationDeclined,
  isInterested,
  isNotInterested,
  parseAge,
  parseSex,
  parseDistrict,
  parseTermsAcceptance,
  classifyDocument
};
