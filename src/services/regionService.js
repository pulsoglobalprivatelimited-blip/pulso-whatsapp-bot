const { FLOWS, STATUS } = require('../flow');

const FLOW_IDS_BY_REGION = Object.values(FLOWS).reduce((acc, flow) => {
  acc[flow.region] = flow.id;
  return acc;
}, {});

const DISTRICT_REGIONS = Object.values(FLOWS).reduce((acc, flow) => {
  flow.DISTRICTS.forEach((district) => {
    acc[String(district.value).trim().toLowerCase()] = flow.region;
  });
  return acc;
}, {});

function normalizeRegion(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'kerala' || normalized === 'karnataka') {
    return normalized;
  }
  return null;
}

function getFlowIdForRegion(region) {
  return FLOW_IDS_BY_REGION[normalizeRegion(region)] || null;
}

function getRegionForFlowId(flowId) {
  const flow = FLOWS[flowId];
  return flow ? flow.region : null;
}

function inferRegionFromDistrict(district) {
  return DISTRICT_REGIONS[String(district || '').trim().toLowerCase()] || null;
}

function inferProviderRegion(provider) {
  if (!provider) {
    return null;
  }

  return (
    normalizeRegion(provider.region) ||
    getRegionForFlowId(provider.flowId) ||
    inferRegionFromDistrict(provider.district)
  );
}

function applyRegionDefaults(provider) {
  const next = { ...provider };
  const hasRegionField = Object.prototype.hasOwnProperty.call(next, 'region');
  const normalizedRegion = normalizeRegion(next.region);
  const flowRegion = getRegionForFlowId(next.flowId);

  if (next.region && !normalizedRegion) {
    throw new Error(`Invalid provider region: ${next.region}`);
  }

  if (next.flowId && !FLOWS[next.flowId]) {
    throw new Error(`Invalid provider flowId: ${next.flowId}`);
  }

  if (normalizedRegion && flowRegion && normalizedRegion !== flowRegion) {
    throw new Error(`Provider region ${normalizedRegion} does not match flowId ${next.flowId}`);
  }

  if (normalizedRegion) {
    next.region = normalizedRegion;
  } else if (flowRegion) {
    next.region = flowRegion;
  } else if (hasRegionField && next.region === '') {
    next.region = null;
  }

  if (next.region && !next.flowId) {
    next.flowId = getFlowIdForRegion(next.region);
  }

  if (next.flowId && FLOWS[next.flowId] && !next.language) {
    next.language = FLOWS[next.flowId].language;
  }

  return next;
}

function statusRequiresRegion(status) {
  return Boolean(status && ![STATUS.NEW, STATUS.AWAITING_REGION_SELECTION].includes(status));
}

module.exports = {
  normalizeRegion,
  getFlowIdForRegion,
  getRegionForFlowId,
  inferRegionFromDistrict,
  inferProviderRegion,
  applyRegionDefaults,
  statusRequiresRegion
};
