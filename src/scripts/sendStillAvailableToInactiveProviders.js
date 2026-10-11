// One-time (11 Oct 2026): ask caregivers who joined through the old app form
// and never took a duty whether they are still available. Needs the approved
// template `caregiver_still_available` on the WABA, and a JSON file of targets
// (phone, fullName, sex, age, district, qualification, uid, completedAt)
// exported from the Pulso server's botOnboarding mirror.
//
//   node src/scripts/sendStillAvailableToInactiveProviders.js targets.json --dry-run
//   node src/scripts/sendStillAvailableToInactiveProviders.js targets.json --limit 5
//   node src/scripts/sendStillAvailableToInactiveProviders.js targets.json
const fs = require('fs');
const { initializeStorage } = require('../services/storage');
const { runStillAvailableForInactiveProviders } = require('../services/onboardingFlow');

async function main() {
  await initializeStorage();
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && a.endsWith('.json'));
  if (!file) throw new Error('targets.json required');
  const targets = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dryRun = args.includes('--dry-run');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1] || 0) : 0;
  const result = await runStillAvailableForInactiveProviders(targets, { dryRun, limit });
  console.log('[STILL_AVAILABLE_RESULT]', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[STILL_AVAILABLE_FATAL]', error);
  process.exit(1);
});
