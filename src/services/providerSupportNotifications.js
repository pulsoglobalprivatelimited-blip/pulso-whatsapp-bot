const config = require('../config');
const { sendText } = require('./metaClient');

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function joinLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function formatStatus(value) {
  return String(value || '-').replace(/_/g, ' ');
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

  for (const phone of recipients) {
    try {
      await sendText(phone, body);
      console.log(
        '[PROVIDER_SUPPORT_HELP_NOTIFICATION_SENT]',
        JSON.stringify({ to: phone, providerPhone }, null, 2)
      );
    } catch (error) {
      console.error(
        '[PROVIDER_SUPPORT_HELP_NOTIFICATION_ERROR]',
        JSON.stringify(
          {
            to: phone,
            providerPhone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }
  }

  return { recipients };
}

module.exports = {
  notifyProviderSupportHelpRequested
};
