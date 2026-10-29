// Submits caregiver_uae_id_photos (en): the reminder to a UAE caregiver who
// signed in to the Pulso app but has not sent her Emirates ID photos. Words
// approved by the founder, 29 Oct 2026 (no "update" line; line B for the
// husband-visa / freelance paper). {{1}} = her first name. Run once:
//   node src/scripts/createUaeIdPhotosTemplate.js
require('dotenv').config();
const axios = require('axios');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const NAME = 'caregiver_uae_id_photos';
const BODY = 'Hi {{1}}, your Pulso joining is almost done.\n'
  + 'Please open the Pulso app and take 3 photos: your Emirates ID front, the back, and a clear selfie.\n'
  + 'If you are on a husband visa or freelance visa, also take a photo of the NOC or freelance permit.\n'
  + 'Duty offers start after we check them.';

(async () => {
  const payload = {
    name: NAME,
    language: 'en',
    category: 'UTILITY',
    components: [{ type: 'BODY', text: BODY, example: { body_text: [['Asha']] } }]
  };
  try {
    const r = await axios.post(`https://graph.facebook.com/${version}/${WABA}/message_templates`, payload, { params: { access_token: token } });
    console.log(NAME, 'en ->', JSON.stringify(r.data));
  } catch (e) {
    console.error(NAME, 'en FAILED:', JSON.stringify(e.response ? e.response.data : e.message));
    process.exitCode = 1;
  }
})();

module.exports = { NAME, BODY };
