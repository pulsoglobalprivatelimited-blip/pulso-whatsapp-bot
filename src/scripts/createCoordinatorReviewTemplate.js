// Submits coordinator_booking_review to Meta: the care coordinator's booking
// request note, for a reviewer whose 24-hour window on the support number is
// closed (docs/coordinator_booking_request_plan.md). Run once:
//   node src/scripts/createCoordinatorReviewTemplate.js
// Then, after Meta approves it, set COORDINATOR_REVIEW_TEMPLATE_ENABLED=true.
// The template must be created on the WhatsApp Business Account of the
// support number (+91 77361 29809), which sends it.
// Body values must stay in step with reviewTemplateValues in
// src/services/coordinatorRequestFlow.js; the three quick replies carry the
// payloads coordreq_book_<R> / coordreq_ask_<R> / coordreq_reject_<R>, set
// per message.
require('dotenv').config();
const axios = require('axios');
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';
const NAME = 'coordinator_booking_review';
const BODY = [
  'Booking request {{1}} from {{2}} (care coordinator)',
  'Agency: {{3}}',
  'Patient: {{4}}',
  'Service: {{5}}',
  'Dates: {{6}}',
  'Location: {{7}}',
  'Who: {{8}}',
  'Book it, ask the coordinator, or reject.'
].join('\n');
(async () => {
  try {
    const r = await axios.post(`https://graph.facebook.com/${version}/${WABA}/message_templates`, {
      name: NAME, language: 'en', category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: BODY,
          example: {
            body_text: [[
              'R-1042',
              'Sanju',
              'CarePlus Manpower',
              'Patient 3 · F · 78 · 58 kg · bedridden · catheter',
              '24 hours · female caregiver',
              '6 Oct to 15 Oct · 10 days',
              'Kakkanad, Kochi https://maps.google.com/?q=10.0159,76.3419',
              'GDA and above'
            ]]
          }
        },
        { type: 'BUTTONS', buttons: [
          { type: 'QUICK_REPLY', text: 'Book it' },
          { type: 'QUICK_REPLY', text: 'Ask coordinator' },
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
