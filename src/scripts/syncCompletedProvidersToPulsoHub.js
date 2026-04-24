const { initializeStorage } = require('../services/storage');
const { listProviders, getProvider, updateProvider } = require('../services/providerService');
const { syncProviderToPulsoHub } = require('../services/pulsoHubSyncService');

function isCompletedProvider(provider) {
  return Boolean(
    provider &&
      provider.phone &&
      provider.status === 'completed' &&
      provider.termsAccepted === true &&
      provider.verification &&
      provider.verification.status === 'verified'
  );
}

async function syncOne(provider) {
  try {
    const syncResult = await syncProviderToPulsoHub(provider);
    await updateProvider(provider.phone, {
      appSync: {
        status: syncResult.ok ? 'synced' : syncResult.skipped ? 'skipped' : 'failed',
        skipped: syncResult.skipped === true,
        reason: syncResult.reason || '',
        syncedAt: new Date().toISOString(),
        response: syncResult.data || null,
      },
    });
    return {
      phone: provider.phone,
      ok: syncResult.ok,
      skipped: syncResult.skipped === true,
      reason: syncResult.reason || '',
      result: syncResult.data || null,
    };
  } catch (error) {
    await updateProvider(provider.phone, {
      appSync: {
        status: 'failed',
        skipped: false,
        reason: error.message || 'sync_failed',
        syncedAt: new Date().toISOString(),
      },
    });
    return {
      phone: provider.phone,
      ok: false,
      skipped: false,
      reason: error.message || 'sync_failed',
    };
  }
}

async function main() {
  await initializeStorage();
  const phones = process.argv.slice(2);
  const providers = phones.length
    ? (await Promise.all(phones.map((phone) => getProvider(phone)))).filter(Boolean)
    : await listProviders();
  const completedProviders = providers.filter(isCompletedProvider);
  const results = [];

  for (const provider of completedProviders) {
    results.push(await syncOne(provider));
  }

  console.log(
    '[PULSO_HUB_SYNC_BACKFILL_RESULT]',
    JSON.stringify(
      {
        scanned: providers.length,
        attempted: completedProviders.length,
        synced: results.filter((item) => item.ok).length,
        skipped: results.filter((item) => item.skipped).length,
        failed: results.filter((item) => !item.ok && !item.skipped).length,
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[PULSO_HUB_SYNC_BACKFILL_FATAL]', error);
  process.exit(1);
});
