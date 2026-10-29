'use strict';
// "Follow our duty channel" (founder, 17 Oct 2026). Sent once, right after a
// Kerala caregiver finishes joining. The channel posts unfilled duties with a
// link that opens the duty in the Pulso app. Change the link with CHANNEL_URL.

const DEFAULT_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbDtZQ9A89MkYXoQSw0B';

function channelUrl() {
  return String(process.env.CHANNEL_URL || DEFAULT_CHANNEL_URL).trim();
}

/** English only for whoever chose English (founder, 29 Oct 2026); both for the rest, as before. */
function channelInviteText(provider = {}) {
  const english = provider.language ? provider.language === 'en' : /english/.test(String(provider.flowId || ''));
  if (english) {
    return ['Follow the Pulso duty channel 👇', 'New duties near you come here first.', channelUrl()].join('\n');
  }
  return [
    'Pulso ഡ്യൂട്ടി ചാനൽ follow ചെയ്യുക 👇',
    'നിങ്ങളുടെ അടുത്തുള്ള പുതിയ ഡ്യൂട്ടികൾ ഇവിടെ ആദ്യം വരും.',
    channelUrl(),
    '',
    'Follow the Pulso duty channel to see new duties near you first.',
  ].join('\n');
}

/** Kerala only; never twice. */
function shouldSendChannelInvite(provider = {}) {
  if (!channelUrl()) return false;
  const region = String(provider.region || '').toLowerCase();
  if (region === 'karnataka' || region === 'uae') return false;
  return !provider.channelInviteSentAt;
}

module.exports = { DEFAULT_CHANNEL_URL, channelUrl, channelInviteText, shouldSendChannelInvite };
