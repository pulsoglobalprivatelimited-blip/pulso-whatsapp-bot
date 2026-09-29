// Puts already-completed providers into the ops Google Contacts account.
//
// The live hook only fires on new completions, so everyone who finished before
// it shipped is missing from the phone book. Safe to re-run: a provider with a
// stored resourceName is skipped, so a second pass adds nobody twice.
//
// Most completed providers were typed into the ops phone by hand long before
// this script existed (460 of 507 on the first run). Those are looked up by
// number and linked to the existing entry, not created again. Test identities
// are dropped before anything is counted.
//
//   node src/scripts/backfillProviderContacts.js --dry-run
//   node src/scripts/backfillProviderContacts.js --limit=20
//   node src/scripts/backfillProviderContacts.js
const { initializeStorage } = require('../services/storage');
const { listProviders, updateProvider } = require('../services/providerService');
const {
  saveProviderContact,
  buildProviderContactBody,
  listExistingContactsByPhone,
  isTestIdentity,
  phoneKey,
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
  const completed = all.filter(isCompletedProvider);
  const testIdentities = completed.filter((p) => isTestIdentity(p.phone));
  let pending = completed.filter((p) => !isTestIdentity(p.phone));
  pending = pending.filter((p) => !(p.contactSync && p.contactSync.resourceName));
  if (limit > 0) pending = pending.slice(0, limit);

  // One read of the whole account; empty when no credentials are configured,
  // in which case nothing below can be linked and the dry run says so.
  const existingByPhone = await listExistingContactsByPhone();
  const alreadyThere = pending.filter((p) => existingByPhone.has(phoneKey(p.phone)));
  const toCreate = pending.filter((p) => !existingByPhone.has(phoneKey(p.phone)));

  console.log(`  completed providers : ${completed.length}`);
  console.log(`  test identities     : ${testIdentities.length} (never saved)`);
  console.log(`  needing a contact   : ${pending.length}`);
  console.log(`  contacts in account : ${existingByPhone.size}${existingByPhone.size ? '' : ' (no credentials - nothing can be linked)'}`);
  console.log(`  already in account  : ${alreadyThere.length} (linked, not created)`);
  console.log(`  to create           : ${toCreate.length}`);
  console.log(`  mode                : ${dryRun ? 'dry run - nothing written' : 'live'}\n`);

  if (dryRun) {
    for (const provider of toCreate.slice(0, 15)) {
      const body = buildProviderContactBody(provider);
      const org = body.organizations[0];
      console.log(
        `  ${body.names[0].givenName}  |  ${body.phoneNumbers ? body.phoneNumbers[0].value : '-'}` +
          `  |  ${org.name}${org.title ? ' — ' + org.title : ''}` +
          `  |  ${body.addresses ? body.addresses[0].formattedValue : '-'}`
      );
    }
    if (toCreate.length > 15) console.log(`  ... and ${toCreate.length - 15} more`);
    process.exit(0);
  }

  const tally = { saved: 0, linked: 0, skipped: 0, failed: 0 };
  for (const provider of pending) {
    const result = await saveProviderContact(provider, { existingByPhone });
    if (result.ok && !result.skipped) tally.saved += 1;
    else if (result.reason === 'already_in_google') tally.linked += 1;
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
    // Only a create touches Google's write quota; a link is a Firestore write.
    if (result.ok && !result.skipped) await wait(PAUSE_MS);
  }

  console.log(
    `\n  created ${tally.saved} | linked ${tally.linked} | skipped ${tally.skipped} | failed ${tally.failed}`
  );
  process.exit(0);
})().catch((error) => {
  console.error('  backfill error:', error.message);
  process.exit(1);
});
