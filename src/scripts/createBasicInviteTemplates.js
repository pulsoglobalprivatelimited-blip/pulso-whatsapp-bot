// Submits the two Basic Caregiver invite templates to Meta
// (docs/basic_caregiver_invite_broadcast_plan.md). Run once:
//   node src/scripts/createBasicInviteTemplates.js
// They are sent from the caregiver bot (+91 77361 67744) by
// src/scripts/sendBasicInvite.js. The two quick replies carry the payloads
// basic_invite_yes / basic_invite_no, set per message.
require('dotenv').config();
const axios = require('axios');

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '940659845043119';

const PERKS = [
  '✔️ സ്വന്തം ജില്ലയിൽ ഹോം കെയർ ഡ്യൂട്ടി',
  '✔️ ദിവസേന പേയ്മെന്റ്',
  '✔️ രജിസ്ട്രേഷൻ ഫീസ് ഇല്ല'
].join('\n');
const CLOSE = 'താൽപര്യമുണ്ടെങ്കിൽ താഴെയുള്ള button അമർത്തുക.';

const TEMPLATES = [
  {
    name: 'basic_invite_age_ml',
    body: [
      'നമസ്കാരം 🙏',
      '',
      'മുമ്പ് 50 വയസ്സിന് മുകളിലായതിനാൽ Pulso-യിൽ ചേരാൻ കഴിയില്ലെന്ന് ഞങ്ങൾ അറിയിച്ചിരുന്നു. ഇപ്പോൾ 50 വയസ്സ് കഴിഞ്ഞവർക്കും Pulso Basic Caregiver ആയി ജോലി ചെയ്യാം.',
      '',
      PERKS,
      '',
      CLOSE
    ].join('\n')
  },
  {
    name: 'basic_invite_nursing_ml',
    body: [
      'നമസ്കാരം 🙏',
      '',
      'GNM / BSc Nursing കോഴ്സ് സർട്ടിഫിക്കറ്റ് ഇല്ലാത്തതിനാൽ മുമ്പ് താങ്കളുടെ അപേക്ഷ തുടരാൻ കഴിഞ്ഞില്ല. ഇപ്പോൾ സർട്ടിഫിക്കറ്റ് ഇല്ലാതെ തന്നെ Pulso Basic Caregiver ആയി ജോലി ചെയ്യാം. കോഴ്സ് പൂർത്തിയായി സർട്ടിഫിക്കറ്റ് ലഭിച്ചാൽ Nurse നിരക്കിലേക്ക് മാറാം.',
      '',
      PERKS,
      '',
      CLOSE
    ].join('\n')
  }
];

(async () => {
  for (const t of TEMPLATES) {
    try {
      const r = await axios.post(
        `https://graph.facebook.com/${version}/${WABA}/message_templates`,
        {
          name: t.name,
          language: 'ml',
          category: 'MARKETING',
          components: [
            { type: 'BODY', text: t.body },
            {
              type: 'BUTTONS',
              buttons: [
                { type: 'QUICK_REPLY', text: 'താൽപര്യമുണ്ട്' },
                { type: 'QUICK_REPLY', text: 'വേണ്ട' }
              ]
            }
          ]
        },
        { params: { access_token: token } }
      );
      console.log(t.name, '->', JSON.stringify(r.data));
    } catch (e) {
      console.error(t.name, 'FAILED:', JSON.stringify(e.response ? e.response.data : e.message));
      process.exitCode = 1;
    }
  }
})();
