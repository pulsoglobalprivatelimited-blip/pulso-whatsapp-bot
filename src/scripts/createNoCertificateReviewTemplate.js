// Submits certificate_review_no_cert to Meta: the "No certificate" review alert
// with Call her (link) / Approve (Basic) / Reject. Run once:
//   node src/scripts/createNoCertificateReviewTemplate.js
// The body's six values must stay in step with
// buildNoCertificateTemplateBodyValues in src/services/opsNotifications.js.
require('dotenv').config();
const axios = require('axios');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const NAME = 'certificate_review_no_cert';

const BODY = [
  'No certificate application: {{1}} asks to join as a Basic caregiver.',
  'Phone: {{2}}',
  'Age: {{3}}',
  'District: {{4}}',
  'Preferred duty hour: {{5}}',
  'Also sent to: {{6}}',
  'Call her, then approve on the Basic rate or reject.'
].join('\n');

(async () => {
  const payload = {
    name: NAME,
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: BODY,
        example: { body_text: [['Sindhu Sajeev', '919633495486', '25', 'Kannur', 'Both', 'Mohamed Afiq']] }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Call her',
            url: 'https://whatsapp.pulso.co.in/call/{{1}}',
            example: ['https://whatsapp.pulso.co.in/call/919633495486-0123456789abcdef']
          },
          { type: 'QUICK_REPLY', text: 'Approve (Basic)' },
          { type: 'QUICK_REPLY', text: 'Reject' }
        ]
      }
    ]
  };
  try {
    const r = await axios.post(`https://graph.facebook.com/${version}/${WABA}/message_templates`, payload, {
      params: { access_token: token }
    });
    console.log(NAME, '->', JSON.stringify(r.data));
  } catch (e) {
    console.error(NAME, 'FAILED:', JSON.stringify(e.response ? e.response.data : e.message));
    process.exitCode = 1;
  }
})();
