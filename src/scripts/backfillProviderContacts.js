// Puts already-completed providers into the ops Google Contacts account.
//
// The live hook only fires on new completions, so everyone who finished before
// it shipped is missing from the phone book. Safe to re-run: a provider with a
// stored resourceName is skipped, so a second pass adds nobody twice.
//
//   node src/scripts/backfillProviderContacts.js --dry-run
//   node src/scripts/backfillProviderContacts.js --limit=20
//   node src/scripts/backfillProviderContacts.js
const { initializeStorage } = require('../services/storage');
const { listProviders, updateProvider } = require('../services/providerService');
const {
  saveProviderContact,
  buildProviderContactBody,
} = require('../services/googleContactsService');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 0;

function isCompletedProvider(provider) {
  return Boolean(
    provider &&
      provider.phone &&
      provider.status === 'completed' &&
      provider.termsAccepted === true
  );
}

// Google's write quota for the People API is generous but not unlimited, and a
// burst of 483 creates from one token is exactly the shape that trips it. A
// small gap keeps the run under the per-minute ceiling.
const PAUSE_MS = 250;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  await initializeStorage();
  const all = await listProviders();
  let pending = all.filter(isCompletedProvider);
  pending = pending.filter((p) => !(p.contactSync && p.contactSync.resourceName));
  if (limit > 0) pending = pending.slice(0, limit);

  console.log(`  completed providers : ${all.filter(isCompletedProvider).length}`);
  console.log(`  needing a contact   : ${pending.length}`);
  console.log(`  mode                : ${dryRun ? 'dry run - nothing written' : 'live'}\n`);

  if (dryRun) {
    for (const provider of pending.slice(0, 15)) {
      const body = buildProviderContactBody(provider);
      const org = body.organizations[0];
      console.log(
        `  ${body.names[0].givenName}  |  ${body.phoneNumbers ? body.phoneNumbers[0].value : '-'}` +
          `  |  ${org.name}${org.title ? ' — ' + org.title : ''}` +
          `  |  ${body.addresses ? body.addresses[0].formattedValue : '-'}`
      );
    }
    if (pending.length > 15) console.log(`  ... and ${pending.length - 15} more`);
    process.exit(0);
  }

  const tally = { saved: 0, skipped: 0, failed: 0 };
  for (const provider of pending) {
    const result = await saveProviderContact(provider);
    if (result.ok && !result.skipped) tally.saved += 1;
    else if (result.skipped) tally.skipped += 1;
    else tally.failed += 1;

    await updateProvider(provider.phone, {
      contactSync: {
        status: result.ok ? 'saved' : result.skipped ? 'skipped' : 'failed',
        skipped: result.skipped === true,
        reason: result.reason || '',
        savedAt: new Date().toISOString(),
        resourceName: result.resourceName || '',
        name: result.name || '',
      },
    });

    if (!result.ok && !result.skipped) {
      console.error(`  failed ${provider.phone}: ${result.reason}`);
    }
    // A configuration problem fails identically for all 483; stop rather than
    // grind through the whole list writing the same reason to every record.
    if (result.reason === 'missing_contacts_configuration') {
      console.error('\n  No contacts credentials configured. Nothing further attempted.');
      break;
    }
    await wait(PAUSE_MS);
  }

  console.log(`\n  saved ${tally.saved} | skipped ${tally.skipped} | failed ${tally.failed}`);
  process.exit(0);
})().catch((error) => {
  console.error('  backfill error:', error.message);
  process.exit(1);
});
