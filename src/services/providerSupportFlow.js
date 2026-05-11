const config = require('../config');
const { getFirestore } = require('./storage');
const { sendText, sendButtons, sendList } = require('./metaClient');
const { getInteractiveReplyId, getMessageText, normalizeText } = require('./messageParser');
const { notifyProviderSupportHelpRequested } = require('./providerSupportNotifications');

const COLLECTION = 'providerSupportSessions';
const SUPPORT_HELP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const SUPPORT_STATUS = {
  AWAITING_REGION: 'awaiting_region',
  MAIN_MENU: 'main_menu',
  AWAITING_DUTY_TYPE: 'awaiting_duty_type',
  AWAITING_APP_ISSUE: 'awaiting_app_issue'
};

const SUPPORT_BUTTON_IDS = {
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

function getSupportHelpCooldownRemainingMs(session) {
  const requestedAt =
    session && session.supportHelpRequestedAt ? Date.parse(session.supportHelpRequestedAt) : NaN;
  if (!requestedAt) {
    return 0;
  }

  const remainingMs = SUPPORT_HELP_COOLDOWN_MS - (Date.now() - requestedAt);
  return remainingMs > 0 ? remainingMs : 0;
}

function canRequestSupportHelp(session) {
  return getSupportHelpCooldownRemainingMs(session) === 0;
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

function supportHelpAlreadyRequestedMessage(language = 'en') {
  return isMalayalam(language)
    ? 'ഞങ്ങളുടെ support team-നെ ഇതിനകം അറിയിച്ചിട്ടുണ്ട്. സഹായം ലഭിക്കാത്ത പക്ഷം 12 മണിക്കൂറിന് ശേഷം വീണ്ടും request ചെയ്യാം.'
    : 'Our support team has already been informed. If you do not get help, you can request again after 12 hours.';
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
  return ['start', 'restart', 'change region', 'region'].includes(text);
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

async function sendRegionPrompt(phone) {
  await updateSession(phone, { status: SUPPORT_STATUS.AWAITING_REGION });
  await sendAndLog(phone, 'buttons', {
    body: 'Hi, welcome to Pulso Provider Support.\n\nPlease select your region:',
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

async function requestHumanSupport(phone, session = {}, reason = 'general_support') {
  const language = getSessionLanguage(session);

  if (!canRequestSupportHelp(session)) {
    await sendAndLog(phone, 'text', supportHelpAlreadyRequestedMessage(language));
    return;
  }

  const updatedSession = await updateSession(phone, {
    status: SUPPORT_STATUS.MAIN_MENU,
    supportHelpRequested: true,
    supportHelpRequestedAt: nowIso(),
    supportHelpReason: reason,
    lastIntent: reason
  });

  await addSessionEvent(phone, {
    type: 'system',
    event: 'support_help_requested',
    reason
  });

  await sendAndLog(phone, 'text', supportHelpAcceptedMessage(language));
  await notifyProviderSupportHelpRequested(updatedSession, reason);
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
    await sendDutyTypePrompt(phone, language);
    return;
  }

  if (selected === 'payment') {
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
    await sendRegionPrompt(phone);
    return;
  }

  const language = getSessionLanguage(session);

  if (shouldGreet(message) && session.region && session.status !== SUPPORT_STATUS.AWAITING_REGION) {
    await sendMainMenu(phone, language);
    return;
  }

  if (shouldShowMainMenu(message)) {
    await sendMainMenu(phone, language);
    return;
  }

  if (session.status === SUPPORT_STATUS.AWAITING_REGION) {
    const region = parseRegionSelection(message);
    if (!region) {
      await sendRegionPrompt(phone);
      return;
    }

    const selectedLanguage = region === 'kerala' ? 'ml' : 'en';
    await updateSession(phone, {
      region,
      language: selectedLanguage,
      status: SUPPORT_STATUS.MAIN_MENU
    });
    await sendMainMenu(phone, selectedLanguage);
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
  SUPPORT_BUTTON_IDS,
  SUPPORT_STATUS,
  processProviderSupportMessage
};
