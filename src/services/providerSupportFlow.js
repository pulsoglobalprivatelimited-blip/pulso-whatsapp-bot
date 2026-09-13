const config = require('../config');
const { STATUS } = require('../flow');
const { getFirestore } = require('./storage');
const { sendText, sendButtons, sendList } = require('./metaClient');
const { getInteractiveReplyId, getMessageText, normalizeText } = require('./messageParser');
const { getProvider } = require('./providerService');
const {
  notifyProviderSupportHelpRequested,
  notifyCarePartnerHelpRequested
} = require('./providerSupportNotifications');
const { PARTNER_KIND, resolveCarePartner } = require('./carePartnerService');
const carePartnerFlow = require('./carePartnerFlow');

const COLLECTION = 'providerSupportSessions';
const SUPPORT_HELP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const SUPPORT_STATUS = {
  AWAITING_AUDIENCE: 'awaiting_audience',
  AWAITING_REGION: 'awaiting_region',
  MAIN_MENU: 'main_menu',
  AWAITING_DUTY_TYPE: 'awaiting_duty_type',
  AWAITING_APP_ISSUE: 'awaiting_app_issue',
  AWAITING_PARTNER_TOPIC: carePartnerFlow.PARTNER_STATUS.AWAITING_TOPIC,
  AWAITING_PARTNER_APP_ISSUE: carePartnerFlow.PARTNER_STATUS.AWAITING_APP_ISSUE
};

// Who the person on the other end says they are. Sessions written before this
// question existed came from a provider-only line, so they default to provider
// rather than being asked again mid-conversation.
const AUDIENCE = {
  PROVIDER: 'provider',
  PARTNER: 'partner'
};

const SUPPORT_BUTTON_IDS = {
  AUDIENCE_PROVIDER: 'ps_audience_provider',
  AUDIENCE_PARTNER: 'ps_audience_partner',
  REGION_KERALA: 'ps_region_kerala',
  REGION_KARNATAKA: 'ps_region_karnataka',
  REGION_OTHER: 'ps_region_other',
  DUTY_8H: 'ps_duty_8h',
  DUTY_24H: 'ps_duty_24h',
  APP_DOWNLOAD: 'ps_app_download',
  APP_LOGIN: 'ps_app_login',
  APP_OTP: 'ps_app_otp',
  APP_AGENT: 'ps_app_agent',
  MAIN_JOIN: 'ps_main_join',
  MAIN_DUTY: 'ps_main_duty',
  MAIN_PAYMENT: 'ps_main_payment',
  MAIN_APP: 'ps_main_app',
  MAIN_DUTY_ISSUE: 'ps_main_duty_issue',
  MAIN_TALK: 'ps_main_talk',
  BACK_MAIN: 'ps_back_main'
};

function senderOptions() {
  return config.providerSupportPhoneNumberId
    ? { phoneNumberId: config.providerSupportPhoneNumberId }
    : undefined;
}

function nowIso() {
  return new Date().toISOString();
}

function sessionRef(phone) {
  return getFirestore().collection(COLLECTION).doc(phone);
}

async function addSessionEvent(phone, event) {
  await sessionRef(phone).collection('events').add({
    ...event,
    createdAt: nowIso()
  });
}

async function getSession(phone) {
  const snap = await sessionRef(phone).get();
  return snap.exists ? snap.data() : null;
}

async function updateSession(phone, patch) {
  const ref = sessionRef(phone);
  const existing = await ref.get();
  const payload = {
    phone,
    ...patch,
    updatedAt: nowIso()
  };
  if (!existing.exists) {
    payload.createdAt = nowIso();
  }
  await ref.set(payload, { merge: true });
  return { ...(existing.exists ? existing.data() : {}), ...payload };
}

async function sendAndLog(phone, kind, body) {
  const options = senderOptions();

  if (kind === 'buttons') {
    await sendButtons(phone, body.body, body.buttons, options);
  } else if (kind === 'list') {
    await sendList(phone, body.body, body.buttonText, body.sections, options);
  } else {
    await sendText(phone, body, options);
  }

  await addSessionEvent(phone, {
    type: 'outbound_message',
    payload: { kind, body }
  });
}

function getSessionAudience(session = {}) {
  return session.audience === AUDIENCE.PARTNER ? AUDIENCE.PARTNER : AUDIENCE.PROVIDER;
}

function getSessionLanguage(session = {}) {
  if (session.language) return session.language;
  return session.region === 'kerala' ? 'ml' : 'en';
}

function isMalayalam(language) {
  return language === 'ml';
}

function appLinksMessage(language = 'en') {
  if (isMalayalam(language)) {
    return [
      'Pulso app download links',
      '',
      'Android users:',
      config.providerSupportAndroidAppUrl,
      '',
      'iPhone users:',
      config.providerSupportIosAppUrl
    ].join('\n');
  }

  return [
    'Pulso Mobile App Download Links',
    '',
    'Android users:',
    config.providerSupportAndroidAppUrl,
    '',
    'iPhone users:',
    config.providerSupportIosAppUrl
  ].join('\n');
}

function supportPhoneMessage(prefix, language = 'en') {
  const timeLines = isMalayalam(language)
    ? ['Available time:', 'രാവിലെ 10:00 മുതൽ വൈകുന്നേരം 5:00 വരെ']
    : ['Available time:', '10:00 AM to 5:00 PM'];

  return [
    prefix,
    '',
    config.providerSupportPhone,
    '',
    ...timeLines
  ].join('\n');
}

// The cooldown is per reason, so a partner reporting a caregiver missing from a
// client's home is never blocked by a payout question they asked this morning.
function getSupportHelpRequestedAt(session, reason) {
  const requests = (session && session.supportHelpRequests) || {};
  const perReason = reason && requests[reason] ? Date.parse(requests[reason]) : NaN;
  if (perReason) {
    return perReason;
  }

  // Sessions written before per-reason tracking only carry the single field.
  if (session && session.supportHelpReason === reason && session.supportHelpRequestedAt) {
    return Date.parse(session.supportHelpRequestedAt);
  }

  return NaN;
}

function getSupportHelpCooldownRemainingMs(session, reason) {
  const requestedAt = getSupportHelpRequestedAt(session, reason);
  if (!requestedAt) {
    return 0;
  }

  const remainingMs = SUPPORT_HELP_COOLDOWN_MS - (Date.now() - requestedAt);
  return remainingMs > 0 ? remainingMs : 0;
}

function canRequestSupportHelp(session, reason) {
  return getSupportHelpCooldownRemainingMs(session, reason) === 0;
}

function supportHelpAcceptedMessage(language = 'en') {
  if (isMalayalam(language)) {
    return [
      'ഞങ്ങളുടെ support team-നെ അറിയിച്ചിട്ടുണ്ട്.',
      'Support team issue പരിശോധിച്ച് ആവശ്യമെങ്കിൽ നിങ്ങളെ ബന്ധപ്പെടും.',
      '',
      'Support time:',
      'രാവിലെ 10:00 മുതൽ വൈകുന്നേരം 5:00 വരെ',
      '',
      'Urgent help-നായി വിളിക്കുക:',
      config.providerSupportPhone
    ].join('\n');
  }

  return [
    'Our support team has been informed.',
    'The team will review your issue and contact you if needed.',
    '',
    'Support time:',
    '10:00 AM to 5:00 PM',
    '',
    'For urgent help, call:',
    config.providerSupportPhone
  ].join('\n');
}

function partnerHelpAcceptedMessage(language = 'en') {
  const phone = config.partnerSupportPhone || config.providerSupportPhone;

  if (isMalayalam(language)) {
    return [
      'ഞങ്ങളുടെ partner team-നെ അറിയിച്ചിട്ടുണ്ട്.',
      'Team പരിശോധിച്ച് ആവശ്യമെങ്കിൽ നിങ്ങളെ ബന്ധപ്പെടും.',
      '',
      'Support time:',
      'രാവിലെ 10:00 മുതൽ വൈകുന്നേരം 5:00 വരെ',
      '',
      'Urgent help-നായി വിളിക്കുക:',
      phone
    ].join('\n');
  }

  return [
    'Our partner team has been informed.',
    'The team will review and contact you if needed.',
    '',
    'Support time:',
    '10:00 AM to 5:00 PM',
    '',
    'For urgent help, call:',
    phone
  ].join('\n');
}

function supportHelpAlreadyRequestedMessage(language = 'en') {
  return isMalayalam(language)
    ? 'ഞങ്ങളുടെ support team-നെ ഇതിനകം അറിയിച്ചിട്ടുണ്ട്. സഹായം ലഭിക്കാത്ത പക്ഷം 12 മണിക്കൂറിന് ശേഷം വീണ്ടും request ചെയ്യാം.'
    : 'Our support team has already been informed. If you do not get help, you can request again after 12 hours.';
}

function registrationRequiredMessage(language = 'en') {
  if (isMalayalam(language)) {
    return [
      'താങ്കൾ Pulso-യിൽ registered provider അല്ല.',
      '',
      'Duty ലഭിക്കാൻ, payment support ലഭിക്കാൻ, duty/family issue support ലഭിക്കാൻ ആദ്യം Pulso provider registration complete ചെയ്യണം.',
      '',
      'Registration ഇവിടെ തുടങ്ങുക:',
      config.providerSupportJoiningChatbotUrl
    ].join('\n');
  }

  return [
    'You are not registered with Pulso yet.',
    '',
    'To get duties, payment support, or duty-related help, please complete your Pulso provider registration first.',
    '',
    'Start registration here:',
    config.providerSupportJoiningChatbotUrl
  ].join('\n');
}

async function isRegisteredProvider(phone) {
  const provider = await getProvider(phone);
  return Boolean(provider && provider.status === STATUS.COMPLETED);
}

async function ensureRegisteredProvider(phone, language = 'en') {
  if (await isRegisteredProvider(phone)) {
    return true;
  }

  await sendAndLog(phone, 'text', registrationRequiredMessage(language));
  await sendMainMenu(phone, language);
  return false;
}

function parseAudienceSelection(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === SUPPORT_BUTTON_IDS.AUDIENCE_PROVIDER) return AUDIENCE.PROVIDER;
  if (replyId === SUPPORT_BUTTON_IDS.AUDIENCE_PARTNER) return AUDIENCE.PARTNER;

  const text = normalizeText(getMessageText(message));
  if (
    ['1', 'caregiver', 'nurse', 'gda', 'staff', 'caregiver / nurse', 'caregiver nurse', 'job'].includes(
      text
    )
  ) {
    return AUDIENCE.PROVIDER;
  }
  if (
    ['2', 'agency', 'home care agency', 'homecare agency', 'partner', 'care partner', 'bureau', 'ഏജൻസി'].includes(
      text
    )
  ) {
    return AUDIENCE.PARTNER;
  }
  return null;
}

function parseRegionSelection(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === SUPPORT_BUTTON_IDS.REGION_KERALA) return 'kerala';
  if (replyId === SUPPORT_BUTTON_IDS.REGION_KARNATAKA) return 'karnataka';
  if (replyId === SUPPORT_BUTTON_IDS.REGION_OTHER) return 'other';

  const text = normalizeText(getMessageText(message));
  if (['1', 'kerala', 'kl'].includes(text)) return 'kerala';
  if (['2', 'karnataka', 'ka', 'bangalore', 'bengaluru'].includes(text)) return 'karnataka';
  if (['3', 'other', 'others'].includes(text)) return 'other';
  return null;
}

function parseMainMenuSelection(message) {
  const replyId = getInteractiveReplyId(message);
  const idMap = {
    [SUPPORT_BUTTON_IDS.MAIN_JOIN]: 'join',
    [SUPPORT_BUTTON_IDS.MAIN_DUTY]: 'duty_availability',
    [SUPPORT_BUTTON_IDS.MAIN_PAYMENT]: 'payment',
    [SUPPORT_BUTTON_IDS.MAIN_APP]: 'app_issue',
    [SUPPORT_BUTTON_IDS.MAIN_DUTY_ISSUE]: 'duty_issue',
    [SUPPORT_BUTTON_IDS.MAIN_TALK]: 'talk_support'
  };
  if (idMap[replyId]) return idMap[replyId];

  const text = normalizeText(getMessageText(message));
  if (['6', 'join', 'joining', 'register', 'registration', 'new registration'].includes(text)) {
    return 'join';
  }
  if (['1', 'duty', 'duty availability', 'check duty', 'check duty availability', 'offer', 'offers'].includes(text)) {
    return 'duty_availability';
  }
  if (['2', 'payment', 'payment help', 'salary'].includes(text)) return 'payment';
  if (['3', 'app', 'login', 'otp', 'app issue', 'login issue', 'otp issue'].includes(text)) {
    return 'app_issue';
  }
  if (['4', 'family issue', 'duty issue', 'duty/family issue'].includes(text)) return 'duty_issue';
  if (['5', 'talk', 'support', 'talk to support', 'call support'].includes(text)) {
    return 'talk_support';
  }
  return null;
}

function parseDutyType(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === SUPPORT_BUTTON_IDS.DUTY_8H) return '8h';
  if (replyId === SUPPORT_BUTTON_IDS.DUTY_24H) return '24h';

  const text = normalizeText(getMessageText(message));
  if (['1', '8', '8h', '8 hour', '8-hour', '8 hours'].includes(text)) return '8h';
  if (['2', '24', '24h', '24 hour', '24-hour', '24 hours'].includes(text)) return '24h';
  return null;
}

function parseAppIssue(message) {
  const replyId = getInteractiveReplyId(message);
  const idMap = {
    [SUPPORT_BUTTON_IDS.APP_DOWNLOAD]: 'download',
    [SUPPORT_BUTTON_IDS.APP_LOGIN]: 'login',
    [SUPPORT_BUTTON_IDS.APP_OTP]: 'otp',
    [SUPPORT_BUTTON_IDS.APP_AGENT]: 'agent'
  };
  if (idMap[replyId]) return idMap[replyId];

  const text = normalizeText(getMessageText(message));
  if (['1', 'download', 'download app', 'app download'].includes(text)) return 'download';
  if (['2', 'login', 'login issue'].includes(text)) return 'login';
  if (['3', 'otp', 'otp issue'].includes(text)) return 'otp';
  if (['4', 'agent', 'chat', 'customer care', 'chat with customer care agent', 'whatsapp support'].includes(text)) {
    return 'agent';
  }
  return null;
}

function shouldStartOver(message) {
  const text = normalizeText(getMessageText(message));
  return ['start', 'restart', 'change region', 'region', 'change role', 'wrong option'].includes(text);
}

function shouldGreet(message) {
  const text = normalizeText(getMessageText(message));
  return ['hi', 'hello', 'ഹായ്', 'നമസ്കാരം'].includes(text);
}

function shouldShowMainMenu(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === SUPPORT_BUTTON_IDS.BACK_MAIN) return true;

  const text = normalizeText(getMessageText(message));
  return ['menu', 'main menu', 'മെനു', 'മെയിൻ മെനു'].includes(text);
}

async function sendAudiencePrompt(phone) {
  await updateSession(phone, { status: SUPPORT_STATUS.AWAITING_AUDIENCE });
  // Bilingual: region is what sets the language, and it has not been asked yet.
  await sendAndLog(phone, 'buttons', {
    body: [
      'Welcome to Pulso Support.',
      'Please tell us who you are:',
      '',
      'Pulso Support-ലേക്ക് സ്വാഗതം.',
      'താങ്കൾ ആരാണെന്ന് തിരഞ്ഞെടുക്കുക:'
    ].join('\n'),
    buttons: [
      { id: SUPPORT_BUTTON_IDS.AUDIENCE_PROVIDER, title: 'Caregiver / Nurse' },
      { id: SUPPORT_BUTTON_IDS.AUDIENCE_PARTNER, title: 'Home care agency' }
    ]
  });
}

function regionPromptOptions(session = {}) {
  const partner = session.partner || {};
  return getSessionAudience(session) === AUDIENCE.PARTNER && partner.name
    ? { partnerName: partner.name }
    : {};
}

async function sendRegionPrompt(phone, options = {}) {
  await updateSession(phone, { status: SUPPORT_STATUS.AWAITING_REGION });
  const greeting = options.partnerName
    ? `Hi ${options.partnerName}\nWelcome to Pulso Partner Support.`
    : 'Hi, welcome to Pulso Provider Support.';
  await sendAndLog(phone, 'buttons', {
    body: `${greeting}\n\nPlease select your region:`,
    buttons: [
      { id: SUPPORT_BUTTON_IDS.REGION_KERALA, title: 'Kerala' },
      { id: SUPPORT_BUTTON_IDS.REGION_KARNATAKA, title: 'Karnataka' },
      { id: SUPPORT_BUTTON_IDS.REGION_OTHER, title: 'Other' }
    ]
  });
}

async function sendMainMenu(phone, language = 'en') {
  await updateSession(phone, { status: SUPPORT_STATUS.MAIN_MENU });
  await sendAndLog(phone, 'list', {
    body: isMalayalam(language)
      ? 'താങ്കൾക്ക് വേണ്ട സഹായം തിരഞ്ഞെടുക്കുക:'
      : 'Please choose an option:',
    buttonText: isMalayalam(language) ? 'Option' : 'Choose option',
    sections: [
      {
        title: 'Provider Support',
        rows: [
          { id: SUPPORT_BUTTON_IDS.MAIN_DUTY, title: 'Check Duty availability' },
          { id: SUPPORT_BUTTON_IDS.MAIN_PAYMENT, title: 'Payment help' },
          { id: SUPPORT_BUTTON_IDS.MAIN_APP, title: 'App/Login/OTP' },
          { id: SUPPORT_BUTTON_IDS.MAIN_DUTY_ISSUE, title: 'Duty/Family issue' },
          { id: SUPPORT_BUTTON_IDS.MAIN_TALK, title: 'Talk to support' },
          { id: SUPPORT_BUTTON_IDS.MAIN_JOIN, title: 'Join Pulso' }
        ]
      }
    ]
  });
}

async function sendDutyTypePrompt(phone, language = 'en') {
  await updateSession(phone, { status: SUPPORT_STATUS.AWAITING_DUTY_TYPE });
  await sendAndLog(phone, 'buttons', {
    body: isMalayalam(language)
      ? 'നിങ്ങൾ ഏത് duty availability ആണ് അറിയാൻ ആഗ്രഹിക്കുന്നത്?'
      : 'Which duty type are you looking for?',
    buttons: [
      { id: SUPPORT_BUTTON_IDS.DUTY_8H, title: '8-hour duty' },
      { id: SUPPORT_BUTTON_IDS.DUTY_24H, title: '24-hour duty' },
      { id: SUPPORT_BUTTON_IDS.BACK_MAIN, title: 'Main menu' }
    ]
  });
}

async function sendAppIssuePrompt(phone, language = 'en') {
  await updateSession(phone, { status: SUPPORT_STATUS.AWAITING_APP_ISSUE });
  await sendAndLog(phone, 'list', {
    body: isMalayalam(language)
      ? 'ദയവായി issue തിരഞ്ഞെടുക്കുക:'
      : 'Please choose the issue:',
    buttonText: isMalayalam(language) ? 'Issue' : 'Choose issue',
    sections: [
      {
        title: 'Pulso App Help',
        rows: [
          { id: SUPPORT_BUTTON_IDS.APP_DOWNLOAD, title: 'Download app' },
          { id: SUPPORT_BUTTON_IDS.APP_LOGIN, title: 'Login issue' },
          { id: SUPPORT_BUTTON_IDS.APP_OTP, title: 'OTP issue' },
          { id: SUPPORT_BUTTON_IDS.APP_AGENT, title: 'Request support' }
        ]
      }
    ]
  });
}

async function sendJoinPulso(phone, language = 'en') {
  const lines = isMalayalam(language)
    ? [
        'Pulso-യിൽ Caregiver / Nursing Staff ആയി join ചെയ്യാൻ താഴെയുള്ള registration chatbot ഉപയോഗിക്കുക:',
        '',
        config.providerSupportJoiningChatbotUrl,
        '',
        'ദയവായി registration അവിടെ complete ചെയ്യുക.'
      ]
    : [
        'To join Pulso as a Caregiver / Nursing Staff, please use our registration chatbot:',
        '',
        config.providerSupportJoiningChatbotUrl,
        '',
        'Please complete your registration there.'
      ];

  await sendAndLog(
    phone,
    'text',
    lines.join('\n')
  );
}

async function sendDutyAvailability(phone, dutyType, language = 'en') {
  await updateSession(phone, {
    status: SUPPORT_STATUS.MAIN_MENU,
    lastDutyType: dutyType
  });

  const lines = isMalayalam(language)
    ? [
        'പുതിയ duties Pulso app-ൽ ആണ് ലഭിക്കുന്നത്.',
        '',
        'ദയവായി Pulso app തുറന്ന് Offer Inbox check ചെയ്യുക.',
        '',
        appLinksMessage(language)
      ]
    : [
        'New duties are shared in the Pulso app.',
        '',
        'Please open the Pulso app and check your Offer Inbox.',
        '',
        appLinksMessage(language)
      ];

  await sendAndLog(
    phone,
    'text',
    lines.join('\n')
  );
}

async function requestHumanSupport(phone, session = {}, reason = 'general_support', options = {}) {
  const language = getSessionLanguage(session);
  const isPartner = getSessionAudience(session) === AUDIENCE.PARTNER;

  if (!canRequestSupportHelp(session, reason)) {
    if (!options.silent) {
      await sendAndLog(phone, 'text', supportHelpAlreadyRequestedMessage(language));
    }
    return;
  }

  const requestedAt = nowIso();
  const patch = {
    supportHelpRequested: true,
    supportHelpRequestedAt: requestedAt,
    supportHelpReason: reason,
    supportHelpRequests: { ...(session.supportHelpRequests || {}), [reason]: requestedAt },
    lastIntent: reason
  };

  // The partner branch sets its own next status right after this returns.
  if (!isPartner) {
    patch.status = SUPPORT_STATUS.MAIN_MENU;
  }

  const updatedSession = await updateSession(phone, patch);

  await addSessionEvent(phone, {
    type: 'system',
    event: isPartner ? 'care_partner_help_requested' : 'support_help_requested',
    reason
  });

  if (!options.silent) {
    await sendAndLog(
      phone,
      'text',
      isPartner ? partnerHelpAcceptedMessage(language) : supportHelpAcceptedMessage(language)
    );
  }

  if (isPartner) {
    await notifyCarePartnerHelpRequested(updatedSession, reason);
    return;
  }

  await notifyProviderSupportHelpRequested(updatedSession, reason);
}

/** An agency who is really a caregiver, or a pitched number that changed its mind. */
async function switchToProvider(phone, session = {}) {
  const updatedSession = await updateSession(phone, {
    audience: AUDIENCE.PROVIDER,
    partner: null
  });

  if (updatedSession.region) {
    await updateSession(phone, { status: SUPPORT_STATUS.MAIN_MENU });
    await sendMainMenu(phone, getSessionLanguage(updatedSession));
    return;
  }

  await sendRegionPrompt(phone);
}

// Passed to the care partner flow so it can talk and store without importing
// this module back.
const partnerDeps = {
  sendAndLog,
  updateSession,
  requestHumanSupport,
  switchToProvider
};

async function sendMenuForSession(phone, session = {}) {
  const partner = session.partner || {};
  if (getSessionAudience(session) === AUDIENCE.PARTNER && partner.kind && partner.kind !== PARTNER_KIND.UNKNOWN) {
    await carePartnerFlow.sendPartnerMenu(partnerDeps, phone, session);
    return;
  }

  await sendMainMenu(phone, getSessionLanguage(session));
}

async function handleAudienceSelection(phone, message, session = {}) {
  // The pitch buttons are answered from this same state.
  const pitchReply = carePartnerFlow.parsePitchReply(message);
  const selected = parseAudienceSelection(message);

  if (selected === AUDIENCE.PROVIDER || pitchReply === 'caregiver') {
    await updateSession(phone, { audience: AUDIENCE.PROVIDER, partner: null });
    await sendRegionPrompt(phone);
    return;
  }

  if (pitchReply === 'talk') {
    // An agency we could not match asking for a human is a partner lead, not a
    // provider request, so it goes to the partner manager with that said plainly.
    const updatedSession = await updateSession(phone, { audience: AUDIENCE.PARTNER });
    await requestHumanSupport(phone, updatedSession, carePartnerFlow.PARTNER_REASONS.NOT_FOUND);
    return;
  }

  if (selected === AUDIENCE.PARTNER) {
    const partner = await resolveCarePartner(phone, session.partner);

    if (partner.kind === PARTNER_KIND.UNKNOWN) {
      const updatedSession = await updateSession(phone, {
        audience: AUDIENCE.PARTNER,
        partner,
        status: SUPPORT_STATUS.AWAITING_AUDIENCE
      });
      await carePartnerFlow.sendPartnerPitch(partnerDeps, phone, updatedSession);
      return;
    }

    const updatedSession = await updateSession(phone, { audience: AUDIENCE.PARTNER, partner });
    await sendRegionPrompt(phone, regionPromptOptions(updatedSession));
    return;
  }

  await sendAudiencePrompt(phone);
}

async function handleMainMenu(phone, message, session = {}) {
  const language = getSessionLanguage(session);
  const selected = parseMainMenuSelection(message);
  if (!selected) {
    await sendAndLog(
      phone,
      'text',
      isMalayalam(language)
        ? 'ക്ഷമിക്കണം, മനസ്സിലായില്ല.\n\nദയവായി menu-യിൽ നിന്ന് ഒരു option തിരഞ്ഞെടുക്കുക.'
        : 'Sorry, I could not understand that. Please choose an option from the menu.'
    );
    await sendMainMenu(phone, language);
    return;
  }

  await updateSession(phone, { lastIntent: selected });

  if (selected === 'join') {
    await sendJoinPulso(phone, language);
    await sendMainMenu(phone, language);
    return;
  }

  if (selected === 'duty_availability') {
    if (!(await ensureRegisteredProvider(phone, language))) {
      return;
    }
    await sendDutyTypePrompt(phone, language);
    return;
  }

  if (selected === 'payment') {
    if (!(await ensureRegisteredProvider(phone, language))) {
      return;
    }
    await sendAndLog(
      phone,
      'text',
      supportPhoneMessage(
        isMalayalam(language)
          ? 'Payment related help-നായി Pulso support-നെ വിളിക്കുക:'
          : 'For payment related help, please contact Pulso support:',
        language
      )
    );
    await sendMainMenu(phone, language);
    return;
  }

  if (selected === 'app_issue') {
    await sendAppIssuePrompt(phone, language);
    return;
  }

  if (selected === 'duty_issue') {
    if (!(await ensureRegisteredProvider(phone, language))) {
      return;
    }
    await requestHumanSupport(phone, session, 'duty_family_issue');
    await sendMainMenu(phone, language);
    return;
  }

  if (selected === 'talk_support') {
    await requestHumanSupport(phone, session, 'talk_support');
    await sendMainMenu(phone, language);
  }
}

async function handleAppIssue(phone, message, session = {}) {
  const language = getSessionLanguage(session);
  const selected = parseAppIssue(message);
  if (!selected) {
    await sendAndLog(
      phone,
      'text',
      isMalayalam(language)
        ? 'ക്ഷമിക്കണം, മനസ്സിലായില്ല.\n\nദയവായി issue menu-യിൽ നിന്ന് തിരഞ്ഞെടുക്കുക.'
        : 'Sorry, I could not understand that. Please choose an issue from the menu.'
    );
    await sendAppIssuePrompt(phone, language);
    return;
  }

  await updateSession(phone, {
    status: SUPPORT_STATUS.MAIN_MENU,
    lastIntent: `app_${selected}`
  });

  if (selected === 'download') {
    await sendAndLog(phone, 'text', appLinksMessage(language));
    await sendMainMenu(phone, language);
    return;
  }

  if (selected === 'agent') {
    await requestHumanSupport(phone, session, 'app_chat_with_agent');
    await sendMainMenu(phone, language);
    return;
  }

  await requestHumanSupport(phone, session, `app_${selected}`);
  await sendMainMenu(phone, language);
}

async function processProviderSupportMessage(phone, message) {
  await addSessionEvent(phone, {
    type: 'inbound_message',
    messageId: message.id || null,
    payload: {
      type: message.type || null,
      text: getMessageText(message) || null,
      interactiveReplyId: getInteractiveReplyId(message)
    }
  });

  const session = await getSession(phone);
  if (!session || shouldStartOver(message)) {
    if (config.partnerHelpEnabled) {
      await sendAudiencePrompt(phone);
      return;
    }
    await sendRegionPrompt(phone);
    return;
  }

  const audience = getSessionAudience(session);

  if (session.status === SUPPORT_STATUS.AWAITING_AUDIENCE) {
    if (!config.partnerHelpEnabled) {
      await sendRegionPrompt(phone);
      return;
    }
    await handleAudienceSelection(phone, message, session);
    return;
  }

  const language = getSessionLanguage(session);

  if (shouldGreet(message) && session.region && session.status !== SUPPORT_STATUS.AWAITING_REGION) {
    await sendMenuForSession(phone, session);
    return;
  }

  if (shouldShowMainMenu(message)) {
    await sendMenuForSession(phone, session);
    return;
  }

  if (session.status === SUPPORT_STATUS.AWAITING_REGION) {
    const region = parseRegionSelection(message);
    if (!region) {
      await sendRegionPrompt(phone, regionPromptOptions(session));
      return;
    }

    const selectedLanguage = region === 'kerala' ? 'ml' : 'en';
    const updatedSession = await updateSession(phone, {
      region,
      language: selectedLanguage,
      status: SUPPORT_STATUS.MAIN_MENU
    });

    if (audience === AUDIENCE.PARTNER) {
      await carePartnerFlow.startPartnerBranch(partnerDeps, phone, updatedSession);
      return;
    }

    await sendMainMenu(phone, selectedLanguage);
    return;
  }

  if (audience === AUDIENCE.PARTNER) {
    if (session.status === SUPPORT_STATUS.AWAITING_PARTNER_APP_ISSUE) {
      await carePartnerFlow.handlePartnerAppIssue(partnerDeps, phone, message, session);
      return;
    }

    await carePartnerFlow.handlePartnerTopic(partnerDeps, phone, message, session);
    return;
  }

  if (session.status === SUPPORT_STATUS.AWAITING_DUTY_TYPE) {
    const dutyType = parseDutyType(message);
    if (!dutyType) {
      await sendAndLog(
        phone,
        'text',
        isMalayalam(language)
          ? 'ദയവായി 8-hour duty അല്ലെങ്കിൽ 24-hour duty തിരഞ്ഞെടുക്കുക.'
          : 'Please choose 8-hour duty or 24-hour duty.'
      );
      await sendDutyTypePrompt(phone, language);
      return;
    }

    await sendDutyAvailability(phone, dutyType, language);
    await sendMainMenu(phone, language);
    return;
  }

  if (session.status === SUPPORT_STATUS.AWAITING_APP_ISSUE) {
    await handleAppIssue(phone, message, session);
    return;
  }

  await handleMainMenu(phone, message, session);
}

module.exports = {
  AUDIENCE,
  SUPPORT_BUTTON_IDS,
  SUPPORT_STATUS,
  canRequestSupportHelp,
  getSessionAudience,
  parseAudienceSelection,
  processProviderSupportMessage
};
