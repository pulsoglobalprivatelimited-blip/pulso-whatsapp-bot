const config = require('../config');
const { listPendingAppActivationProviders } = require('./storage');

// A provider who signs into the app without ever tapping "installed" on
// WhatsApp used to sit at pending_verification until an admin noticed. The hub
// knows the moment the phone signed in; this sweep asks it, for everyone the
// bot still lists as pending, and flips the record when the answer is yes.
// Who is due is decided here; what to do with a yes lives in onboardingFlow.

let sweepInterval = null;
let sweepRunning = false;

function parseTimestamp(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function hoursToMs(hours) {
  return Math.max(0, Number(hours) || 0) * 60 * 60 * 1000;
}

// Fresh = tapped "installed" recently, so the sign-in is likely imminent and
// worth asking about every sweep. Everyone else is asked once per recheck
// interval, which keeps a few hundred stale records from costing a read
// every quarter hour for ever.
function isFresh(provider, nowMs) {
  if (provider.pulsoAppActivationStatus !== 'pending_verification') return false;
  const confirmedMs = parseTimestamp(provider.pulsoAppInstalledConfirmedAt);
  if (!confirmedMs) return false;
  return nowMs - confirmedMs <= hoursToMs(config.pulsoAppActivationFreshDays * 24);
}

function isDue(provider, nowMs = Date.now()) {
  const lastCheckMs = parseTimestamp(provider.pulsoAppHubCheckedAt);
  if (!lastCheckMs) return true;
  if (isFresh(provider, nowMs)) {
    return nowMs - lastCheckMs >= Math.max(1, config.pulsoAppActivationSweepIntervalMinutes) * 60 * 1000 - 1000;
  }
  return nowMs - lastCheckMs >= hoursToMs(config.pulsoAppActivationRecheckHours);
}

function pickDue(providers, nowMs = Date.now()) {
  const max = Math.max(1, config.pulsoAppActivationSweepMaxPerSweep);
  return providers
    .filter((provider) => isDue(provider, nowMs))
    // Never-checked first, then the longest-unchecked, so a backlog drains in order.
    .sort((a, b) => parseTimestamp(a.pulsoAppHubCheckedAt) - parseTimestamp(b.pulsoAppHubCheckedAt))
    .slice(0, max);
}

async function runPulsoAppActivationSweep(options = {}) {
  if (sweepRunning) {
    return { skipped: 'already_running' };
  }
  sweepRunning = true;
  const startedAt = Date.now();
  try {
    // Required lazily: onboardingFlow pulls in the whole bot, and this module
    // is loaded by the server before that is wanted.
    const { syncPulsoAppActivationFromHub } = options.sync
      ? { syncPulsoAppActivationFromHub: options.sync }
      : require('./onboardingFlow');
    const candidates = await listPendingAppActivationProviders();
    const due = pickDue(candidates, startedAt);
    const results = [];

    for (const candidate of due) {
      try {
        const result = await syncPulsoAppActivationFromHub(candidate.phone, {
          source: 'sweep',
          provider: candidate,
          notify: 'window'
        });
        results.push(result);
      } catch (error) {
        console.error('[PULSO_APP_SWEEP_ERROR]', JSON.stringify({ phone: candidate.phone, message: error.message }));
        results.push({ phone: candidate.phone, result: 'error', error: error.message });
      }
    }

    const summary = summarize(results);
    console.log(
      '[PULSO_APP_SWEEP]',
      JSON.stringify({
        candidates: candidates.length,
        checked: due.length,
        ...summary,
        durationMs: Date.now() - startedAt
      })
    );
    return { candidates: candidates.length, checked: due.length, ...summary, results };
  } finally {
    sweepRunning = false;
  }
}

function summarize(results) {
  const counts = {};
  for (const item of results) {
    const key = item && item.result ? item.result : 'error';
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    verified: counts.verified || 0,
    notified: results.filter((item) => item && item.result === 'verified' && item.notified).length,
    notActivated: counts.not_activated || 0,
    notMirrored: counts.not_mirrored || 0,
    errors: (counts.error || 0) + (counts.hub_error || 0) + (counts.verify_error || 0)
  };
}

function startPulsoAppActivationSweepScheduler() {
  if (!config.pulsoAppActivationSweepEnabled) {
    return null;
  }
  if (sweepInterval) {
    return sweepInterval;
  }

  const intervalMs = Math.max(1, config.pulsoAppActivationSweepIntervalMinutes) * 60 * 1000;
  sweepInterval = setInterval(() => {
    runPulsoAppActivationSweep().catch((error) => {
      console.error('[PULSO_APP_SWEEP_SCHEDULER_ERROR]', error);
    });
  }, intervalMs);

  return sweepInterval;
}

module.exports = {
  isDue,
  isFresh,
  pickDue,
  runPulsoAppActivationSweep,
  startPulsoAppActivationSweepScheduler
};
