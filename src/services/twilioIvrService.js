const config = require('../config');
const { sendText, sendTemplate } = require('./metaClient');

const LANGUAGES = new Set(['en', 'ml']);

const COPY = {
  welcome: [
    { language: 'en-IN', text: 'Welcome to Pulso. For English, press 1.' },
    { language: 'en-IN', text: 'Malayalathinayi 2 amarthuka.' }
  ],
  en: {
    menu: [
      'Thank you for calling Pulso.',
      'For home care service booking, press 1.',
      'For caregiver or nursing staff job opportunities, press 2.',
      'For existing booking support, press 3.'
    ],
    jobMessage: [
      'Thank you for your interest in joining Pulso.',
      'Job opportunity enquiries are handled only through WhatsApp.',
      'Please send your name, location, qualification, experience, and certificate photo to our recruitment WhatsApp number.',
      'We are sending a WhatsApp message to you.',
      'Thank you for calling Pulso.'
    ],
    invalid: 'Sorry, we did not receive a valid selection.',
    connecting: 'Please wait while we connect you to our staff.',
    noStaff: 'Sorry, the staff line is not configured. Please try again later.',
    whatsappBody:
      'Thank you for contacting Pulso.\n' +
      'For Caregiver / Nursing Staff job opportunities, please WhatsApp your details here:\n' +
      'https://wa.me/919633108778\n\n' +
      'Send: Name, Location, Qualification, Experience, and Certificate Photo.\n' +
      'Calls are not attended for job enquiries.'
  },
  ml: {
    menu: [
      'Pulso ilekku vilichathinu nanni.',
      'Home care service booking-nayi 1 amarthuka.',
      'Caregiver allenkil Nursing Staff joli avasarangalkkayi 2 amarthuka.',
      'Nilavilulla booking support-nayi 3 amarthuka.'
    ],
    jobMessage: [
      'Pulso-yil joli cheyyanulla thalparyathinu nanni.',
      'Caregiver allenkil Nursing Staff joli avasarangal WhatsApp vazhi mathramanu kaikaryam cheyyunnathu.',
      'Dayavayi ningalude peru, sthalam, qualification, experience, certificate photo enniva njangalude recruitment WhatsApp numberilekku ayakkuka.',
      'WhatsApp message ayachittundu.',
      'Pulso ilekku vilichathinu nanni.'
    ],
    invalid: 'Kshamikkanam, sariyaya selection labhichilla.',
    connecting: 'Staffumayi connect cheyyunnu. Dayavayi wait cheyyuka.',
    noStaff: 'Kshamikkanam, staff line configure cheythittilla. Pinne try cheyyuka.',
    whatsappBody:
      'Pulso-yumayi bandhappedunnathinu nandi.\n' +
      'Caregiver / Nursing Staff joli avasarangalkkayi ningalude details WhatsApp cheyyuka:\n' +
      'https://wa.me/919633108778\n\n' +
      'Ayakkenda details: Name, Location, Qualification, Experience, Certificate Photo.\n' +
      'Job enquiry calls attend cheyyunnathalla.'
  }
};

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(content) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}

function say(text, attrs = {}) {
  const attributes = Object.entries(attrs)
    .filter(([, value]) => value)
    .map(([key, value]) => ` ${key}="${xmlEscape(value)}"`)
    .join('');
  return `<Say${attributes}>${xmlEscape(text)}</Say>`;
}

function gather(action, content) {
  return `<Gather input="dtmf" numDigits="1" timeout="6" action="${xmlEscape(action)}" method="POST">${content}</Gather>`;
}

function redirect(path) {
  return `<Redirect method="POST">${xmlEscape(path)}</Redirect>`;
}

function hangup() {
  return '<Hangup/>';
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  return `+${digits}`;
}

function normalizeWhatsappRecipient(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (digits.length === 10) {
    return `91${digits}`;
  }

  return digits;
}

function buildWaLink() {
  const phone = String(config.ivrRecruitmentWhatsappNumber || '').replace(/\D/g, '');
  return `https://wa.me/${phone}`;
}

function getWhatsappBody(language) {
  return COPY[language].whatsappBody.replace('https://wa.me/919633108778', buildWaLink());
}

function getMetaTemplateName(language) {
  if (language === 'ml' && config.ivrJobWhatsappTemplateNameMl) {
    return config.ivrJobWhatsappTemplateNameMl;
  }

  if (language === 'en' && config.ivrJobWhatsappTemplateNameEn) {
    return config.ivrJobWhatsappTemplateNameEn;
  }

  return config.ivrJobWhatsappTemplateName || config.ivrJobWhatsappTemplateNameEn;
}

function getMetaTemplateLanguage(language) {
  if (language === 'ml' && config.ivrJobWhatsappTemplateNameMl) {
    return config.ivrJobWhatsappTemplateLanguageMl;
  }

  return config.ivrJobWhatsappTemplateLanguageEn;
}

function summarizeWhatsappSendResult(result) {
  const message = result && Array.isArray(result.messages) ? result.messages[0] : null;
  const contact = result && Array.isArray(result.contacts) ? result.contacts[0] : null;

  return {
    dryRun: Boolean(result && result.dryRun),
    messageId: message && message.id ? message.id : null,
    messageStatus: message && message.message_status ? message.message_status : null,
    contactInput: contact && contact.input ? contact.input : null,
    waId: contact && contact.wa_id ? contact.wa_id : null
  };
}

function getMetaTemplateComponents(templateName) {
  if (templateName === 'ivr_continue_reply_en') {
    return [];
  }

  return [
    {
      type: 'body',
      parameters: [
        {
          type: 'text',
          text: buildWaLink()
        }
      ]
    }
  ];
}

function buildWelcomeTwiml() {
  const prompt = COPY.welcome.map((line) => say(line.text, { language: line.language })).join('');
  return twiml(gather('/ivr/language', prompt) + redirect('/ivr/welcome'));
}

function buildMenuTwiml(language) {
  const lang = LANGUAGES.has(language) ? language : 'en';
  const prompt = COPY[lang].menu.map((line) => say(line, { language: 'en-IN' })).join('');
  return twiml(gather(`/ivr/menu?lang=${lang}`, prompt) + redirect(`/ivr/menu?lang=${lang}`));
}

function buildInvalidTwiml(language) {
  const lang = LANGUAGES.has(language) ? language : 'en';
  return twiml(say(COPY[lang].invalid, { language: 'en-IN' }) + redirect('/ivr/welcome'));
}

function buildDialStaffTwiml(language) {
  const lang = LANGUAGES.has(language) ? language : 'en';
  const staffPhone = normalizePhone(config.ivrStaffPhone);

  if (!staffPhone) {
    return twiml(say(COPY[lang].noStaff, { language: 'en-IN' }) + hangup());
  }

  return twiml(
    say(COPY[lang].connecting, { language: 'en-IN' }) +
      `<Dial>${xmlEscape(staffPhone)}</Dial>` +
      hangup()
  );
}

function buildJobTwiml(language) {
  const lang = LANGUAGES.has(language) ? language : 'en';
  const prompt = COPY[lang].jobMessage.map((line) => say(line, { language: 'en-IN' })).join('');
  return twiml(prompt + hangup());
}

function getJobVoiceMessage(language) {
  const lang = LANGUAGES.has(language) ? language : 'en';
  return COPY[lang].jobMessage.join(' ');
}

function resolveLanguage(digit) {
  if (digit === '1') {
    return 'en';
  }

  if (digit === '2') {
    return 'ml';
  }

  return null;
}

function resolveMenuAction(digit) {
  if (digit === '1' || digit === '3') {
    return 'staff';
  }

  if (digit === '2') {
    return 'job';
  }

  return null;
}

async function sendJobWhatsapp(to, language) {
  const lang = LANGUAGES.has(language) ? language : 'en';
  const recipient = normalizeWhatsappRecipient(to);
  if (!recipient) {
    return { skipped: true, reason: 'missing_recipient' };
  }

  const templateName = getMetaTemplateName(lang);
  if (templateName) {
    const templateLanguage = getMetaTemplateLanguage(lang);
    const result = await sendTemplate(
      recipient,
      templateName,
      templateLanguage,
      getMetaTemplateComponents(templateName)
    );
    console.log(
      '[IVR_JOB_WHATSAPP_SENT]',
      JSON.stringify(
        {
          mode: 'template',
          recipient,
          language: lang,
          templateName,
          templateLanguage,
          result: summarizeWhatsappSendResult(result)
        },
        null,
        2
      )
    );
    return result;
  }

  console.warn('[IVR_WHATSAPP_TEMPLATE_MISSING] Sending free-form text may fail outside a WhatsApp service window.');
  const result = await sendText(recipient, getWhatsappBody(lang));
  console.log(
    '[IVR_JOB_WHATSAPP_SENT]',
    JSON.stringify(
      {
        mode: 'text',
        recipient,
        language: lang,
        result: summarizeWhatsappSendResult(result)
      },
      null,
      2
    )
  );
  return result;
}

module.exports = {
  buildWelcomeTwiml,
  buildMenuTwiml,
  buildInvalidTwiml,
  buildDialStaffTwiml,
  buildJobTwiml,
  getJobVoiceMessage,
  resolveLanguage,
  resolveMenuAction,
  sendJobWhatsapp
};
