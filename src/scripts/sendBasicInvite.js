// The Basic Caregiver invite (docs/basic_caregiver_invite_broadcast_plan.md,
// founder decisions 7 Oct 2026): people turned away for age, or for no
// completed GNM / BSc certificate, are invited back as Basic caregivers. One
// approved Marketing template per group, from the caregiver bot number.
//
// Dry run (the default) prints every phone, its group, its live status and why
// it would be skipped; nothing is sent and nothing is written:
//   node src/scripts/sendBasicInvite.js
//   node src/scripts/sendBasicInvite.js --csv /path/to/list.csv
//   node src/scripts/sendBasicInvite.js --phones 919000000001,919000000002 --group age
// Send (3 s apart):
//   node src/scripts/sendBasicInvite.js --send
//
// A tap on either button is answered in onboardingFlow.handleBasicInviteReply.
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_CSV = path.join(
  os.homedir(),
  'Downloads/pulso_rejected_lists/kerala_rejected_age_and_nursing_2026-10-04.csv'
);
const TEMPLATES = { age: 'basic_invite_age_ml', nursing: 'basic_invite_nursing_ml' };
const TEMPLATE_LANGUAGE = 'ml';
const AGE_LIMIT = 55;
const THROTTLE_MS = 3000;
// Where someone turned away still stands. Anyone else came back or finished.
const ELIGIBLE_STATUSES = [
  'age_rejected',
  'needs_human_review',
  'certificate_rejected_permanent',
  'awaiting_certificate',
  'additional_document_requested'
];

// Per message: index 0 "താൽപര്യമുണ്ട്" = yes, index 1 "വേണ്ട" = no.
const COMPONENTS = [
  { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'basic_invite_yes' }] },
  { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'basic_invite_no' }] }
];

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

// One CSV line, double-quoted fields with "" for a quote.
function parseCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] || '').trim()]));
  });
}

/* Rows → candidates with a group. "Age…" is the age group, but only 55 or under
   (blank age is kept: most of them have none on file); "Nursing…" is the
   nursing group. Anything else, or a repeat phone, is left out. */
function groupRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    const reason = String(row.reason || '').trim();
    let group = null;
    if (/^age/i.test(reason)) group = 'age';
    else if (/^nursing/i.test(reason)) group = 'nursing';
    if (!phone || !group || seen.has(phone)) continue;
    if (group === 'age' && String(row.age || '').trim()) {
      const age = Number(row.age);
      if (Number.isFinite(age) && age > AGE_LIMIT) continue;
    }
    seen.add(phone);
    out.push({ phone, group, name: row.name || '', csvAge: row.age || '' });
  }
  return out;
}

function hasEvent(provider, event) {
  const history = Array.isArray(provider && provider.history) ? provider.history : [];
  return history.some((e) => e && e.type === 'system' && e.event === event);
}

/* Pure: each candidate with its live record → { phone, group, status, skip }. */
function selectRecipients(candidates, providersByPhone) {
  return candidates.map((c) => {
    const provider = providersByPhone[c.phone] || null;
    const status = provider ? provider.status || null : null;
    let skip = null;
    if (!provider) skip = 'not_a_provider';
    else if (hasEvent(provider, 'basic_invite_sent')) skip = 'already_sent';
    else if (hasEvent(provider, 'basic_invite_declined')) skip = 'declined';
    else if (!ELIGIBLE_STATUSES.includes(status)) skip = `status_${status || 'none'}`;
    return { ...c, status, template: TEMPLATES[c.group], skip };
  });
}

/* deps: { getProvider, sendTemplate, appendHistory, updateProvider, sleep, log, phoneNumberId } */
async function runSend(candidates, deps, { send = false, throttleMs = THROTTLE_MS } = {}) {
  const log = deps.log || console.log;
  const providers = {};
  for (const c of candidates) providers[c.phone] = await deps.getProvider(c.phone);
  const rows = selectRecipients(candidates, providers);
  const summary = { mode: send ? 'send' : 'dry_run', total: rows.length, toSend: 0, sent: 0, failed: 0, skipped: 0, byGroup: { age: 0, nursing: 0 } };
  let first = true;
  for (const row of rows) {
    log(`${row.phone}\t${row.group}\t${row.status || '-'}\t${row.skip ? `SKIP ${row.skip}` : row.template}`);
    if (row.skip) { summary.skipped += 1; continue; }
    summary.toSend += 1;
    summary.byGroup[row.group] += 1;
    if (!send) continue;
    if (!first && throttleMs > 0) await deps.sleep(throttleMs);
    first = false;
    try {
      await deps.sendTemplate(row.phone, row.template, TEMPLATE_LANGUAGE, COMPONENTS, { phoneNumberId: deps.phoneNumberId });
      const at = new Date().toISOString();
      await deps.appendHistory(row.phone, { type: 'system', event: 'basic_invite_sent', group: row.group, template: row.template });
      await deps.updateProvider(row.phone, { basicInviteGroup: row.group, basicInviteSentAt: at });
      summary.sent += 1;
      row.sent = true;
    } catch (error) {
      summary.failed += 1;
      row.error = (error.response && JSON.stringify(error.response.data)) || error.message;
      log(`  FAILED ${row.phone}: ${row.error}`);
    }
  }
  log(JSON.stringify(summary));
  return { summary, rows };
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function candidatesFromArgs(args) {
  const phones = argValue(args, '--phones');
  if (phones) {
    const group = argValue(args, '--group');
    if (!TEMPLATES[group]) throw new Error('--phones needs --group age|nursing');
    return phones.split(',').map(normalizePhone).filter(Boolean).map((phone) => ({ phone, group, name: '', csvAge: '' }));
  }
  const file = argValue(args, '--csv') || DEFAULT_CSV;
  return groupRows(parseCsv(fs.readFileSync(file, 'utf8')));
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const candidates = candidatesFromArgs(args);
  const config = require('../config');
  const { getProvider, appendHistory, updateProvider } = require('../services/providerService');
  const { sendTemplate } = require('../services/metaClient');
  if (send && !config.phoneNumberId) throw new Error('WHATSAPP_PHONE_NUMBER_ID (the caregiver bot) is not set');
  // In WhatsApp dry-run mode nothing would leave, yet the history would say sent.
  if (send && config.dryRun) throw new Error('WHATSAPP_DRY_RUN is not "false"; refusing to record sends that would not go');
  console.log(`[BASIC_INVITE] ${send ? 'SENDING' : 'DRY RUN'} to ${candidates.length} candidates from phone number id ${config.phoneNumberId || '-'}`);
  await runSend(candidates, {
    getProvider,
    sendTemplate,
    appendHistory,
    updateProvider,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    phoneNumberId: config.phoneNumberId
  }, { send });
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error('[BASIC_INVITE_FATAL]', error);
    process.exit(1);
  });
}

module.exports = { parseCsv, groupRows, selectRecipients, runSend, TEMPLATES, COMPONENTS, ELIGIBLE_STATUSES };
