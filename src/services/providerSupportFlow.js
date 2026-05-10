const config = require('../config');
const { getFirestore } = require('./storage');
const { sendText, sendButtons, sendList } = require('./metaClient');
const { getInteractiveReplyId, getMessageText, normalizeText } = require('./messageParser');

const COLLECTION = 'providerSupportSessions';

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

function appLinksMessage() {
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

function supportPhoneMessage(prefix) {
  return [
    prefix,
    '',
    config.providerSupportPhone,
    '',
    'Available time:',
    '10:00 AM to 5:00 PM'
  ].join('\n');
}

function supportPhoneAndAgentMessage(prefix) {
  return [
    supportPhoneMessage(prefix),
    '',
    'You can also chat with our customer care agent here:',
    config.providerSupportCustomerCareWhatsappUrl
  ].join('\n');
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
  if (['1', 'join', 'joining', 'register', 'registration', 'new registration'].includes(text)) {
    return 'join';
  }
  if (['2', 'duty', 'duty availability', 'check duty', 'offer', 'offers'].includes(text)) {
    return 'duty_availability';
  }
  if (['3', 'payment', 'payment help', 'salary'].includes(text)) return 'payment';
  if (['4', 'app', 'login', 'otp', 'app issue', 'login issue', 'otp issue'].includes(text)) {
    return 'app_issue';
  }
  if (['5', 'family issue', 'duty issue', 'duty/family issue'].includes(text)) return 'duty_issue';
  if (['6', 'talk', 'support', 'talk to support', 'call support'].includes(text)) {
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
  if (['4', 'agent', 'chat', 'customer care', 'chat with customer care agent'].includes(text)) {
    return 'agent';
  }
  return null;
}

function shouldStartOver(message) {
  const text = normalizeText(getMessageText(message));
  return ['hi', 'hello', 'start', 'restart'].includes(text);
}

function shouldShowMainMenu(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === SUPPORT_BUTTON_IDS.BACK_MAIN) return true;

  const text = normalizeText(getMessageText(message));
  return ['menu', 'main menu'].includes(text);
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

async function sendMainMenu(phone) {
  await updateSession(phone, { status: SUPPORT_STATUS.MAIN_MENU });
  await sendAndLog(phone, 'list', {
    body: 'Please choose an option:',
    buttonText: 'Choose option',
    sections: [
      {
        title: 'Provider Support',
        rows: [
          { id: SUPPORT_BUTTON_IDS.MAIN_JOIN, title: 'Join Pulso' },
          { id: SUPPORT_BUTTON_IDS.MAIN_DUTY, title: 'Duty availability' },
          { id: SUPPORT_BUTTON_IDS.MAIN_PAYMENT, title: 'Payment help' },
          { id: SUPPORT_BUTTON_IDS.MAIN_APP, title: 'App/Login/OTP' },
          { id: SUPPORT_BUTTON_IDS.MAIN_DUTY_ISSUE, title: 'Duty/Family issue' },
          { id: SUPPORT_BUTTON_IDS.MAIN_TALK, title: 'Talk to support' }
        ]
      }
    ]
  });
}

async function sendDutyTypePrompt(phone) {
  await updateSession(phone, { status: SUPPORT_STATUS.AWAITING_DUTY_TYPE });
  await sendAndLog(phone, 'buttons', {
    body: 'Which duty type are you looking for?',
    buttons: [
      { id: SUPPORT_BUTTON_IDS.DUTY_8H, title: '8-hour duty' },
      { id: SUPPORT_BUTTON_IDS.DUTY_24H, title: '24-hour duty' },
      { id: SUPPORT_BUTTON_IDS.BACK_MAIN, title: 'Main menu' }
    ]
  });
}

async function sendAppIssuePrompt(phone) {
  await updateSession(phone, { status: SUPPORT_STATUS.AWAITING_APP_ISSUE });
  await sendAndLog(phone, 'list', {
    body: 'Please choose the issue:',
    buttonText: 'Choose issue',
    sections: [
      {
        title: 'Pulso App Help',
        rows: [
          { id: SUPPORT_BUTTON_IDS.APP_DOWNLOAD, title: 'Download app' },
          { id: SUPPORT_BUTTON_IDS.APP_LOGIN, title: 'Login issue' },
          { id: SUPPORT_BUTTON_IDS.APP_OTP, title: 'OTP issue' },
          { id: SUPPORT_BUTTON_IDS.APP_AGENT, title: 'Chat with agent' }
        ]
      }
    ]
  });
}

async function sendJoinPulso(phone) {
  await sendAndLog(
    phone,
    'text',
    [
      'To join Pulso as a Caregiver / Nursing Staff, please use our registration chatbot:',
      '',
      config.providerSupportJoiningChatbotUrl,
      '',
      'Please complete your registration there.'
    ].join('\n')
  );
}

async function sendDutyAvailability(phone, dutyType) {
  await updateSession(phone, {
    status: SUPPORT_STATUS.MAIN_MENU,
    lastDutyType: dutyType
  });
  await sendAndLog(
    phone,
    'text',
    [
      'New duties are shared in the Pulso app.',
      '',
      'Please open the Pulso app and check your Offer Inbox.',
      '',
      appLinksMessage()
    ].join('\n')
  );
}

async function handleMainMenu(phone, message) {
  const selected = parseMainMenuSelection(message);
  if (!selected) {
    await sendAndLog(phone, 'text', 'Sorry, I could not understand that. Please choose an option from the menu.');
    await sendMainMenu(phone);
    return;
  }

  await updateSession(phone, { lastIntent: selected });

  if (selected === 'join') {
    await sendJoinPulso(phone);
    await sendMainMenu(phone);
    return;
  }

  if (selected === 'duty_availability') {
    await sendDutyTypePrompt(phone);
    return;
  }

  if (selected === 'payment') {
    await sendAndLog(phone, 'text', supportPhoneMessage('For payment related help, please contact Pulso support:'));
    await sendMainMenu(phone);
    return;
  }

  if (selected === 'app_issue') {
    await sendAppIssuePrompt(phone);
    return;
  }

  if (selected === 'duty_issue') {
    await sendAndLog(
      phone,
      'text',
      supportPhoneAndAgentMessage('For duty issue or family issue, please contact Pulso support:')
    );
    await sendMainMenu(phone);
    return;
  }

  if (selected === 'talk_support') {
    await sendAndLog(phone, 'text', supportPhoneMessage('Please contact Pulso support:'));
    await sendMainMenu(phone);
  }
}

async function handleAppIssue(phone, message) {
  const selected = parseAppIssue(message);
  if (!selected) {
    await sendAndLog(phone, 'text', 'Sorry, I could not understand that. Please choose an issue from the menu.');
    await sendAppIssuePrompt(phone);
    return;
  }

  await updateSession(phone, {
    status: SUPPORT_STATUS.MAIN_MENU,
    lastIntent: `app_${selected}`
  });

  if (selected === 'download') {
    await sendAndLog(phone, 'text', appLinksMessage());
    await sendMainMenu(phone);
    return;
  }

  if (selected === 'agent') {
    await sendAndLog(
      phone,
      'text',
      ['You can chat with our customer care agent here:', config.providerSupportCustomerCareWhatsappUrl].join('\n')
    );
    await sendMainMenu(phone);
    return;
  }

  await sendAndLog(
    phone,
    'text',
    supportPhoneAndAgentMessage('For Pulso App / Login / OTP issue, please contact Pulso support:')
  );
  await sendMainMenu(phone);
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

  if (shouldShowMainMenu(message)) {
    await sendMainMenu(phone);
    return;
  }

  if (session.status === SUPPORT_STATUS.AWAITING_REGION) {
    const region = parseRegionSelection(message);
    if (!region) {
      await sendAndLog(phone, 'text', 'Please select your region from the options.');
      await sendRegionPrompt(phone);
      return;
    }

    await updateSession(phone, {
      region,
      status: SUPPORT_STATUS.MAIN_MENU
    });
    await sendMainMenu(phone);
    return;
  }

  if (session.status === SUPPORT_STATUS.AWAITING_DUTY_TYPE) {
    const dutyType = parseDutyType(message);
    if (!dutyType) {
      await sendAndLog(phone, 'text', 'Please choose 8-hour duty or 24-hour duty.');
      await sendDutyTypePrompt(phone);
      return;
    }

    await sendDutyAvailability(phone, dutyType);
    await sendMainMenu(phone);
    return;
  }

  if (session.status === SUPPORT_STATUS.AWAITING_APP_ISSUE) {
    await handleAppIssue(phone, message);
    return;
  }

  await handleMainMenu(phone, message);
}

module.exports = {
  SUPPORT_BUTTON_IDS,
  SUPPORT_STATUS,
  processProviderSupportMessage
};
