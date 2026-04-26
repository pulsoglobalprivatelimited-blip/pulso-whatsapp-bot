const { initializeStorage } = require('../services/storage');
const { runMobileAppCampaignForCompletedProviders } = require('../services/onboardingFlow');

async function main() {
  await initializeStorage();
  const phones = process.argv.slice(2);
  const result = await runMobileAppCampaignForCompletedProviders(phones);
  console.log('[MOBILE_APP_CAMPAIGN_RESULT]', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[MOBILE_APP_CAMPAIGN_FATAL]', error);
  process.exit(1);
});
