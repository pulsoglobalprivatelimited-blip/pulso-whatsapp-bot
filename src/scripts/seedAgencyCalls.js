#!/usr/bin/env node
'use strict';

/**
 * Load a call sheet into the calling bot.
 *
 *   node src/scripts/seedAgencyCalls.js <csv> [--batch 2026-10-06] [--commit]
 *
 * Without --commit it only reports what it would do. Re-running is safe: an
 * agency that already exists keeps its outcome, attempts and notes, and only
 * its details are refreshed — an import must never undo an evening of calls.
 *
 * The CSV is the one cut on 5 Oct 2026 from the broadcast log:
 * senior/pulso_hub/docs/agency_calls_abdul_2026-10-06.csv
 */
const fs = require('fs');
const path = require('path');
const { seedAgencies } = require('../services/agencyCallStore');

/** A small CSV reader: quoted fields, commas inside them, nothing more. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => String(v).trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const commit = args.includes('--commit');
  const batchFlag = args.indexOf('--batch');
  const batch = batchFlag >= 0 ? args[batchFlag + 1] : path.basename(file || '', '.csv');
  if (!file) {
    console.error('usage: node src/scripts/seedAgencyCalls.js <csv> [--batch name] [--commit]');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(file, 'utf8')).map((r) => ({
    agency: r.agency,
    district: r.district,
    phone: r.phone,
    source: r.source,
    group: r.group || '',
    messagedOn: r.messaged_on || '',
    repliedToBroadcast: /replied/i.test(r.status || ''),
    order: Number(r.call_order || r.no || 0) || 0,
    batch,
  })).filter((r) => r.phone && r.agency);

  const replied = rows.filter((r) => r.repliedToBroadcast).length;
  const districts = rows.reduce((acc, r) => { acc[r.district] = (acc[r.district] || 0) + 1; return acc; }, {});
  console.log(`${file}: ${rows.length} agencies, ${replied} already replied`);
  console.log('districts:', districts);
  console.log('first:', rows[0] && `${rows[0].order}. ${rows[0].agency} ${rows[0].phone}`);

  if (!commit) {
    console.log('\nDry run. Re-run with --commit to write them.');
    return;
  }
  const result = await seedAgencies(rows);
  console.log('\nwritten:', result);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
