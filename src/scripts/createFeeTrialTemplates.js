// Submits the two 7-day-trial templates to Meta, in Malayalam and English
// (founder, 24 Oct 2026; the hub's docs/provider_subscription_fee_plan.md).
// Run once:
//   node src/scripts/createFeeTrialTemplates.js
// Sent from the caregiver bot (+91 77361 67744) by the subscription-fee
// reminder sweep (onboardingFlow.js remindTrialProvider), only once
// SUBSCRIPTION_FEE_TRIAL_TEMPLATES_APPROVED=true is set on Render.
//   provider_fee_trial_reminder  {{1}} first name, {{2}} days left (2, then 1)
//   provider_fee_trial_over      {{1}} first name
// The words are the same as flow.js subscriptionFeeTrialReminder /
// subscriptionFeeTrialOver, with the greeting and sign-off a template needs.
require('dotenv').config();
const axios = require('axios');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';

const TEMPLATES = [
  {
    name: 'provider_fee_trial_reminder',
    language: 'ml',
    body: 'നമസ്കാരം {{1}}, നിങ്ങളുടെ Pulso സൗജന്യ ട്രയൽ {{2}} ദിവസം കൂടി മാത്രം. അതിനു ശേഷവും ഡ്യൂട്ടി ഓഫറുകൾ കാണാൻ ₹499 സബ്സ്ക്രിപ്ഷൻ ഫീസ് Pulso ആപ്പിൽ ഇപ്പോൾ തന്നെ അടയ്ക്കാം. – ടീം Pulso',
    example: ['Jisha', '2']
  },
  {
    name: 'provider_fee_trial_reminder',
    language: 'en',
    body: 'Hello {{1}}, your Pulso free trial has {{2}} day(s) left. To keep seeing duty offers after it, you can pay the ₹499 subscription fee in the Pulso app now. – Team Pulso',
    example: ['Jisha', '2']
  },
  {
    name: 'provider_fee_trial_over',
    language: 'ml',
    body: 'നമസ്കാരം {{1}}, നിങ്ങളുടെ Pulso സൗജന്യ ട്രയൽ കഴിഞ്ഞു. പുതിയ ഡ്യൂട്ടികളുടെ അറിയിപ്പുകൾ തുടർന്നും വരും; അവ കാണാനും സ്വീകരിക്കാനും Pulso ആപ്പിൽ ₹499 സബ്സ്ക്രിപ്ഷൻ ഫീസ് അടയ്ക്കുക. – ടീം Pulso',
    example: ['Jisha']
  },
  {
    name: 'provider_fee_trial_over',
    language: 'en',
    body: 'Hello {{1}}, your Pulso free trial is over. Alerts for new duties will keep coming; to see and accept them, pay the ₹499 subscription fee in the Pulso app. – Team Pulso',
    example: ['Jisha']
  }
];

(async () => {
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN is not set');
  for (const t of TEMPLATES) {
    try {
      const r = await axios.post(
        `https://graph.facebook.com/${version}/${WABA}/message_templates`,
        {
          name: t.name,
          language: t.language,
          category: 'UTILITY',
          components: [{ type: 'BODY', text: t.body, example: { body_text: [t.example] } }]
        },
        { params: { access_token: token } }
      );
      console.log(t.name, t.language, '->', JSON.stringify(r.data));
    } catch (error) {
      console.error(t.name, t.language, 'FAILED', JSON.stringify(error.response ? error.response.data : error.message));
    }
  }
})();
