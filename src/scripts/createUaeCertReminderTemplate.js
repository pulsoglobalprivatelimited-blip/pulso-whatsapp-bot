// Submits caregiver_uae_certificate_reminder (en): the second reminder to a
// UAE caregiver who stopped at "send your certificate" (founder approved the
// reminder, 2 Nov 2026). Sent only when her 24-hour window has closed and
// only once UAE_CERT_REMINDER_TEMPLATE_APPROVED=true. {{1}} = first name.
// Run once:
//   node src/scripts/createUaeCertReminderTemplate.js
require('dotenv').config();
const axios = require('axios');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const NAME = 'caregiver_uae_certificate_reminder';
const BODY = 'Hi {{1}}, your Pulso joining is waiting for your certificate.\n'
  + 'Please send a clear photo of your caregiving or nursing certificate in this chat.\n'
  + 'If you do not have it yet, send it when you get it. Do not send your Emirates ID or passport.';

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
