const axios = require('axios');
const config = require('../config');

function logDryRun(payload) {
  console.log('[DRY RUN] WhatsApp send', JSON.stringify(payload, null, 2));
}

function durationSince(startedAt) {
  return Date.now() - startedAt;
}

function getResponseMessageIds(data) {
  return data && Array.isArray(data.messages)
    ? data.messages.map((message) => message.id).filter(Boolean)
    : [];
}

function summarizeSend(payload, phoneNumberId, extra = {}) {
  return {
    to: payload && payload.to ? payload.to : null,
    type: payload && payload.type ? payload.type : null,
    phoneNumberId,
    ...extra
  };
}

async function sendRequest(payload, options = {}) {
  const startedAt = Date.now();
  const phoneNumberId = options.phoneNumberId || config.phoneNumberId;

  if (config.dryRun || !config.whatsappToken || !phoneNumberId) {
    logDryRun(payload);
    console.log(
      '[WHATSAPP_SEND_TIMING]',
      JSON.stringify(
        summarizeSend(payload, phoneNumberId, {
          result: 'dry_run',
          durationMs: durationSince(startedAt)
        })
      )
    );
    return { dryRun: true, payload };
  }

  const url = `https://graph.facebook.com/${config.graphApiVersion}/${phoneNumberId}/messages`;
  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(
      '[WHATSAPP_SEND_TIMING]',
      JSON.stringify(
        summarizeSend(payload, phoneNumberId, {
          result: 'ok',
          status: response.status,
          durationMs: durationSince(startedAt),
          messageIds: getResponseMessageIds(response.data)
        })
      )
    );

    return response.data;
  } catch (error) {
    console.error(
      '[WHATSAPP_SEND_TIMING]',
      JSON.stringify(
        summarizeSend(payload, phoneNumberId, {
          result: 'error',
          status: error && error.response ? error.response.status : null,
          durationMs: durationSince(startedAt),
          message: error && error.message ? error.message : 'send_failed'
        })
      )
    );
    throw error;
  }
}

async function sendText(to, body, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body }
  }, options);
}

async function sendImageById(to, mediaId, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: {
      id: mediaId,
      caption
    }
  }, options);
}

async function sendDocumentById(to, mediaId, filename, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: {
      id: mediaId,
      filename,
      caption
    }
  }, options);
}

async function sendVideoById(to, mediaId, caption, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'video',
    video: {
      id: mediaId,
      caption
    }
  }, options);
}

async function sendButtons(to, body, buttons, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: {
            id: button.id,
            title: button.title
          }
        }))
      }
    }
  }, options);
}

async function sendTemplate(to, name, languageCode, components, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: {
        code: languageCode
      },
      ...(components && components.length ? { components } : {})
    }
  }, options);
}

async function sendList(to, body, buttonText, sections, options) {
  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText,
        sections: sections.map((section) => ({
          title: section.title,
          rows: section.rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description
          }))
        }))
      }
    }
  }, options);
}

async function sendAudio(to, mediaId, options) {
  if (!mediaId) {
    return sendText(to, 'Audio placeholder: configure WORKING_MODEL_AUDIO_MEDIA_ID to send the actual working-model voice note.');
  }

  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: { id: mediaId }
  }, options);
}

async function sendTermsAndConditions(to, url, options) {
  if (!url) {
    return sendText(to, 'Terms and conditions placeholder: configure TERMS_AND_CONDITIONS_URL to send the final link.');
  }

  return sendRequest({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: `Terms and conditions: ${url}` }
  }, options);
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
  sendImageById,
  sendDocumentById,
  sendVideoById,
  sendButtons,
  sendList,
  sendTemplate,
  sendAudio,
  sendTermsAndConditions,
  getMediaMetadata,
  downloadMediaFile
};
