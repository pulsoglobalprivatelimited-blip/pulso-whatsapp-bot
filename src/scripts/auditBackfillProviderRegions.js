const { listProviders, updateProvider, appendHistory } = require('../services/providerService');
const { FLOWS } = require('../flow');
const {
  getFlowIdForRegion,
  getRegionForFlowId,
  inferProviderRegion,
  normalizeRegion
} = require('../services/regionService');

function getFlowForRegion(region) {
  const flowId = getFlowIdForRegion(region);
  return flowId ? FLOWS[flowId] : null;
}

function getRegionReason(provider) {
  if (normalizeRegion(provider.region)) {
    return 'existing_region';
  }
  if (getRegionForFlowId(provider.flowId)) {
    return 'flow_id';
  }
  if (inferProviderRegion(provider)) {
    return 'district';
  }
  return 'unknown';
}

function buildRegionPatch(provider, region) {
  const flow = getFlowForRegion(region);
  const patch = {
    region,
    language: provider.language || (flow && flow.language) || null,
    flowId: provider.flowId || (flow && flow.id) || null,
    flowAssignmentSource: provider.flowAssignmentSource || 'region_backfill'
  };

  if (!provider.flowAssignedAt) {
    patch.flowAssignedAt = new Date().toISOString();
  }

  return patch;
}

async function main() {
  const shouldWrite = process.argv.includes('--write');
  const shouldPrintFullManualReview = process.argv.includes('--full');

  const providers = await listProviders();
  const summary = {
    scanned: providers.length,
    kerala: 0,
    karnataka: 0,
    missingOrInvalid: 0,
    backfillable: 0,
    updated: 0,
    manualReview: []
  };

  for (const provider of providers) {
    const region = inferProviderRegion(provider);
    const validExistingRegion = normalizeRegion(provider.region);

    if (region === 'kerala') summary.kerala += 1;
    if (region === 'karnataka') summary.karnataka += 1;

    if (!validExistingRegion) {
      summary.missingOrInvalid += 1;
    }

    if (!region) {
      summary.manualReview.push({
        phone: provider.phone,
        status: provider.status || '',
        flowId: provider.flowId || '',
        district: provider.district || '',
        region: provider.region || ''
      });
      continue;
    }

    const needsPatch =
      provider.region !== region ||
      !provider.flowId ||
      !provider.language;

    if (!needsPatch) {
      continue;
    }

    summary.backfillable += 1;

    if (shouldWrite) {
      await updateProvider(provider.phone, buildRegionPatch(provider, region));
      await appendHistory(provider.phone, {
        type: 'system',
        event: 'region_backfilled',
        region,
        reason: getRegionReason(provider)
      });
      summary.updated += 1;
    }
  }

  console.log(
    '[PROVIDER_REGION_AUDIT]',
    JSON.stringify(
      {
        mode: shouldWrite ? 'write' : 'dry_run',
        ...summary,
        manualReviewCount: summary.manualReview.length,
        manualReview: shouldPrintFullManualReview
          ? summary.manualReview
          : summary.manualReview.slice(0, 20)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('Provider region audit/backfill failed.', error);
  process.exit(1);
});
