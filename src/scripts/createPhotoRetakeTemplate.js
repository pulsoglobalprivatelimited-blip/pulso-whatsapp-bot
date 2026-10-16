// Submits caregiver_photo_retake (ml + en): the "send a new photo" request with
// a sample photo as the image header and the reviewer's note as {{1}}. Used when
// the caregiver is outside WhatsApp's 24-hour window (photos now come from the
// app). Founder, 16 Oct 2026. Run once:
//   node src/scripts/createPhotoRetakeTemplate.js
// The header example is the standard sample (src/public/assets/profile_photo_sample.jpg),
// uploaded through Meta's resumable upload to get a header_handle.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const APP_ID = process.env.META_APP_ID || '817320334198337';
const NAME = 'caregiver_photo_retake';
const SAMPLE = path.join(__dirname, '..', 'public', 'assets', 'profile_photo_sample.jpg');

const BODIES = {
  ml: 'ദയവായി ഒരു പുതിയ full photo അയയ്ക്കുക: നിന്നുകൊണ്ട്, തല മുതൽ കാൽ വരെ, നല്ല വെളിച്ചത്തിൽ. മുകളിലെ photo പോലെ.\n\nReviewer note: {{1}}\n\nPulso app-ൽ My Profile തുറന്ന് photo മാറ്റാം.',
  en: 'Please send a new full-length photo: standing, head to toe, in good light, like the photo above.\n\nReviewer note: {{1}}\n\nOpen My Profile in the Pulso app to change your photo.'
};

async function headerHandle() {
  const file = fs.readFileSync(SAMPLE);
  const session = await axios.post(`https://graph.facebook.com/${version}/${APP_ID}/uploads`, null, {
    params: { file_length: file.length, file_type: 'image/jpeg', access_token: token }
  });
  const up = await axios.post(`https://graph.facebook.com/${version}/${session.data.id}`, file, {
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
    maxBodyLength: Infinity
  });
  return up.data.h;
}

(async () => {
  const handle = await headerHandle();
  for (const language of ['ml', 'en']) {
    const payload = {
      name: NAME,
      language,
      category: 'UTILITY',
      components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } },
        { type: 'BODY', text: BODIES[language], example: { body_text: [['Please stand against a plain wall, full body in the frame']] } }
      ]
    };
    try {
      const r = await axios.post(`https://graph.facebook.com/${version}/${WABA}/message_templates`, payload, { params: { access_token: token } });
      console.log(NAME, language, '->', JSON.stringify(r.data));
    } catch (e) {
      console.error(NAME, language, 'FAILED:', JSON.stringify(e.response ? e.response.data : e.message));
      process.exitCode = 1;
    }
  }
})().catch((e) => { console.error('FAILED', e.response ? JSON.stringify(e.response.data) : e.message); process.exitCode = 1; });
