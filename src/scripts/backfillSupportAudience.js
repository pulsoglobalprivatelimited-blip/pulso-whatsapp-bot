/**
 * Stamp `audience: 'provider'` on support sessions written before the bot asked
 * who it was talking to.
 *
 * Every one of them arrived on a provider-only line, so re-asking a caregiver
 * mid-conversation would only look like the bot had lost their place. This is
 * about the dashboard filters, not the flow: the flow already reads a missing
 * audience as a provider.
 *
 *   node src/scripts/backfillSupportAudience.js          # report only
 *   node src/scripts/backfillSupportAudience.js --write  # apply
 */

const { getFirestore } = require('../services/storage');

const COLLECTION = 'providerSupportSessions';

async function main() {
  const write = process.argv.includes('--write');
  const snapshot = await getFirestore().collection(COLLECTION).get();

  const missing = snapshot.docs.filter((doc) => !(doc.data() || {}).audience);

  console.log(
    JSON.stringify(
      {
        mode: write ? 'write' : 'report',
        sessions: snapshot.size,
        alreadyTagged: snapshot.size - missing.length,
        toBackfill: missing.length
      },
      null,
      2
    )
  );

  if (!write || !missing.length) {
    if (!write && missing.length) {
      console.log('Re-run with --write to apply.');
    }
    return;
  }

  let written = 0;
  for (const doc of missing) {
    await doc.ref.set({ audience: 'provider', audienceSource: 'backfill' }, { merge: true });
    written += 1;
  }

  console.log(JSON.stringify({ written }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
