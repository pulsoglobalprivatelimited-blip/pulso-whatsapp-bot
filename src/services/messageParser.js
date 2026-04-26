const config = require('../config');
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
  if (replyId === BUTTON_IDS.QUALIFICATION_HCA) return 'hca';
  if (replyId === BUTTON_IDS.QUALIFICATION_BSC_NURSING) return 'bsc_nursing';
  if (replyId === BUTTON_IDS.QUALIFICATION_OTHER_CAREGIVING) return 'other_caregiving';
  if (replyId === BUTTON_IDS.QUALIFICATION_NONE_OF_THESE) return 'none_of_these';
  if (replyId === BUTTON_IDS.QUALIFICATION_GO_BACK) return 'go_back';

  const normalized = normalizeText(getMessageText(message));
  if (normalized.includes('gda')) return 'gda';
  if (normalized.includes('gnm')) return 'gnm';
  if (normalized.includes('anm')) return 'anm';
  if (normalized.includes('hca')) return 'hca';
  if (normalized.includes('bsc nursing') || normalized.includes('b.sc nursing')) return 'bsc_nursing';
  if (
    normalized.includes('caregiving') ||
    normalized.includes('care giving') ||
    normalized.includes('experience in caregiving')
  ) {
    return 'other_caregiving';
  }
  if (['ivayonnumalla', 'ഇവയൊന്നുമല്ല'].includes(normalized)) return 'none_of_these';
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

function parseDutyHourPreference(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.DUTY_HOUR_8) return '8_hour';
  if (replyId === BUTTON_IDS.DUTY_HOUR_24) return '24_hour';
  if (replyId === BUTTON_IDS.DUTY_HOUR_BOTH) return 'both';

  const normalized = normalizeText(getMessageText(message));
  if (
    normalized.includes('രണ്ടും') ||
    normalized === 'both' ||
    normalized.includes('both') ||
    normalized.includes('8 hour and 24 hour') ||
    normalized.includes('24 hour and 8 hour') ||
    normalized.includes('8 & 24')
  ) {
    return 'both';
  }
  if (
    normalized.includes('8 hour') ||
    normalized.includes('8 am to 6 pm') ||
    normalized === '8'
  ) {
    return '8_hour';
  }

  if (normalized.includes('24 hour') || normalized === '24') {
    return '24_hour';
  }

  return null;
}

function parseSampleDutyOfferPreference(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.SAMPLE_DUTY_YES) return 'show';
  if (replyId === BUTTON_IDS.SAMPLE_DUTY_NO) return 'skip';

  const normalized = normalizeText(getMessageText(message));
  if (['കാണാം', 'show', 'yes', 'ok', 'okay'].includes(normalized)) return 'show';
  if (['വേണ്ട', 'skip', 'no'].includes(normalized)) return 'skip';

  return null;
}

function parseExpectedDutiesResponse(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.EXPECTED_DUTIES_YES) return 'accept';
  if (replyId === BUTTON_IDS.EXPECTED_DUTIES_NO) return 'decline';

  const normalized = normalizeText(getMessageText(message));
  if (['തയ്യാറാണ്', 'ready', 'yes', 'ok', 'okay'].includes(normalized)) return 'accept';
  if (['താൽപര്യമില്ല', 'not interested', 'no'].includes(normalized)) return 'decline';

  return null;
}

function parseAge(message) {
  const normalized = normalizeText(getMessageText(message));
  const match = normalized.match(/\d{1,3}/);
  if (!match) return null;

  const age = Number(match[0]);
  if (age < 18 || age > 99) return null;
  return age;
}

function parseAgeCorrectionAction(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.AGE_RETRY_ENTRY) return 'retry';
  if (replyId === BUTTON_IDS.AGE_CONFIRM_EXIT) return 'exit';
  if (replyId === BUTTON_IDS.AGE_EDIT_AFTER_REJECTION) return 'edit_after_rejection';
  if (replyId === BUTTON_IDS.AGE_CLOSE_AFTER_REJECTION) return 'close_after_rejection';

  const normalized = normalizeText(getMessageText(message));
  if (['വയസ് വീണ്ടും നൽകാം', 'retry age', 'retry', 'again'].includes(normalized)) return 'retry';
  if (['വയസ് തിരുത്താം', 'edit age'].includes(normalized)) return 'edit_after_rejection';
  if (['ശരി', 'ok', 'okay'].includes(normalized)) return 'exit';
  return null;
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
  if (replyId === BUTTON_IDS.CONNECT_PULSO_AGENT) return 'connect_agent';
  if (replyId === BUTTON_IDS.TERMS_ACCEPT) return 'accept';
  if (replyId === BUTTON_IDS.TERMS_DECLINE) return 'decline';

  const normalized = normalizeText(getMessageText(message));
  if (['കൂടുതൽ സഹായം', 'pulso agent-നോട് ബന്ധപ്പെടുക', 'connect pulso agent'].includes(normalized)) {
    return 'connect_agent';
  }
  if (['സ്വീകരിക്കുന്നു', 'accept', 'accepted', 'ok', 'yes'].includes(normalized)) return 'accept';
  if (['സ്വീകരിക്കുന്നില്ല', 'decline', 'no'].includes(normalized)) return 'decline';
  return null;
}

function parseTermsReminderResume(message) {
  const normalized = normalizeText(getMessageText(message));
  const configuredKeyword = normalizeText(config.termsReminderResumeKeyword);

  return [
    configuredKeyword,
    'continue',
    'start',
    'resume',
    'hi',
    'hello'
  ].filter(Boolean).includes(normalized);
}

function parseCertificateCollectionAction(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.CERTIFICATE_ADD_MORE) return 'add_more';
  if (replyId === BUTTON_IDS.CERTIFICATE_CONTINUE) return 'continue';

  const normalized = normalizeText(getMessageText(message));
  if (['കൂടുതൽ അയക്കാം', 'add more', 'more'].includes(normalized)) return 'add_more';
  if (['തുടരാം', 'continue', 'next'].includes(normalized)) return 'continue';
  return null;
}

function parseDistrictListAction(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.DISTRICT_PAGE_NEXT) return 'next';
  if (replyId === BUTTON_IDS.DISTRICT_PAGE_PREVIOUS) return 'previous';

  const normalized = normalizeText(getMessageText(message));
  if (['next', 'next list', 'അടുത്ത list'].includes(normalized)) return 'next';
  if (['previous', 'first list', 'ആദ്യ list'].includes(normalized)) return 'previous';
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
  parseDutyHourPreference,
  parseSampleDutyOfferPreference,
  parseExpectedDutiesResponse,
  parseAge,
  parseAgeCorrectionAction,
  parseSex,
  parseDistrict,
  parseDistrictListAction,
  parseTermsAcceptance,
  parseTermsReminderResume,
  parseCertificateCollectionAction,
  classifyDocument
};
