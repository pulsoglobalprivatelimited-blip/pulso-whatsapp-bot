const config = require('../config');
const { sendText, sendTemplate } = require('./metaClient');

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function joinLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function formatStatus(value) {
  return String(value || '-').replace(/_/g, ' ');
}

/**
 * Get an alert to ops, whether or not the 24-hour window is open.
 *
 * Meta accepts a free-form send outside that window and then silently does not
 * deliver it — there is no error to catch. That is what happened to certificate
 * reviews before they moved to templates. So when a template is configured it
 * is sent first and IS the alert; the detailed text follows as best effort, and
 * carries everything when the window happens to be open.
 *
 * With no template configured this is exactly the old behaviour: text only.
 */
async function deliverOpsAlert(to, body, template = {}, logContext = {}) {
  const templateName = String(template.name || '').trim();
  let templateSent = false;

  if (templateName) {
    try {
      await sendTemplate(
        to,
        templateName,
        String(template.language || 'en').trim() || 'en',
        template.components || []
      );
      templateSent = true;
      console.log('[OPS_ALERT_TEMPLATE_SENT]', JSON.stringify({ to, templateName, ...logContext }, null, 2));
    } catch (error) {
      console.error(
        '[OPS_ALERT_TEMPLATE_ERROR]',
        JSON.stringify(
          {
            to,
            templateName,
            ...logContext,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }
  }

  try {
    await sendText(to, body);
    return { templateSent, textSent: true };
  } catch (error) {
    console.error(
      '[OPS_ALERT_TEXT_ERROR]',
      JSON.stringify(
        {
          to,
          ...logContext,
          templateSent,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return { templateSent, textSent: false };
  }
}

/**
 * Body parameters for a template that was approved with variables.
 *
 * The count has to match what Meta approved or the send is rejected, so it is
 * configured rather than guessed: 0 (a fixed "someone needs you" nudge) or 3.
 */
function templateComponents(variableCount, values) {
  const count = Number(variableCount) || 0;
  if (count !== 3) {
    return [];
  }
  return [
    {
      type: 'body',
      parameters: values.slice(0, 3).map((value) => ({ type: 'text', text: String(value || '-') }))
    }
  ];
}

function buildProviderChatLink(phone) {
  const normalizedPhone = normalizePhone(phone);
  return normalizedPhone ? `https://wa.me/${normalizedPhone}` : null;
}

function buildProviderIntroMessage(session) {
  const region = session && session.region ? ` (${session.region})` : '';
  return [
    'നമസ്കാരം,',
    'ഞാൻ Pulso support team-ിൽ നിന്നാണ് message ചെയ്യുന്നത്.',
    `താങ്കൾ Provider Support bot${region}-ൽ സഹായം ആവശ്യപ്പെട്ടതായി കണ്ടു.`,
    'എങ്ങനെ സഹായിക്കാം?'
  ].join(' ');
}

function getProviderSupportNotificationRecipients(session) {
  const providerPhone = normalizePhone(session && session.phone);
  const supportBotPhone = normalizePhone(config.providerSupportBotWhatsappNumber);

  return [
    normalizePhone(config.agentHelpWhatsappNumber),
    normalizePhone(config.ownerNotificationPhone),
    normalizePhone(config.secondaryNotificationPhone)
  ]
    .filter(Boolean)
    .filter((phone) => phone !== providerPhone && phone !== supportBotPhone)
    .filter((phone, index, list) => list.indexOf(phone) === index);
}

async function notifyProviderSupportHelpRequested(session, reason) {
  const recipients = getProviderSupportNotificationRecipients(session);
  if (!recipients.length) {
    return null;
  }

  const providerPhone = session && session.phone ? session.phone : null;
  const chatLink = buildProviderChatLink(providerPhone);
  const introMessage = buildProviderIntroMessage(session);
  const introLink = chatLink ? `${chatLink}?text=${encodeURIComponent(introMessage)}` : null;
  const body = joinLines([
    'Pulso alert: provider requested help in Provider Support bot',
    `Help type: ${formatStatus(reason || 'general_support')}`,
    session && session.supportHelpRequestedAt ? `Requested at: ${session.supportHelpRequestedAt}` : null,
    providerPhone ? `Provider phone: ${providerPhone}` : null,
    session && session.region ? `Region: ${formatStatus(session.region)}` : null,
    session && session.language ? `Language: ${session.language}` : null,
    session && session.status ? `Current status: ${formatStatus(session.status)}` : null,
    session && session.lastIntent ? `Last intent: ${formatStatus(session.lastIntent)}` : null,
    session && session.lastDutyType ? `Duty type: ${session.lastDutyType}` : null,
    chatLink ? `Reply now: ${chatLink}` : null,
    introLink ? `Reply with intro: ${introLink}` : null,
    `Intro message: ${introMessage}`
  ]);

  const template = {
    name: config.providerSupportHelpTemplateName,
    language: config.providerSupportHelpTemplateLanguage,
    components: templateComponents(config.providerSupportHelpTemplateVariables, [
      formatStatus(reason || 'general_support'),
      (session && session.region) || '-',
      providerPhone || '-'
    ])
  };

  for (const phone of recipients) {
    const result = await deliverOpsAlert(phone, body, template, { providerPhone });
    console.log(
      '[PROVIDER_SUPPORT_HELP_NOTIFICATION_SENT]',
      JSON.stringify({ to: phone, providerPhone, ...result }, null, 2)
    );
  }

  return { recipients };
}

function buildPartnerIntroMessage(session) {
  const name = session && session.partner && session.partner.name ? session.partner.name : null;
  const isMalayalam = session && session.language === 'ml';

  if (isMalayalam) {
    return [
      `നമസ്കാരം${name ? ` ${name}` : ''},`,
      'ഞാൻ Pulso partner team-ിൽ നിന്നാണ് message ചെയ്യുന്നത്.',
      'താങ്കൾ Partner Support-ൽ സഹായം ആവശ്യപ്പെട്ടതായി കണ്ടു.',
      'എങ്ങനെ സഹായിക്കാം?'
    ].join(' ');
  }

  return [
    `Hello${name ? ` ${name}` : ''},`,
    'this is the Pulso partner team.',
    'We saw that you asked for help in Partner Support.',
    'How can we help?'
  ].join(' ');
}

function getCarePartnerNotificationRecipients(session) {
  const partnerPhone = normalizePhone(session && session.phone);
  const supportBotPhone = normalizePhone(config.providerSupportBotWhatsappNumber);

  // The partner manager first, then the ordinary ops chain, so a missing
  // PARTNER_HELP_WHATSAPP_NUMBER can never make an alert undeliverable.
  return [
    normalizePhone(config.partnerHelpWhatsappNumber),
    normalizePhone(config.agentHelpWhatsappNumber),
    normalizePhone(config.ownerNotificationPhone),
    normalizePhone(config.secondaryNotificationPhone)
  ]
    .filter(Boolean)
    .filter((phone) => phone !== partnerPhone && phone !== supportBotPhone)
    .filter((phone, index, list) => list.indexOf(phone) === index);
}

async function notifyCarePartnerHelpRequested(session, reason) {
  const recipients = getCarePartnerNotificationRecipients(session);
  if (!recipients.length) {
    return null;
  }

  const partner = (session && session.partner) || {};
  const partnerPhone = session && session.phone ? session.phone : null;
  const chatLink = buildProviderChatLink(partnerPhone);
  const introMessage = buildPartnerIntroMessage(session);
  const introLink = chatLink ? `${chatLink}?text=${encodeURIComponent(introMessage)}` : null;
  const body = joinLines([
    'Pulso alert: care partner requested help',
    `Help type: ${formatStatus(reason || 'partner_support')}`,
    partner.name ? `Agency: ${partner.name}` : null,
    partner.bureauId ? `Bureau ID: ${partner.bureauId}` : null,
    partner.status ? `Partner status: ${formatStatus(partner.status)}` : null,
    partner.role ? `Role: ${formatStatus(partner.role)}` : null,
    partner.district ? `District: ${formatStatus(partner.district)}` : null,
    partnerPhone ? `Partner phone: ${partnerPhone}` : null,
    session && session.region ? `Region: ${formatStatus(session.region)}` : null,
    session && session.language ? `Language: ${session.language}` : null,
    session && session.lastIntent ? `Last intent: ${formatStatus(session.lastIntent)}` : null,
    session && session.supportHelpRequestedAt ? `Requested at: ${session.supportHelpRequestedAt}` : null,
    chatLink ? `Reply now: ${chatLink}` : null,
    introLink ? `Reply with intro: ${introLink}` : null
  ]);

  const template = {
    name: config.partnerHelpTemplateName,
    language: config.partnerHelpTemplateLanguage,
    components: templateComponents(config.partnerHelpTemplateVariables, [
      formatStatus(reason || 'partner_support'),
      partner.name || 'an agency',
      partnerPhone || '-'
    ])
  };

  for (const phone of recipients) {
    const result = await deliverOpsAlert(phone, body, template, {
      partnerPhone,
      bureauId: partner.bureauId || null
    });
    console.log(
      '[CARE_PARTNER_HELP_NOTIFICATION_SENT]',
      JSON.stringify({ to: phone, partnerPhone, bureauId: partner.bureauId || null, ...result }, null, 2)
    );
  }

  return { recipients };
}

module.exports = {
  deliverOpsAlert,
  templateComponents,
  notifyProviderSupportHelpRequested,
  notifyCarePartnerHelpRequested
};
