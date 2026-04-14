const { initializeStorage } = require('../services/storage');
const { reconcileAcceptedTermsProviders } = require('../services/onboardingFlow');

async function main() {
  await initializeStorage();
  const phones = process.argv.slice(2);
  const result = await reconcileAcceptedTermsProviders(phones.length ? phones : null);
  console.log('[TERMS_ACCEPT_RECONCILE_RESULT]', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[TERMS_ACCEPT_RECONCILE_FATAL]', error);
  process.exit(1);
});
