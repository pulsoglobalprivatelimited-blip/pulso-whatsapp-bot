const { STATUS, getFlowConfig } = require('../flow');
const { listProviders, updateProvider, appendHistory } = require('../services/providerService');
const { sendText } = require('../services/metaClient');
const { inferProviderRegion } = require('../services/regionService');

const DEFAULT_RECENT_DAYS = 7;
const DEFAULT_THROTTLE_MS = 1000;
const SCRIPT_SOURCE = 'resume_stuck_certificate_providers';

function parseArgs(argv) {
  const options = {
    write: false,
    send: false,
    recent: false,
    older: false,
    dryRun: false,
    full: false,
    fullPhones: false,
    limit: null,
    recentDays: DEFAULT_RECENT_DAYS,
    throttleMs: DEFAULT_THROTTLE_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split('=');
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      return argv[index];
    };

    if (arg === '--write') options.write = true;
    else if (arg === '--send') options.send = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--recent') options.recent = true;
    else if (arg === '--older') options.older = true;
    else if (arg === '--full') options.full = true;
    else if (arg === '--full-phones') options.fullPhones = true;
    else if (key === '--limit') options.limit = Number(readValue());
    else if (key === '--recent-days') options.recentDays = Number(readValue());
    else if (key === '--throttle-ms') options.throttleMs = Number(readValue());
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.help) {
    return options;
  }

  if (options.send && !options.write) {
    throw new Error('Refusing to send messages without --write. Use --write --send together.');
  }

  if (options.recent && options.older) {
    throw new Error('Use only one of --recent or --older.');
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive integer.');
  }

  if (!Number.isFinite(options.recentDays) || options.recentDays < 1) {
    throw new Error('--recent-days must be a positive number.');
  }

  if (!Number.isFinite(options.throttleMs) || options.throttleMs < 0) {
    throw new Error('--throttle-ms must be zero or a positive number.');
  }

  return options;
}

function printHelp() {
  console.log(`
Usage:
  npm run providers:resume-certificates -- --dry-run
  npm run providers:resume-certificates -- --dry-run --recent --limit 6
  npm run providers:resume-certificates -- --write --send --recent --limit 6

Options:
  --dry-run              Report only. This is the default unless --write is supplied.
  --write                Update matching providers.
  --send                 Send the next name-question WhatsApp message. Requires --write.
  --recent              Only include providers whose latest certificate upload is recent.
  --older               Only include providers whose latest certificate upload is older.
  --recent-days <days>   Recent window. Default: ${DEFAULT_RECENT_DAYS}.
  --limit <count>        Limit the selected providers.
  --throttle-ms <ms>     Delay between live sends. Default: ${DEFAULT_THROTTLE_MS}.
  --full                Print every selected provider instead of a preview.
  --full-phones          Print full phone numbers in the report.
`);
}

function parseDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time) : null;
}

function latestDate(values) {
  return values
    .map(parseDate)
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;
}

function getRecentCutoff(days) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

function maskPhone(phone, fullPhones) {
  if (fullPhones) return phone;
  const digits = String(phone || '').replace(/\D+/g, '');
  if (digits.length <= 4) return phone;
  return `${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

function getCertificateAttachments(provider) {
  return provider &&
    provider.documents &&
    Array.isArray(provider.documents.certificateAttachments)
    ? provider.documents.certificateAttachments
    : [];
}

function getMissingProfileFields(provider) {
  return [
    provider && provider.fullName ? null : 'fullName',
    provider && provider.age ? null : 'age',
    provider && provider.sex ? null : 'sex',
    provider && provider.district ? null : 'district'
  ].filter(Boolean);
}

function toCandidate(provider, cutoff) {
  const attachments = getCertificateAttachments(provider);
  const missingProfileFields = getMissingProfileFields(provider);
  const latestAttachment = latestDate(
    attachments.map((attachment) => attachment.receivedAt || attachment.archivedAt)
  );
  const region = inferProviderRegion(provider);

  return {
    provider,
    phone: provider.phone,
    region,
    attachmentCount: attachments.length,
    latestAttachmentAt: latestAttachment ? latestAttachment.toISOString() : null,
    updatedAt: provider.updatedAt || null,
    createdAt: provider.createdAt || null,
    currentStep: provider.currentStep || null,
    missingProfileFields,
    recent: Boolean(latestAttachment && latestAttachment >= cutoff)
  };
}

function isStuckCertificateProvider(provider) {
  return (
    provider &&
    provider.phone &&
    provider.status === STATUS.AWAITING_CERTIFICATE &&
    getCertificateAttachments(provider).length > 0 &&
    getMissingProfileFields(provider).length > 0
  );
}

function summarizeCandidates(candidates, options) {
  const preview = options.full ? candidates : candidates.slice(0, 20);
  return preview.map((candidate) => ({
    phone: maskPhone(candidate.phone, options.fullPhones),
    region: candidate.region || 'missing',
    attachmentCount: candidate.attachmentCount,
    latestAttachmentAt: candidate.latestAttachmentAt,
    updatedAt: candidate.updatedAt,
    missingProfileFields: candidate.missingProfileFields
  }));
}

function buildNameQuestion(provider) {
  const flow = getFlowConfig(provider.flowId);
  return flow && flow.MESSAGES && flow.MESSAGES.nameQuestion
    ? flow.MESSAGES.nameQuestion
    : 'Please send your full name.';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resumeProvider(candidate, options) {
  if (!candidate.region) {
    return { phone: candidate.phone, skipped: true, reason: 'missing_region' };
  }

  const resumedAt = new Date().toISOString();
  await updateProvider(candidate.phone, {
    status: STATUS.AWAITING_NAME,
    currentStep: 9,
    certificateUploadBackfill: {
      source: SCRIPT_SOURCE,
      resumedAt,
      previousStatus: STATUS.AWAITING_CERTIFICATE,
      previousStep: candidate.currentStep,
      attachmentCount: candidate.attachmentCount,
      latestAttachmentAt: candidate.latestAttachmentAt,
      missingProfileFields: candidate.missingProfileFields
    }
  });

  await appendHistory(candidate.phone, {
    type: 'system',
    event: 'certificate_upload_backfill_resumed',
    source: SCRIPT_SOURCE,
    previousStatus: STATUS.AWAITING_CERTIFICATE,
    previousStep: candidate.currentStep,
    nextStatus: STATUS.AWAITING_NAME,
    nextStep: 9,
    attachmentCount: candidate.attachmentCount,
    latestAttachmentAt: candidate.latestAttachmentAt,
    missingProfileFields: candidate.missingProfileFields
  });

  if (!options.send) {
    return { phone: candidate.phone, updated: true, sent: false };
  }

  const message = buildNameQuestion(candidate.provider);
  await sendText(candidate.phone, message);
  await appendHistory(candidate.phone, {
    type: 'outbound_message',
    sender: 'certificate-upload-backfill',
    payload: { kind: 'text', body: message }
  });

  return { phone: candidate.phone, updated: true, sent: true };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const cutoff = getRecentCutoff(options.recentDays);
  const providers = await listProviders();
  const allCandidates = providers
    .filter(isStuckCertificateProvider)
    .map((provider) => toCandidate(provider, cutoff))
    .sort((a, b) => Date.parse(b.latestAttachmentAt || 0) - Date.parse(a.latestAttachmentAt || 0));

  let selected = allCandidates;
  if (options.recent) {
    selected = selected.filter((candidate) => candidate.recent);
  } else if (options.older) {
    selected = selected.filter((candidate) => !candidate.recent);
  }

  if (options.limit !== null) {
    selected = selected.slice(0, options.limit);
  }

  const summary = {
    mode: options.write ? 'write' : 'dry_run',
    send: Boolean(options.send),
    scanned: providers.length,
    totalStuckWithCertificateFiles: allCandidates.length,
    recentDays: options.recentDays,
    recentCutoff: cutoff.toISOString(),
    recentCandidates: allCandidates.filter((candidate) => candidate.recent).length,
    olderCandidates: allCandidates.filter((candidate) => !candidate.recent).length,
    selected: selected.length,
    selectedPreview: summarizeCandidates(selected, options),
    selectedPreviewTruncated: !options.full && selected.length > 20,
    updated: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    failures: []
  };

  if (!options.write) {
    console.log('[RESUME_STUCK_CERTIFICATE_PROVIDERS]', JSON.stringify(summary, null, 2));
    return;
  }

  for (const candidate of selected) {
    try {
      const result = await resumeProvider(candidate, options);
      if (result.skipped) {
        summary.skipped += 1;
      }
      if (result.updated) {
        summary.updated += 1;
      }
      if (result.sent) {
        summary.sent += 1;
      }
      console.log(
        '[RESUME_STUCK_CERTIFICATE_PROVIDER]',
        JSON.stringify({
          phone: maskPhone(candidate.phone, options.fullPhones),
          updated: Boolean(result.updated),
          sent: Boolean(result.sent),
          skipped: Boolean(result.skipped),
          reason: result.reason || null
        })
      );
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        phone: maskPhone(candidate.phone, options.fullPhones),
        message: error.message,
        response: error.response ? error.response.data : null
      });
      console.error(
        '[RESUME_STUCK_CERTIFICATE_PROVIDER_FAILED]',
        JSON.stringify(summary.failures[summary.failures.length - 1], null, 2)
      );
    }

    if (options.send && options.throttleMs > 0) {
      await sleep(options.throttleMs);
    }
  }

  console.log('[RESUME_STUCK_CERTIFICATE_PROVIDERS]', JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[RESUME_STUCK_CERTIFICATE_PROVIDERS_FATAL]', error);
  process.exit(1);
});
