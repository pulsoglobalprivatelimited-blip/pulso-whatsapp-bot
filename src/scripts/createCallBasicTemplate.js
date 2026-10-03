// Submits certificate_call_basic to Meta: the one-button "Call (Basic)" message
// sent under a certificate alert. Run once:
//   node src/scripts/createCallBasicTemplate.js
// Body values: {{1}} name, {{2}} phone — see sendCallBasicOffer.
require('dotenv').config();
const axios = require('axios');
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const NAME = 'certificate_call_basic';
(async () => {
  try {
    const r = await axios.post(`https://graph.facebook.com/${version}/${WABA}/message_templates`, {
      name: NAME,
      language: 'en',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Certificate not valid for {{1}} ({{2}})? Call and take her on as Basic.',
          example: { body_text: [['Adarsh PT', '918089082778']] }
        },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Call (Basic)' }] }
      ]
    }, { params: { access_token: token } });
    console.log(NAME, '->', JSON.stringify(r.data));
  } catch (e) {
    console.error(NAME, 'FAILED:', JSON.stringify(e.response ? e.response.data : e.message));
    process.exitCode = 1;
  }
})();
