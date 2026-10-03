// Submits certificate_review_basic_age to Meta: the review alert for an
// applicant above 50 (no upper limit; Basic rate; reviewed by a call).
//   node src/scripts/createBasicAgeReviewTemplate.js
// Body values must stay in step with buildBasicAgeTemplateComponents.
require('dotenv').config();
const axios = require('axios');
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const NAME = 'certificate_review_basic_age';
const BODY = [
  'Above 50 application: {{1}}, age {{2}}, asks to join. Above 50 is the Basic rate.',
  'Phone: {{3}}',
  'Qualification claimed: {{4}}',
  'District: {{5}}',
  'Preferred duty hour: {{6}}',
  'Call her, then approve on the Basic rate or reject.'
].join('\n');
(async () => {
  try {
    const r = await axios.post(`https://graph.facebook.com/${version}/${WABA}/message_templates`, {
      name: NAME, language: 'en', category: 'UTILITY',
      components: [
        { type: 'BODY', text: BODY, example: { body_text: [['Leela K', '56', '919446000000', 'GDA', 'Kannur', 'Both']] } },
        { type: 'BUTTONS', buttons: [
          { type: 'URL', text: 'Call her', url: 'https://whatsapp.pulso.co.in/call/{{1}}', example: ['https://whatsapp.pulso.co.in/call/919446000000-0123456789abcdef'] },
          { type: 'QUICK_REPLY', text: 'Approve (Basic)' },
          { type: 'QUICK_REPLY', text: 'Reject' }
        ] }
      ]
    }, { params: { access_token: token } });
    console.log(NAME, '->', JSON.stringify(r.data));
  } catch (e) {
    console.error(NAME, 'FAILED:', JSON.stringify(e.response ? e.response.data : e.message));
    process.exitCode = 1;
  }
})();
