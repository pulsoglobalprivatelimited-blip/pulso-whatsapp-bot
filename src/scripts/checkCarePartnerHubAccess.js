/**
 * Can this deployment actually read care partners out of pulso-hub?
 *
 * The support bot writes to its own project but has to read `bureaus`,
 * `bureauInvites` and `users` from the hub. Those reads have never been made
 * from here before, so the service account may not carry them yet. Run this
 * once with the production credentials before turning PARTNER_HELP_ENABLED on —
 * a failure here is the difference between an agency being recognised and being
 * pitched as a stranger.
 *
 *   node src/scripts/checkCarePartnerHubAccess.js
 *   node src/scripts/checkCarePartnerHubAccess.js 919847012345
 */

const config = require('../config');
const { getHubFirestore } = require('../services/hubStorage');
const { lookupCarePartner, normalizeHubPhone } = require('../services/carePartnerService');

async function probe(label, run) {
  try {
    const detail = await run();
    console.log(`  ok    ${label}${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (error) {
    console.error(`  FAIL  ${label} — ${error.message}`);
    return false;
  }
}

async function main() {
  const phone = normalizeHubPhone(process.argv[2] || '');

  console.log(`Hub project: ${config.bookingFirebaseProjectId}`);
  console.log(`Partner help enabled: ${config.partnerHelpEnabled}`);
  console.log('Collection reads:');

  const db = getHubFirestore();
  const results = [];

  results.push(
    await probe('bureaus', async () => {
      const snap = await db.collection('bureaus').limit(1).get();
      return `${snap.size} doc(s) readable`;
    })
  );
  results.push(
    await probe('bureauInvites', async () => {
      const snap = await db.collection('bureauInvites').limit(1).get();
      return `${snap.size} doc(s) readable`;
    })
  );
  results.push(
    await probe('users', async () => {
      const snap = await db.collection('users').limit(1).get();
      return `${snap.size} doc(s) readable`;
    })
  );

  if (phone) {
    console.log(`\nLookup for ${phone}:`);
    const partner = await lookupCarePartner(phone);
    console.log(JSON.stringify(partner, null, 2));
    if (partner.lookupFailed) {
      results.push(false);
    }
  } else {
    console.log('\nPass a partner phone number to test the full lookup cascade.');
  }

  const ok = results.every(Boolean);
  console.log(`\n${ok ? 'PASSED' : 'FAILED'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
