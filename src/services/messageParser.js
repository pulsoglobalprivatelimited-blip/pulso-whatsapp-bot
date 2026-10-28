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

/** The region only — the language is asked separately, as its own step. */
function parseRegion(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.REGION_KERALA) return 'kerala';
  if (replyId === BUTTON_IDS.REGION_KARNATAKA) return 'karnataka';
  if (replyId === BUTTON_IDS.REGION_UAE) return 'uae';

  const normalized = normalizeText(getMessageText(message));
  if (isDubaiCaregiverText(getMessageText(message))) return 'uae';
  if (['kerala', 'malayalam', 'ml'].includes(normalized)) return 'kerala';
  if (['karnataka', 'bangalore', 'bengaluru', 'english', 'en'].includes(normalized)) {
    return 'karnataka';
  }
  return null;
}

/* The Dubai caregiver ad opens the chat with "DUBAI CAREGIVER" (contract,
   26 Oct 2026). Any case, any spacing, anything after it. */
function isDubaiCaregiverText(text) {
  return /^\s*dubai\s+caregiver\b/i.test(String(text || ''));
}

function parseLanguage(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.LANGUAGE_MALAYALAM) return 'ml';
  if (replyId === BUTTON_IDS.LANGUAGE_ENGLISH) return 'en';

  const normalized = normalizeText(getMessageText(message));
  if (['malayalam', 'ml', 'മലയാളം'].includes(normalized)) return 'ml';
  if (['english', 'en'].includes(normalized)) return 'en';
  return null;
}

function parseQualification(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.QUALIFICATION_GDA) return 'gda';
  if (replyId === BUTTON_IDS.QUALIFICATION_GNM) return 'gnm';
  if (replyId === BUTTON_IDS.QUALIFICATION_ANM) return 'anm';
  if (replyId === BUTTON_IDS.QUALIFICATION_HCA) return 'hca';
  if (replyId === BUTTON_IDS.QUALIFICATION_CNA) return 'cna';
  if (replyId === BUTTON_IDS.QUALIFICATION_BSC_NURSING) return 'bsc_nursing';
  if (replyId === BUTTON_IDS.QUALIFICATION_OTHER_CAREGIVING) return 'other_caregiving';
  if (replyId === BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE) return 'no_certificate';
  if (replyId === BUTTON_IDS.QUALIFICATION_NURSING_STUDENT) return 'nursing_student';

  const normalized = normalizeText(getMessageText(message));
  // Before GNM/ANM/BSc: "nursing student" and the row's own words name a course
  // she is still studying, not one she holds.
  if (
    normalized.includes('nursing student') ||
    normalized.includes('student nurse') ||
    normalized.includes('waiting for registration') ||
    normalized.includes('നഴ്സിംഗ് വിദ്യാർത്ഥി') ||
    normalized.includes('പഠിക്കുന്നു') ||
    normalized.includes('studying')
  ) {
    return 'nursing_student';
  }
  if (normalized.includes('gda')) return 'gda';
  if (normalized.includes('gnm')) return 'gnm';
  if (normalized.includes('anm')) return 'anm';
  if (normalized.includes('hca')) return 'hca';
  // CNA is UAE-only; onboardingFlow drops it outside a UAE flow.
  if (/\bcna\b/.test(normalized) || normalized.includes('certified nursing assistant')) return 'cna';
  if (normalized.includes('bsc nursing') || normalized.includes('b.sc nursing')) return 'bsc_nursing';
  if (
    normalized.includes('caregiving') ||
    normalized.includes('care giving') ||
    normalized.includes('experience in caregiving')
  ) {
    return 'other_caregiving';
  }
  // The row's own words in both scripts, plus the old "None of these" words so
  // someone who types what the list used to say still lands on the same row.
  if (
    normalized.includes('no certificate') ||
    normalized.includes('no cert') ||
    normalized.includes('certificate illa') ||
    normalized.includes('സർട്ടിഫിക്കറ്റ് ഇല്ല') ||
    normalized.includes('certificate ഇല്ല') ||
    ['ivayonnumalla', 'ഇവയൊന്നുമല്ല', 'none of these'].includes(normalized)
  ) {
    return 'no_certificate';
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

function parseDutyHourPreference(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.DUTY_HOUR_8) return '8_hour';
  if (replyId === BUTTON_IDS.DUTY_HOUR_24) return '24_hour';
  if (replyId === BUTTON_IDS.DUTY_HOUR_BOTH) return 'both';
  // UAE 12-hour shift (27 Oct 2026): only the UAE list sends this id.
  if (replyId === BUTTON_IDS.DUTY_HOUR_12) return '12_hour';

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
  if (/(^|\D)12( ?hours?| ?hrs?)?$/.test(normalized) || normalized.includes('12 hour')) {
    return '12_hour';
  }
  if (normalized === 'any duty' || normalized === 'any') {
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

/* Supporting care: true (she will cook the patient's food), false, or null
   for anything else, which is asked again. Typed answers are read only when
   they are plainly one or the other. */
function parseCookingPreference(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.COOKING_YES) return true;
  if (replyId === BUTTON_IDS.COOKING_NO) return false;
  if (replyId) return null;

  const normalized = normalizeText(getMessageText(message))
    .replace(/[✅❌]/g, '')
    .replace(/[.!]+$/, '')
    .trim();
  if (['അതെ', 'അതെ, പാചകം ചെയ്യാം', 'പാചകം ചെയ്യാം', 'ചെയ്യാം', 'yes', 'yes, i can cook', 'ok', 'okay'].includes(normalized)) return true;
  if (['വേണ്ട', 'ഇല്ല', 'no', 'no thanks'].includes(normalized)) return false;
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
  if (['വയസ് വീണ്ടും നൽകാം', 'retry age', 'retry', 'again', 'correct age'].includes(normalized)) return 'retry';
  if (['വയസ് തിരുത്താം', 'edit age', 'correct age'].includes(normalized)) return 'edit_after_rejection';
  if (['ശരി', 'ok', 'okay', 'stop here'].includes(normalized)) return 'exit';
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

/* Height: a tapped row, or 'skip'; a typed figure is not read — that was the
   confusion the list removes. */
function parseHeightRange(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.HEIGHT_SKIP) return 'skip';
  const keys = [
    BUTTON_IDS.HEIGHT_LT_5_0, BUTTON_IDS.HEIGHT_5_0_5_2, BUTTON_IDS.HEIGHT_5_3_5_5,
    BUTTON_IDS.HEIGHT_5_6_5_8, BUTTON_IDS.HEIGHT_5_9_5_11, BUTTON_IDS.HEIGHT_6_0_PLUS
  ];
  if (keys.includes(replyId)) return replyId;
  const normalized = normalizeText(getMessageText(message));
  if (['skip', 'ഒഴിവാക്കുക', 'later'].includes(normalized)) return 'skip';
  return null;
}

/* A UAE mobile number typed by hand: 05X XXX XXXX, 5XXXXXXXX, 9715XXXXXXXX or
   +971 5X XXX XXXX, any spacing. Returns the 12-digit "9715…" form, or null.
   Never turned into a "91…" number. */
function parseUaeMobile(message) {
  if (getInteractiveReplyId(message)) return null;
  let digits = String(getMessageText(message) || '').replace(/\D/g, '');
  if (digits.startsWith('00971')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('971')) digits = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith('05')) digits = digits.slice(1);
  return /^5\d{8}$/.test(digits) ? `971${digits}` : null;
}

/* An Indian mobile number typed by hand: 10 digits starting 6-9, with or
   without +91 / 91 / 0 and spaces. Returns the 12-digit "91…" form, or null. */
function parseIndianMobile(message) {
  if (getInteractiveReplyId(message)) return null;
  let digits = String(getMessageText(message) || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : null;
}

/* Weight in kg: a whole number between 35 and 150, "58", "58 kg", "58.5". */
function parseWeightKg(message) {
  // Required since 14 Oct 2026: a Skip tap on an older message, or "skip"
  // typed, is not a weight and is asked again.
  if (getInteractiveReplyId(message)) return null;
  const normalized = normalizeText(getMessageText(message));
  const match = normalized.match(/(\d{2,3})(?:[.,]\d+)?/);
  if (!match) return null;
  const kg = Number(match[1]);
  if (kg < 35 || kg > 150) return null;
  return kg;
}

function parseProfileConsent(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.PROFILE_CONSENT_AGREE) return true;
  const normalized = normalizeText(getMessageText(message));
  return ['i agree', 'agree', 'yes', 'ok', 'okay', 'സമ്മതം', 'സമ്മതിക്കുന്നു', 'sammatham'].includes(normalized) ? true : null;
}

function parseProfilePhotoAction(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.PROFILE_PHOTO_LATER) return 'later';
  if (message && message.type === 'image') return 'photo';
  if (message && ['document', 'video', 'sticker'].includes(message.type)) return 'not_a_photo';
  const normalized = normalizeText(getMessageText(message));
  if (['later', 'skip', 'പിന്നീട്', 'pinneed'].includes(normalized)) return 'later';
  return null;
}

/* The wake-up: a template quick reply comes back as type 'button' with the
   payload it was sent with; an in-window tap as an interactive reply. */
function parseStillAvailable(message) {
  const replyId =
    getInteractiveReplyId(message) ||
    (message && message.type === 'button' && message.button ? message.button.payload : null);
  if (replyId === BUTTON_IDS.STILL_AVAILABLE_YES) return 'yes';
  if (replyId === BUTTON_IDS.STILL_AVAILABLE_NOT_NOW) return 'not_now';
  const normalized = normalizeText(getMessageText(message));
  if (['yes', 'yes, i am available', 'available', 'ഉണ്ട്', 'undu', 'ok', 'okay'].includes(normalized)) return 'yes';
  if (['not now', 'no', 'later', 'ഇല്ല', 'illa'].includes(normalized)) return 'not_now';
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

function parsePulsoAppInstallInterest(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.PULSO_APP_INSTALL_YES) return 'yes';
  if (replyId === BUTTON_IDS.PULSO_APP_INSTALL_NO) return 'no';
  if (replyId === BUTTON_IDS.PULSO_APP_DEVICE_ANDROID) return 'android';
  if (replyId === BUTTON_IDS.PULSO_APP_DEVICE_IPHONE) return 'iphone';
  if (replyId === BUTTON_IDS.PULSO_APP_NEED_HELP) return 'need_help';

  const normalized = normalizeText(getMessageText(message));
  if (['yes', 'ok', 'okay', 'install', 'താൽപര്യമുണ്ട്'].includes(normalized)) return 'yes';
  if (['no', 'വേണ്ട', 'താൽപര്യമില്ല'].includes(normalized)) return 'no';
  if (['android', 'android phone'].includes(normalized)) return 'android';
  if (['iphone', 'i phone', 'ios', 'apple'].includes(normalized)) return 'iphone';
  if (['need help', 'help', 'സഹായം വേണം'].includes(normalized)) return 'need_help';
  return null;
}

// The Duty Card question after onboarding: "do you work with an agency?"
function parseAgencyAnswer(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.AGENCY_YES) return 'yes';
  if (replyId === BUTTON_IDS.AGENCY_NO) return 'no';
  const normalized = normalizeText(getMessageText(message));
  if (['yes', 'ok', 'okay', 'undu', 'ഉണ്ട്', 'അതെ', 'ഉണ്ട്.'].includes(normalized)) return 'yes';
  if (['no', 'illa', 'ഇല്ല', 'ഇല്ല.'].includes(normalized)) return 'no';
  return null;
}

// "Add the duty now?" — the follow-up when she said yes.
function parseAddDutyInterest(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.ADD_DUTY_NOW) return 'now';
  if (replyId === BUTTON_IDS.ADD_DUTY_LATER) return 'later';
  const normalized = normalizeText(getMessageText(message));
  if (['yes', 'ok', 'okay', 'now', 'ഉണ്ട്', 'അതെ'].includes(normalized)) return 'now';
  if (['no', 'later', 'പിന്നീട്', 'ഇല്ല', 'വേണ്ട'].includes(normalized)) return 'later';
  return null;
}

// Typed any time after onboarding: "duty" resends the steps, "agency" re-asks
// the question. Kept to the bare words so "duty days" (the certificate
// question, matched earlier) and ordinary chat never land here.
function isAddDutyKeyword(message) {
  const normalized = normalizeText(getMessageText(message));
  return ['duty', 'add duty', 'add my duty', 'duty add'].includes(normalized);
}

function isAgencyKeyword(message) {
  const normalized = normalizeText(getMessageText(message));
  return ['agency', 'agency duty', 'ഏജൻസി'].includes(normalized);
}

function parsePulsoAppDevice(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.PULSO_APP_DEVICE_IPHONE) return 'iphone';
  if (replyId === BUTTON_IDS.PULSO_APP_DEVICE_ANDROID) return 'android';
  if (replyId === BUTTON_IDS.PULSO_APP_NEED_HELP) return 'need_help';

  const normalized = normalizeText(getMessageText(message));
  if (['iphone', 'i phone', 'ios', 'apple'].includes(normalized)) return 'iphone';
  if (['android', 'android phone'].includes(normalized)) return 'android';
  if (['need help', 'help', 'സഹായം വേണം'].includes(normalized)) return 'need_help';
  return null;
}

function parsePulsoAppActivationAction(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.PULSO_APP_INSTALLED) return 'installed';
  if (replyId === BUTTON_IDS.PULSO_APP_NEED_HELP) return 'need_help';
  if (replyId === BUTTON_IDS.PULSO_APP_LATER) return 'later';

  const normalized = normalizeText(getMessageText(message));
  if (['installed', 'yes installed', 'yes, installed', 'done', 'ചെയ്തു'].includes(normalized)) {
    return 'installed';
  }
  if (['need help', 'help', 'സഹായം വേണം'].includes(normalized)) return 'need_help';
  if (['later', 'not installed', 'പിന്നീട്'].includes(normalized)) return 'later';
  return null;
}

function parsePulsoAppHelpReason(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.PULSO_APP_HELP_INSTALL) return 'install_help';
  if (replyId === BUTTON_IDS.PULSO_APP_HELP_LOGIN_OTP) return 'login_otp_issue';
  if (replyId === BUTTON_IDS.PULSO_APP_HELP_NO_SMARTPHONE) return 'no_smartphone';

  const normalized = normalizeText(getMessageText(message));
  if (['install help', 'need help installing app'].includes(normalized)) return 'install_help';
  if (['login / otp issue', 'login issue', 'otp issue'].includes(normalized)) return 'login_otp_issue';
  if (['no smartphone', 'smartphone ഇല്ല'].includes(normalized)) return 'no_smartphone';
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

// The details check after the district (8 Oct 2026). Taps are read by id;
// typed words only when `typed` is true, because while she is answering a
// re-asked question her words are that answer, not a command.
const DETAILS_EDIT_BY_ID = {
  [BUTTON_IDS.DETAILS_EDIT_NAME]: 'name',
  [BUTTON_IDS.DETAILS_EDIT_AGE]: 'age',
  [BUTTON_IDS.DETAILS_EDIT_SEX]: 'sex',
  [BUTTON_IDS.DETAILS_EDIT_DISTRICT]: 'district',
  [BUTTON_IDS.DETAILS_EDIT_QUALIFICATION]: 'qualification',
  [BUTTON_IDS.DETAILS_EDIT_HEIGHT]: 'height',
  [BUTTON_IDS.DETAILS_EDIT_WEIGHT]: 'weight',
  [BUTTON_IDS.DETAILS_EDIT_LOGIN_PHONE]: 'loginPhone'
};
const DETAILS_EDIT_BY_WORD = {
  'പേര്': 'name', name: 'name',
  'വയസ്': 'age', age: 'age',
  'സ്ത്രീ / പുരുഷൻ': 'sex', 'male or female': 'sex', sex: 'sex',
  'ജില്ല': 'district', district: 'district',
  'യോഗ്യത': 'qualification', qualification: 'qualification',
  'ഉയരം': 'height', height: 'height',
  'ഭാരം': 'weight', weight: 'weight',
  'app login number': 'loginPhone', 'login number': 'loginPhone'
};

function parseDetailsCheckAction(message, { typed = true } = {}) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.DETAILS_CORRECT) return { action: 'correct' };
  if (replyId === BUTTON_IDS.DETAILS_CHANGE) return { action: 'change' };
  if (replyId && DETAILS_EDIT_BY_ID[replyId]) return { action: 'edit', field: DETAILS_EDIT_BY_ID[replyId] };
  if (!typed) return null;

  const normalized = normalizeText(getMessageText(message));
  if (['ശരിയാണ്', 'ശരി', 'correct', 'ok', 'okay', 'yes', 'sheri', 'shari', 'sariyanu'].includes(normalized)) {
    return { action: 'correct' };
  }
  if (['മാറ്റണം', 'change', 'edit', 'mattanam'].includes(normalized)) return { action: 'change' };
  if (DETAILS_EDIT_BY_WORD[normalized]) return { action: 'edit', field: DETAILS_EDIT_BY_WORD[normalized] };
  return null;
}

/* UAE plan (27 Oct 2026): visa type, emirate and "Do you have a DHA nursing
   licence?". Taps only for the lists; a typed name of the option also counts. */
function pickFromOptions(message, options) {
  const replyId = getInteractiveReplyId(message);
  if (replyId) {
    const hit = options.find((o) => o.id === replyId);
    return hit || null;
  }
  const typed = normalizeText(getMessageText(message));
  if (!typed) return null;
  return options.find((o) => normalizeText(o.title) === typed || normalizeText(o.value) === typed) || null;
}

function parseUaeVisa(message) {
  const hit = pickFromOptions(message, require('../flow').UAE_VISA_OPTIONS);
  return hit ? hit.value : null;
}

function parseUaeVisaOther(message) {
  const hit = pickFromOptions(message, require('../flow').UAE_VISA_OTHER_OPTIONS);
  return hit ? hit.value : null;
}

function parseUaeNationality(message) {
  const hit = pickFromOptions(message, require('../flow').UAE_NATIONALITY_OPTIONS);
  return hit ? hit.value : null;
}

// A typed country for "Other": letters, spaces, dots and dashes, 2-40 long,
// in title case ("sri lankan" -> "Sri Lankan").
function parseTypedCountry(message) {
  const typed = String(getMessageText(message) || '').replace(/\s+/g, ' ').trim();
  if (typed.length < 2 || typed.length > 40 || !/^[\p{L} .'-]+$/u.test(typed)) return null;
  return typed.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function parseEmirate(message) {
  const hit = pickFromOptions(message, require('../flow').UAE_EMIRATES);
  return hit ? hit.value : null;
}

function parseDhaHas(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === BUTTON_IDS.DHA_HAS_YES) return 'yes';
  if (replyId === BUTTON_IDS.DHA_HAS_NOT_YET) return 'not_yet';
  const typed = normalizeText(getMessageText(message));
  if (['yes', 'ഉണ്ട്', 'yes i have'].includes(typed)) return 'yes';
  if (['not yet', 'no', 'ഇല്ല', 'ഇതുവരെ ഇല്ല'].includes(typed)) return 'not_yet';
  return null;
}

module.exports = {
  parseUaeVisa,
  parseUaeVisaOther,
  parseUaeNationality,
  parseTypedCountry,
  parseEmirate,
  parseDhaHas,
  normalizeText,
  parseHeightRange,
  parseWeightKg,
  parseIndianMobile,
  parseUaeMobile,
  isDubaiCaregiverText,
  parseProfileConsent,
  parseProfilePhotoAction,
  parseStillAvailable,
  parseDetailsCheckAction,
  getMessageText,
  getInteractiveReplyId,
  parseRegion,
  parseLanguage,
  parseQualification,
  isQualificationDeclined,
  isInterested,
  isNotInterested,
  parseDutyHourPreference,
  parseCookingPreference,
  parseSampleDutyOfferPreference,
  parseExpectedDutiesResponse,
  parseAge,
  parseAgeCorrectionAction,
  parseSex,
  parseDistrict,
  parseDistrictListAction,
  parseTermsAcceptance,
  parsePulsoAppInstallInterest,
  parsePulsoAppDevice,
  parseAgencyAnswer,
  parseAddDutyInterest,
  isAddDutyKeyword,
  isAgencyKeyword,
  parsePulsoAppActivationAction,
  parsePulsoAppHelpReason,
  parseTermsReminderResume,
  parseCertificateCollectionAction,
  classifyDocument
};
