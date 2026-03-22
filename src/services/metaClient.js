const axios = require('axios');
const config = require('../config');

function logDryRun(payload) {
  console.log('[DRY RUN] WhatsApp send', JSON.stringify(payload, null, 2));
}

async function sendRequest(payload) {
  if (config.dryRun || !config.whatsappToken || !config.phoneNumberId) {
    logDryRun(payload);
    return { dryRun: true, payload };
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`;
  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      'Content-Type': 'application/json'
    }
  });

  return response.data;
}

async function sendText(to, body) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body }
  });
}

async function sendAudio(to, mediaId) {
  if (!mediaId) {
    return sendText(to, 'Audio placeholder: configure WORKING_MODEL_AUDIO_MEDIA_ID to send the actual working-model voice note.');
  }

  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: { id: mediaId }
  });
}

async function sendTermsAndConditions(to, url) {
  if (!url) {
    return sendText(to, 'Terms and conditions placeholder: configure TERMS_AND_CONDITIONS_URL to send the final link.');
  }

  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: `Terms and conditions: ${url}` }
  });
}

async function getMediaMetadata(mediaId) {
  if (!config.whatsappToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is required to fetch media metadata.');
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${mediaId}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`
    }
  });

  return response.data;
}

async function downloadMediaFile(url) {
  if (!config.whatsappToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is required to download media files.');
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`
    }
  });

  return Buffer.from(response.data);
}

module.exports = {
  sendText,
  sendAudio,
  sendTermsAndConditions,
  getMediaMetadata,
  downloadMediaFile
};
