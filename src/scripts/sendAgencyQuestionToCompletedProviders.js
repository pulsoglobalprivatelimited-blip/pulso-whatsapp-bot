// One-time: ask caregivers who finished onboarding before the Duty Card
// existed whether they work with an agency. Needs the approved template
// `duty_card_agency_question` on the WABA.
//
//   node src/scripts/sendAgencyQuestionToCompletedProviders.js --dry-run
//   node src/scripts/sendAgencyQuestionToCompletedProviders.js --limit 20
//   node src/scripts/sendAgencyQuestionToCompletedProviders.js 9190000001xx 9190000002xx
const { initializeStorage } = require('../services/storage');
const { runAgencyQuestionForCompletedProviders } = require('../services/onboardingFlow');

async function main() {
  await initializeStorage();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1] || 0) : 0;
  const phones = args.filter((a, i) => !a.startsWith('--') && !(limitIndex >= 0 && i === limitIndex + 1));
  const result = await runAgencyQuestionForCompletedProviders(phones, { dryRun, limit });
  console.log('[AGENCY_QUESTION_BACKFILL_RESULT]', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[AGENCY_QUESTION_BACKFILL_FATAL]', error);
  process.exit(1);
});
