const { initializeStorage } = require('../services/storage');
const { runLegacyTermsReminderBackfill } = require('../services/onboardingFlow');

async function main() {
  await initializeStorage();
  const result = await runLegacyTermsReminderBackfill();
  console.log('[TERMS_REMINDER_BACKFILL_RESULT]', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[TERMS_REMINDER_BACKFILL_FATAL]', error);
  process.exit(1);
});
