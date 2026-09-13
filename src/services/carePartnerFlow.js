const config = require('../config');
const { getInteractiveReplyId, getMessageText, normalizeText } = require('./messageParser');
const { PARTNER_KIND } = require('./carePartnerService');

const PARTNER_STATUS = {
  AWAITING_TOPIC: 'awaiting_partner_topic',
  AWAITING_APP_ISSUE: 'awaiting_partner_app_issue'
};

const PARTNER_BUTTON_IDS = {
  TOPIC_PAYOUT: 'pp_topic_payout',
  TOPIC_CLIENTS: 'pp_topic_clients',
  TOPIC_APP: 'pp_topic_app',
  TOPIC_DUTY: 'pp_topic_duty',
  TOPIC_TALK: 'pp_topic_talk',
  TOPIC_CAREGIVER: 'pp_topic_caregiver',
  APP_CONSOLE: 'pp_app_console',
  APP_LOGIN: 'pp_app_login',
  APP_OTP: 'pp_app_otp',
  APP_AGENT: 'pp_app_agent',
  BACK_PARTNER: 'pp_back_partner',
  PITCH_CAREGIVER: 'pp_pitch_caregiver',
  PITCH_TALK: 'pp_pitch_talk'
};

const PARTNER_REASONS = {
  PAYOUT: 'partner_payout',
  CLIENTS: 'partner_client_status',
  LOGIN: 'partner_app_login',
  OTP: 'partner_app_otp',
  APP_AGENT: 'partner_app_agent',
  DUTY: 'partner_duty_issue',
  TALK: 'partner_talk',
  ONBOARDING: 'partner_onboarding',
  NOT_FOUND: 'partner_not_found'
};

function isMalayalam(language) {
  return language === 'ml';
}

function ordinal(day) {
  const value = Number(day) || 0;
  if (!value) return '';
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const ones = value % 10;
  if (ones === 1) return `${value}st`;
  if (ones === 2) return `${value}nd`;
  if (ones === 3) return `${value}rd`;
  return `${value}th`;
}

function partnerName(session = {}) {
  const partner = session.partner || {};
  return partner.name || 'your agency';
}

function supportPhone() {
  return config.partnerSupportPhone || config.providerSupportPhone;
}

/* -------------------------------------------------------------- parsing --- */

function parsePartnerTopic(message) {
  const replyId = getInteractiveReplyId(message);
  const idMap = {
    [PARTNER_BUTTON_IDS.TOPIC_PAYOUT]: 'payout',
    [PARTNER_BUTTON_IDS.TOPIC_CLIENTS]: 'clients',
    [PARTNER_BUTTON_IDS.TOPIC_APP]: 'app',
    [PARTNER_BUTTON_IDS.TOPIC_DUTY]: 'duty',
    [PARTNER_BUTTON_IDS.TOPIC_TALK]: 'talk',
    [PARTNER_BUTTON_IDS.TOPIC_CAREGIVER]: 'caregiver'
  };
  if (idMap[replyId]) return idMap[replyId];

  const text = normalizeText(getMessageText(message));
  if (['1', 'payout', 'payment', 'settlement', 'invoice', 'money'].includes(text)) return 'payout';
  if (['2', 'client', 'clients', 'booking', 'booking status', 'client status'].includes(text)) return 'clients';
  if (['3', 'app', 'console', 'login', 'otp', 'app login'].includes(text)) return 'app';
  if (['4', 'duty', 'duty issue', 'caregiver issue', 'staff issue', 'replacement'].includes(text)) return 'duty';
  if (['5', 'talk', 'manager', 'partner manager', 'support'].includes(text)) return 'talk';
  if (['6', 'caregiver', 'nurse', 'provider'].includes(text)) return 'caregiver';
  return null;
}

function parsePartnerAppIssue(message) {
  const replyId = getInteractiveReplyId(message);
  const idMap = {
    [PARTNER_BUTTON_IDS.APP_CONSOLE]: 'console',
    [PARTNER_BUTTON_IDS.APP_LOGIN]: 'login',
    [PARTNER_BUTTON_IDS.APP_OTP]: 'otp',
    [PARTNER_BUTTON_IDS.APP_AGENT]: 'agent',
    [PARTNER_BUTTON_IDS.BACK_PARTNER]: 'back'
  };
  if (idMap[replyId]) return idMap[replyId];

  const text = normalizeText(getMessageText(message));
  if (['1', 'console', 'open console', 'partner console', 'link'].includes(text)) return 'console';
  if (['2', 'login', 'login issue', 'sign in'].includes(text)) return 'login';
  if (['3', 'otp', 'otp issue', 'otp not received'].includes(text)) return 'otp';
  if (['4', 'agent', 'support', 'request support'].includes(text)) return 'agent';
  if (['5', 'back', 'partner menu', 'menu'].includes(text)) return 'back';
  return null;
}

function parsePitchReply(message) {
  const replyId = getInteractiveReplyId(message);
  if (replyId === PARTNER_BUTTON_IDS.PITCH_CAREGIVER) return 'caregiver';
  if (replyId === PARTNER_BUTTON_IDS.PITCH_TALK) return 'talk';

  const text = normalizeText(getMessageText(message));
  if (['caregiver', 'nurse', 'i am a caregiver', "i'm a caregiver", 'provider'].includes(text)) {
    return 'caregiver';
  }
  if (['talk', 'talk to support', 'support', 'already a partner'].includes(text)) return 'talk';
  return null;
}

/* -------------------------------------------------------------- messages --- */

function partnerMenuRows() {
  return [
    { id: PARTNER_BUTTON_IDS.TOPIC_PAYOUT, title: 'Payout & settlement' },
    { id: PARTNER_BUTTON_IDS.TOPIC_CLIENTS, title: 'Client & booking status' },
    { id: PARTNER_BUTTON_IDS.TOPIC_APP, title: 'Console / app login' },
    { id: PARTNER_BUTTON_IDS.TOPIC_DUTY, title: 'Caregiver / duty issue' },
    { id: PARTNER_BUTTON_IDS.TOPIC_TALK, title: 'Talk to partner manager' },
    { id: PARTNER_BUTTON_IDS.TOPIC_CAREGIVER, title: 'I am a caregiver' }
  ];
}

async function sendPartnerMenu(deps, phone, session = {}) {
  const language = session.language;
  await deps.updateSession(phone, { status: PARTNER_STATUS.AWAITING_TOPIC });
  await deps.sendAndLog(phone, 'list', {
    body: isMalayalam(language)
      ? 'താങ്കൾക്ക് വേണ്ട സഹായം തിരഞ്ഞെടുക്കുക:'
      : 'Please choose an option:',
    buttonText: isMalayalam(language) ? 'Option' : 'Choose option',
    sections: [{ title: 'Partner Support', rows: partnerMenuRows() }]
  });
}

async function sendPartnerAppIssuePrompt(deps, phone, session = {}) {
  const language = session.language;
  await deps.updateSession(phone, { status: PARTNER_STATUS.AWAITING_APP_ISSUE });
  await deps.sendAndLog(phone, 'list', {
    body: isMalayalam(language) ? 'ദയവായി issue തിരഞ്ഞെടുക്കുക:' : 'Please choose the issue:',
    buttonText: isMalayalam(language) ? 'Issue' : 'Choose issue',
    sections: [
      {
        title: 'Partner Console Help',
        rows: [
          { id: PARTNER_BUTTON_IDS.APP_CONSOLE, title: 'Open partner console' },
          { id: PARTNER_BUTTON_IDS.APP_LOGIN, title: 'Login issue' },
          { id: PARTNER_BUTTON_IDS.APP_OTP, title: 'OTP not received' },
          { id: PARTNER_BUTTON_IDS.APP_AGENT, title: 'Request support' },
          { id: PARTNER_BUTTON_IDS.BACK_PARTNER, title: 'Partner menu' }
        ]
      }
    ]
  });
}

function payoutMessage(session = {}) {
  const partner = session.partner || {};
  const language = session.language;
  const day = ordinal(partner.billingDay);
  const share = Number.isFinite(Number(partner.partnerPct)) && partner.partnerPct !== null
    ? `${partner.partnerPct}%`
    : '';

  if (isMalayalam(language)) {
    return [
      `${partnerName(session)} — settlement വിവരങ്ങൾ`,
      '',
      day ? `Settlement day: എല്ലാ മാസവും ${day}` : 'Settlement day: partner team confirm ചെയ്യും',
      share ? `താങ്കളുടെ share: ${share}` : null,
      partner.gstRegistered
        ? 'GST: registered — invoice-ൽ GST ഉൾപ്പെടും'
        : 'GST: registered അല്ല',
      '',
      'ഒരു പ്രത്യേക invoice-നെക്കുറിച്ചോ, എത്താത്ത payment-നെക്കുറിച്ചോ ആണെങ്കിൽ താഴെ tap ചെയ്യുക.'
    ].filter((line) => line !== null).join('\n');
  }

  return [
    `${partnerName(session)} — settlement summary`,
    '',
    day ? `Settlement day: ${day} of each month` : 'Settlement day: the partner team will confirm this',
    share ? `Your share: ${share}` : null,
    partner.gstRegistered
      ? 'GST: registered, so your invoice includes GST'
      : 'GST: not registered',
    '',
    'For a specific invoice or a payment that has not arrived, tap below.'
  ].filter((line) => line !== null).join('\n');
}

function clientStatusMessage(session = {}) {
  const language = session.language;
  if (isMalayalam(language)) {
    return [
      'താങ്കൾ Pulso-യിലേക്ക് അയച്ച client-കളും ഓരോ booking എവിടെ എത്തി എന്നതും Pulso Partner console-ൽ കാണാം:',
      '',
      config.partnerConsoleUrl,
      '',
      'ഒരു പ്രത്യേക client-നെക്കുറിച്ച് ആണെങ്കിൽ താഴെ tap ചെയ്യുക.'
    ].join('\n');
  }

  return [
    'Every client you sent to Pulso, and where each booking has reached, is in your Pulso Partner console:',
    '',
    config.partnerConsoleUrl,
    '',
    'For a specific client, tap below.'
  ].join('\n');
}

function consoleLinkMessage(session = {}) {
  const language = session.language;
  const lines = isMalayalam(language)
    ? ['Pulso Partner console:', config.partnerConsoleUrl, '', 'Pulso app download links', '']
    : ['Pulso Partner console:', config.partnerConsoleUrl, '', 'Pulso app download links', ''];

  return lines
    .concat(['Android:', config.providerSupportAndroidAppUrl, '', 'iPhone:', config.providerSupportIosAppUrl])
    .join('\n');
}

function pitchMessage(language) {
  if (isMalayalam(language)) {
    return [
      'ഈ help line Pulso-യുമായി ഇതിനകം partner ആയ home care agency-കൾക്കുള്ളതാണ്.',
      '',
      'Pulso-യുമായി partner ആകാൻ താല്പര്യമുണ്ടോ? ഇവിടെ തുടങ്ങുക:',
      config.partnerJoinUrl,
      '',
      'ഇതിനകം partner ആണോ? "Talk to support" tap ചെയ്യുക, ഞങ്ങൾ പരിശോധിക്കാം.'
    ].join('\n');
  }

  return [
    'This help line is for home care agencies already partnered with Pulso.',
    '',
    'Want to partner with Pulso? Start here:',
    config.partnerJoinUrl,
    '',
    'Already a partner? Tap Talk to support and we will check.'
  ].join('\n');
}

function prospectHoldMessage(session = {}) {
  const language = session.language;
  if (isMalayalam(language)) {
    return [
      `${partnerName(session)} — താങ്കളുടെ Pulso partner account ഇപ്പോഴും set up ചെയ്തുകൊണ്ടിരിക്കുകയാണ്.`,
      '',
      'ഞങ്ങളുടെ partner team-നെ അറിയിച്ചിട്ടുണ്ട്. അവർ താങ്കളെ ബന്ധപ്പെടും.',
      '',
      'Urgent help-നായി വിളിക്കുക:',
      supportPhone()
    ].join('\n');
  }

  return [
    `${partnerName(session)} — your Pulso partner account is still being set up.`,
    '',
    'Our partner team has been informed and will contact you.',
    '',
    'For urgent help, call:',
    supportPhone()
  ].join('\n');
}

/* -------------------------------------------------------------- handlers --- */

/** An agency we have no trading record of: pitched, never dead-ended. */
async function sendPartnerPitch(deps, phone, session = {}) {
  await deps.sendAndLog(phone, 'buttons', {
    body: pitchMessage(session.language),
    buttons: [
      { id: PARTNER_BUTTON_IDS.PITCH_CAREGIVER, title: 'I am a caregiver' },
      { id: PARTNER_BUTTON_IDS.PITCH_TALK, title: 'Talk to support' }
    ]
  });
}

/** A signed-up-but-not-trading agency: held, and ops is told once. */
async function sendProspectHold(deps, phone, session = {}) {
  await deps.sendAndLog(phone, 'text', prospectHoldMessage(session));
  await deps.requestHumanSupport(phone, session, PARTNER_REASONS.ONBOARDING, { silent: true });
  await sendPartnerMenu(deps, phone, session);
}

async function handlePartnerTopic(deps, phone, message, session = {}) {
  const language = session.language;
  const selected = parsePartnerTopic(message);

  if (!selected) {
    await deps.sendAndLog(
      phone,
      'text',
      isMalayalam(language)
        ? 'ക്ഷമിക്കണം, മനസ്സിലായില്ല.\n\nദയവായി menu-യിൽ നിന്ന് ഒരു option തിരഞ്ഞെടുക്കുക.'
        : 'Sorry, I could not understand that. Please choose an option from the menu.'
    );
    await sendPartnerMenu(deps, phone, session);
    return;
  }

  await deps.updateSession(phone, { lastIntent: `partner_${selected}` });

  if (selected === 'caregiver') {
    await deps.switchToProvider(phone, session);
    return;
  }

  if (selected === 'payout') {
    await deps.sendAndLog(phone, 'buttons', {
      body: payoutMessage(session),
      buttons: [
        { id: PARTNER_BUTTON_IDS.TOPIC_TALK, title: 'Talk to manager' },
        { id: PARTNER_BUTTON_IDS.BACK_PARTNER, title: 'Partner menu' }
      ]
    });
    return;
  }

  if (selected === 'clients') {
    await deps.sendAndLog(phone, 'buttons', {
      body: clientStatusMessage(session),
      buttons: [
        { id: PARTNER_BUTTON_IDS.TOPIC_TALK, title: 'Talk to manager' },
        { id: PARTNER_BUTTON_IDS.BACK_PARTNER, title: 'Partner menu' }
      ]
    });
    return;
  }

  if (selected === 'app') {
    await sendPartnerAppIssuePrompt(deps, phone, session);
    return;
  }

  if (selected === 'duty') {
    await deps.requestHumanSupport(phone, session, PARTNER_REASONS.DUTY);
    await sendPartnerMenu(deps, phone, session);
    return;
  }

  if (selected === 'talk') {
    await deps.requestHumanSupport(phone, session, PARTNER_REASONS.TALK);
    await sendPartnerMenu(deps, phone, session);
  }
}

async function handlePartnerAppIssue(deps, phone, message, session = {}) {
  const language = session.language;
  const selected = parsePartnerAppIssue(message);

  if (!selected) {
    await deps.sendAndLog(
      phone,
      'text',
      isMalayalam(language)
        ? 'ക്ഷമിക്കണം, മനസ്സിലായില്ല.\n\nദയവായി issue menu-യിൽ നിന്ന് തിരഞ്ഞെടുക്കുക.'
        : 'Sorry, I could not understand that. Please choose an issue from the menu.'
    );
    await sendPartnerAppIssuePrompt(deps, phone, session);
    return;
  }

  await deps.updateSession(phone, { lastIntent: `partner_app_${selected}` });

  if (selected === 'back') {
    await sendPartnerMenu(deps, phone, session);
    return;
  }

  if (selected === 'console') {
    await deps.sendAndLog(phone, 'text', consoleLinkMessage(session));
    await sendPartnerMenu(deps, phone, session);
    return;
  }

  const reason =
    selected === 'login'
      ? PARTNER_REASONS.LOGIN
      : selected === 'otp'
        ? PARTNER_REASONS.OTP
        : PARTNER_REASONS.APP_AGENT;

  await deps.requestHumanSupport(phone, session, reason);
  await sendPartnerMenu(deps, phone, session);
}

/** Entry after a number has been classified against pulso-hub. */
async function startPartnerBranch(deps, phone, session = {}) {
  const partner = session.partner || {};
  if (partner.kind === PARTNER_KIND.PROSPECT) {
    await sendProspectHold(deps, phone, session);
    return;
  }
  await sendPartnerMenu(deps, phone, session);
}

module.exports = {
  PARTNER_STATUS,
  PARTNER_BUTTON_IDS,
  PARTNER_REASONS,
  ordinal,
  parsePartnerTopic,
  parsePartnerAppIssue,
  parsePitchReply,
  payoutMessage,
  pitchMessage,
  sendPartnerMenu,
  sendPartnerAppIssuePrompt,
  sendPartnerPitch,
  sendProspectHold,
  startPartnerBranch,
  handlePartnerTopic,
  handlePartnerAppIssue
};
