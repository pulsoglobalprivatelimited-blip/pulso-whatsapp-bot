// Agency support on the support number (founder, 5 Nov 2026; plan
// senior/agency_support_via_bot_plan.md, mockup claude.ai/artifact/1Mw9fg7Km2segDaGdoMpVS).
// The apps no longer show a phone number. "Chat with Pulso support" opens this
// chat with "AGENCY SUPPORT · <agency name>" typed in. The bot asks the
// language once, shows five topics, takes the problem (text and/or photo),
// tells the agency when we will reply, and alerts the founder on WhatsApp.
// Our reply goes back from the support desk (/admin/provider-support).
// Every function takes its senders and stores in `deps`, so tests need no
// Meta or Firestore.

const { getInteractiveReplyId, getMessageText, normalizeText } = require('./messageParser');

const STATUS = {
  LANGUAGE: 'agency_support_language',
  MENU: 'agency_support_menu',
  ISSUE: 'agency_support_issue',
  OPEN: 'agency_support_open'
};

const IDS = {
  LANG_EN: 'as_lang_en',
  LANG_ML: 'as_lang_ml',
  TOPIC_BOOKING: 'as_topic_booking',
  TOPIC_CAREGIVER: 'as_topic_caregiver',
  TOPIC_APP: 'as_topic_app',
  TOPIC_PAYMENT: 'as_topic_payment',
  TOPIC_OTHER: 'as_topic_other'
};

const TOPICS = [
  { id: IDS.TOPIC_BOOKING, key: 'booking', en: 'A booking or a client', ml: 'ബുക്കിംഗ് / ക്ലയന്റ്' },
  { id: IDS.TOPIC_CAREGIVER, key: 'caregiver', en: 'A caregiver or a duty', ml: 'കെയർഗിവർ / ഡ്യൂട്ടി' },
  { id: IDS.TOPIC_APP, key: 'app', en: 'App or login problem', ml: 'ആപ്പ് / ലോഗിൻ പ്രശ്നം' },
  { id: IDS.TOPIC_PAYMENT, key: 'payment', en: 'Payments and bills', ml: 'പേയ്മെന്റ് / ബിൽ' },
  { id: IDS.TOPIC_OTHER, key: 'other', en: 'Something else', ml: 'മറ്റെന്തെങ്കിലും' }
];

// More messages inside this window join the open request; no second alert.
const OPEN_WINDOW_MS = 12 * 60 * 60 * 1000;
// We promise a reply within 2 hours between 9 am and 7 pm IST.
const REPLY_FROM_HOUR = 9;
const REPLY_UNTIL_HOUR = 19;
const IST_OFFSET_MS = 330 * 60 * 1000;

const START_RE = /^\s*agency\s+support\b/i;

function isStartMessage(message) {
  return START_RE.test(getMessageText(message) || '');
}

function isAgencyStatus(status) {
  return Object.values(STATUS).includes(status);
}

/** "AGENCY SUPPORT · Grace Home Care" → "Grace Home Care" (the app types it). */
function agencyNameFromText(text) {
  const rest = String(text || '').replace(START_RE, '').replace(/^[\s·•:|\-–—]+/, '').trim();
  return rest.replace(/\s+/g, ' ').slice(0, 60);
}

function parseLanguage(message) {
  const id = getInteractiveReplyId(message);
  if (id === IDS.LANG_EN) return 'en';
  if (id === IDS.LANG_ML) return 'ml';
  const text = normalizeText(getMessageText(message));
  if (['english', 'eng', 'en', '1'].includes(text)) return 'en';
  if (['malayalam', 'മലയാളം', 'ml', '2'].includes(text)) return 'ml';
  return null;
}

function parseTopic(message) {
  const id = getInteractiveReplyId(message);
  const byId = TOPICS.find((t) => t.id === id);
  if (byId) return byId;
  const text = normalizeText(getMessageText(message));
  const n = Number(text);
  if (Number.isInteger(n) && n >= 1 && n <= TOPICS.length) return TOPICS[n - 1];
  return TOPICS.find((t) => normalizeText(t.en) === text || normalizeText(t.ml) === text) || null;
}

function wantsMenu(message) {
  const text = normalizeText(getMessageText(message));
  return ['menu', 'hi', 'hello', 'മെനു', 'ഹായ്', 'നമസ്കാരം'].includes(text);
}

/** The problem she sent: words and/or a photo or file. Null if nothing usable. */
function issueFromMessage(message) {
  if (!message) return null;
  if (message.type === 'image' && message.image) {
    return { text: String(message.image.caption || '').trim(), mediaId: message.image.id || null, mediaType: 'image' };
  }
  if (message.type === 'document' && message.document) {
    return { text: String(message.document.caption || '').trim(), mediaId: message.document.id || null, mediaType: 'document' };
  }
  if (getInteractiveReplyId(message)) return null;
  const text = String(getMessageText(message) || '').trim();
  return text ? { text, mediaId: null, mediaType: null } : null;
}

function istHour(nowMs) {
  return new Date(nowMs + IST_OFFSET_MS).getUTCHours();
}

function withinReplyHours(nowMs) {
  const h = istHour(nowMs);
  return h >= REPLY_FROM_HOUR && h < REPLY_UNTIL_HOUR;
}

const WORDS = {
  greet: (name) =>
    `Hi${name ? ` ${name}` : ''} 👋 This is Pulso support.\nWhich language do you want?\nഏത് ഭാഷയിൽ സംസാരിക്കണം?`,
  menu: {
    en: 'What do you need help with?\nTap the button and choose one.',
    ml: 'എന്തിനാണ് സഹായം വേണ്ടത്?\nബട്ടൺ അമർത്തി ഒന്ന് തിരഞ്ഞെടുക്കുക.'
  },
  menuGreet: {
    en: (name) => `Hi${name ? ` ${name}` : ''} 👋 This is Pulso support.`,
    ml: (name) => `നമസ്കാരം${name ? ` ${name}` : ''} 👋 ഇത് Pulso support ആണ്.`
  },
  menuButton: { en: 'Choose', ml: 'തിരഞ്ഞെടുക്കുക' },
  ask: {
    en: 'Please type your problem in one message. You can also send a photo.',
    ml: 'നിങ്ങളുടെ പ്രശ്നം ഒരു മെസേജിൽ ടൈപ്പ് ചെയ്യുക. ഫോട്ടോയും അയക്കാം.'
  },
  thanksDay: {
    en: 'Thank you. Our team has your message.\nWe will reply here within 2 hours (9 am – 7 pm).',
    ml: 'നന്ദി. നിങ്ങളുടെ മെസേജ് ഞങ്ങളുടെ ടീമിന് ലഭിച്ചു.\n2 മണിക്കൂറിനുള്ളിൽ (രാവിലെ 9 – വൈകിട്ട് 7) ഇവിടെ മറുപടി നൽകും.'
  },
  thanksNight: {
    en: 'Thank you. Our team has your message.\nWe will reply here tomorrow after 9 am.',
    ml: 'നന്ദി. നിങ്ങളുടെ മെസേജ് ഞങ്ങളുടെ ടീമിന് ലഭിച്ചു.\nനാളെ രാവിലെ 9-ന് ശേഷം ഇവിടെ മറുപടി നൽകും.'
  },
  notUnderstood: {
    en: 'Sorry, please choose one option from the list.',
    ml: 'ക്ഷമിക്കണം, ലിസ്റ്റിൽ നിന്ന് ഒന്ന് തിരഞ്ഞെടുക്കുക.'
  }
};

function lang(session) {
  return session && session.agencyLanguage === 'ml' ? 'ml' : 'en';
}

function thanksText(language, nowMs) {
  return (withinReplyHours(nowMs) ? WORDS.thanksDay : WORDS.thanksNight)[language];
}

async function sendLanguagePrompt(deps, phone, session) {
  await deps.updateSession(phone, { status: STATUS.LANGUAGE });
  await deps.sendAndLog(phone, 'buttons', {
    body: WORDS.greet(session.agencyName),
    buttons: [
      { id: IDS.LANG_EN, title: 'English' },
      { id: IDS.LANG_ML, title: 'മലയാളം' }
    ]
  });
}

async function sendMenu(deps, phone, session, { greet = false } = {}) {
  const l = lang(session);
  await deps.updateSession(phone, { status: STATUS.MENU });
  const body = greet ? `${WORDS.menuGreet[l](session.agencyName)}\n${WORDS.menu[l]}` : WORDS.menu[l];
  await deps.sendAndLog(phone, 'list', {
    body,
    buttonText: WORDS.menuButton[l],
    sections: [{ title: 'Pulso support', rows: TOPICS.map((t) => ({ id: t.id, title: t[l] })) }]
  });
}

/** "AGENCY SUPPORT · …" from the app: the agency is known, so skip the old questions. */
async function start(deps, phone, message, session = {}, options = {}) {
  const fromText = isStartMessage(message) ? agencyNameFromText(getMessageText(message)) : '';
  const name = fromText || options.name || session.agencyName || '';
  const updated = await deps.updateSession(phone, {
    audience: 'agency_support',
    agencyName: name,
    agencySupportStartedAt: new Date(deps.now()).toISOString()
  });
  const merged = { ...session, ...updated, agencyName: name };
  if (merged.agencyLanguage) {
    await sendMenu(deps, phone, merged, { greet: true });
    return;
  }
  await sendLanguagePrompt(deps, phone, merged);
}

async function takeIssue(deps, phone, issue, session) {
  const nowMs = deps.now();
  const l = lang(session);
  const request = {
    topic: session.agencyTopic || 'other',
    topicLabel: (TOPICS.find((t) => t.key === session.agencyTopic) || TOPICS[4]).en,
    text: issue.text || '',
    media: issue.mediaId ? [{ id: issue.mediaId, type: issue.mediaType }] : [],
    at: new Date(nowMs).toISOString()
  };
  const updated = await deps.updateSession(phone, {
    status: STATUS.OPEN,
    agencyRequest: request,
    agencyRequestOpenedAtMs: nowMs,
    supportHelpRequested: true,
    supportHelpRequestedAt: request.at,
    supportHelpReason: `agency_${request.topic}`,
    lastIntent: `agency_${request.topic}`
  });
  await deps.addSessionEvent(phone, { type: 'system', event: 'agency_support_requested', request });
  await deps.sendAndLog(phone, 'text', thanksText(l, nowMs));
  await deps.notify({ ...session, ...updated, phone }, request);
}

/** Everything after the start, while the session is in one of the agency states. */
async function handle(deps, phone, message, session = {}) {
  const status = session.status;

  if (status === STATUS.LANGUAGE) {
    const language = parseLanguage(message);
    if (!language) {
      await sendLanguagePrompt(deps, phone, session);
      return;
    }
    const updated = await deps.updateSession(phone, { agencyLanguage: language });
    await sendMenu(deps, phone, { ...session, ...updated, agencyLanguage: language });
    return;
  }

  if (status === STATUS.MENU) {
    const topic = parseTopic(message);
    if (!topic) {
      await deps.sendAndLog(phone, 'text', WORDS.notUnderstood[lang(session)]);
      await sendMenu(deps, phone, session);
      return;
    }
    await deps.updateSession(phone, { status: STATUS.ISSUE, agencyTopic: topic.key });
    await deps.sendAndLog(phone, 'text', WORDS.ask[lang(session)]);
    return;
  }

  if (status === STATUS.ISSUE) {
    const issue = issueFromMessage(message);
    if (!issue) {
      await deps.sendAndLog(phone, 'text', WORDS.ask[lang(session)]);
      return;
    }
    await takeIssue(deps, phone, issue, session);
    return;
  }

  if (status === STATUS.OPEN) {
    const openedAt = Number(session.agencyRequestOpenedAtMs) || 0;
    if (wantsMenu(message) || deps.now() - openedAt > OPEN_WINDOW_MS) {
      await sendMenu(deps, phone, session, { greet: true });
      return;
    }
    // Inside the window: it joins the open request, quietly. Our team reads it
    // on the desk; a second alert per line would only be noise.
    const issue = issueFromMessage(message);
    if (issue) {
      await deps.addSessionEvent(phone, { type: 'system', event: 'agency_support_followup', issue });
    }
  }
}

module.exports = {
  STATUS,
  IDS,
  TOPICS,
  WORDS,
  OPEN_WINDOW_MS,
  isStartMessage,
  isAgencyStatus,
  agencyNameFromText,
  parseLanguage,
  parseTopic,
  issueFromMessage,
  withinReplyHours,
  thanksText,
  start,
  handle
};
