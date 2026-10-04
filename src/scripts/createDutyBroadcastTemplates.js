// Submits the duty broadcast templates to Meta (founder-approved words, 4 Oct 2026):
//   basic_duty_offer  (ml + en) — the duty to a Basic caregiver, with
//                     I'm interested / Not now / Call Pulso (dials 8714105333)
//   duty_interest_ops (en)      — "Interested" to 8714105333, with Call her
// Run once:  node src/scripts/createDutyBroadcastTemplates.js
// Body values must stay in step with buildOfferComponents / tellInterestPhone
// in src/services/dutyBroadcast.js. Meta wants quick replies grouped, so the
// phone button comes last.
require('dotenv').config();
const axios = require('axios');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const PULSO_PHONE = '+918714105333';

const OFFER_EXAMPLE = [['Kakkanad, Ernakulam', '24 മണിക്കൂർ', '6 Oct', '10', '750']];

const templates = [
  {
    name: 'basic_duty_offer',
    language: 'ml',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '*പുതിയ duty:* {{1}}\n{{2}} · {{3}} മുതൽ {{4}} ദിവസം\nശമ്പളം: ദിവസം ₹{{5}}\nതാൽപര്യമുണ്ടെങ്കിൽ താഴെ അമർത്തുക.',
        example: { body_text: OFFER_EXAMPLE }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'താൽപര്യമുണ്ട്' },
          { type: 'QUICK_REPLY', text: 'ഇപ്പോൾ വേണ്ട' },
          { type: 'PHONE_NUMBER', text: 'Pulso-യെ വിളിക്കുക', phone_number: PULSO_PHONE }
        ]
      }
    ]
  },
  {
    name: 'basic_duty_offer',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '*New duty:* {{1}}\n{{2}} · from {{3}} for {{4}} days\nPay: ₹{{5}} per day\nTap below if you are interested.',
        example: { body_text: [['Kakkanad, Ernakulam', '24-hour', '6 Oct', '10', '750']] }
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: "I'm interested" },
          { type: 'QUICK_REPLY', text: 'Not now' },
          { type: 'PHONE_NUMBER', text: 'Call Pulso', phone_number: PULSO_PHONE }
        ]
      }
    ]
  },
  {
    name: 'duty_interest_ops',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'A Basic caregiver tapped I am interested on a duty broadcast.\nName: {{1}}\nPhone: {{2}}\nDistrict: {{3}}\nFor: {{4}}\nCall her, then assign her to the booking as usual.',
        example: { body_text: [['Sindhu Sajeev', '917025833854', 'Ernakulam', "Amma Test's booking, Kakkanad, Ernakulam"]] }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Call her',
            url: 'https://whatsapp.pulso.co.in/call/{{1}}',
            example: ['https://whatsapp.pulso.co.in/call/917025833854-0123456789abcdef']
          }
        ]
      }
    ]
  }
];

(async () => {
  const only = process.argv[2];
  for (const t of templates.filter((x) => !only || x.name === only)) {
    try {
      const r = await axios.post(`https://graph.facebook.com/${version}/${WABA}/message_templates`, t, {
        params: { access_token: token }
      });
      console.log(t.name, t.language, '->', JSON.stringify(r.data));
    } catch (e) {
      console.error(t.name, t.language, 'FAILED:', JSON.stringify(e.response ? e.response.data : e.message));
      process.exitCode = 1;
    }
  }
})();
