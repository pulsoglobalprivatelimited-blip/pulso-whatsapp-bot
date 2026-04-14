const { initializeStorage } = require('../services/storage');
const { runCurrentWaitingTermsReminderBackfill } = require('../services/onboardingFlow');

async function main() {
  await initializeStorage();
  const result = await runCurrentWaitingTermsReminderBackfill();
  console.log('[TERMS_REMINDER_CURRENT_BACKFILL_RESULT]', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[TERMS_REMINDER_CURRENT_BACKFILL_FATAL]', error);
  process.exit(1);
});
