// A short "update the Pulso App first" note, for caregivers who said they want
// to add their duty now but whose installed app predates the Duty Card.
// Plain text, so it must go inside the 24-hour window their tap opened.
//
//   node src/scripts/sendAppUpdateNudge.js --dry-run 919xxxxxxxxx 919yyyyyyyyy
//   node src/scripts/sendAppUpdateNudge.js 919xxxxxxxxx 919yyyyyyyyy
require('dotenv').config();
const { getProvider, appendHistory } = require('../services/providerService');
const { sendText } = require('../services/metaClient');
const { getFlowConfig, getProviderFlowId } = require('../flow');

const NUDGE = {
  ml:
    "Pulso App-ൽ 'Add my duty' കാണാൻ app update ചെയ്യണം.\n\n" +
    '1️⃣ Play Store തുറക്കുക\n' +
    '2️⃣ Pulso search ചെയ്ത് Update tap ചെയ്യുക\n' +
    "3️⃣ Pulso App തുറക്കുക — home screen-ൽ 'Working with an agency?' കാണാം. അതിൽ tap ചെയ്ത് duty add ചെയ്യുക.",
  en:
    "To see 'Add my duty' in the Pulso App, please update the app first.\n\n" +
    '1️⃣ Open Play Store\n' +
    '2️⃣ Search Pulso and tap Update\n' +
    "3️⃣ Open the Pulso App — on the home screen tap 'Working with an agency?' and add your duty.",
};

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const phones = args.filter((a) => !a.startsWith('--'));
  if (!phones.length) {
    console.error('usage: node src/scripts/sendAppUpdateNudge.js [--dry-run] <phone> [<phone> ...]');
    process.exit(1);
  }
  const results = [];
  for (const phone of phones) {
    const provider = await getProvider(phone);
    if (!provider) {
      results.push({ phone, sent: false, error: 'not_a_provider' });
      continue;
    }
    const language = (getFlowConfig(getProviderFlowId(provider)) || {}).language === 'en' ? 'en' : 'ml';
    if (dryRun) {
      results.push({ phone, sent: false, dryRun: true, language });
      continue;
    }
    try {
      await sendText(phone, NUDGE[language]);
      await appendHistory(phone, { type: 'outbound_message', sender: 'bot', payload: { kind: 'text', body: NUDGE[language] } });
      await appendHistory(phone, { type: 'system', event: 'app_update_nudge_sent', reason: 'duty_card_release' });
      results.push({ phone, sent: true, language });
    } catch (error) {
      results.push({ phone, sent: false, error: error.message || 'send_failed' });
    }
  }
  console.log(JSON.stringify({ sent: results.filter((r) => r.sent).length, failed: results.filter((r) => !r.sent && !r.dryRun).length, results }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
