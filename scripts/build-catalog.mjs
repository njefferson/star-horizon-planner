#!/usr/bin/env node
// =============================================================================
// build-catalog.mjs — curate OpenNGC into a small, instrument-NEUTRAL catalog
// the app bundles for offline use.
//
//   node scripts/build-catalog.mjs build [--force]   # fetch → filter → write
//   node scripts/build-catalog.mjs validate          # CI gate on the committed file
//
// Source: OpenNGC (https://github.com/mattiaverga/OpenNGC), CC-BY-SA-4.0 —
// factual catalog data (names, coordinates, magnitudes, sizes). We keep raw
// angular size and DO NOT bake any fit/mosaic flag: fit-vs-mosaic is computed
// at runtime against the ACTIVE instrument's FOV, so one catalog serves every
// scope. Set CATALOG_CSV to a local path to build offline.
// =============================================================================
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'data', 'catalog.json');
const CSV_URL = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';
const MAG_LIMIT = 12;       // include NGC/IC at or brighter than this (Messier always in)
const SOURCE = 'OpenNGC (https://github.com/mattiaverga/OpenNGC), CC-BY-SA-4.0';

// The deep-sky types that earn a spot on brightness alone (non-Messier).
const DSO_TYPES = new Set([
  'G', 'GPair', 'GTrpl', 'GGroup', 'OCl', 'GCl', 'Cl+N',
  'PN', 'HII', 'Neb', 'EmN', 'RfN', 'SNR',
]);
// OpenNGC type code → friendly label. A superset of DSO_TYPES so Messier-only
// oddballs still read nicely (M24 is a star cloud, typed *Ass in OpenNGC)
// WITHOUT those codes qualifying non-Messier objects for the bundle.
const TYPE_LABEL = {
  G: 'Galaxy', GPair: 'Galaxy pair', GTrpl: 'Galaxy triplet', GGroup: 'Galaxy group',
  OCl: 'Open cluster', GCl: 'Globular cluster', 'Cl+N': 'Cluster + nebula',
  PN: 'Planetary nebula', HII: 'HII region', Neb: 'Nebula',
  EmN: 'Emission nebula', RfN: 'Reflection nebula', SNR: 'Supernova remnant',
  '*Ass': 'Star cloud', Other: 'Other',
};

const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };

// "HH:MM:SS.ss" → decimal hours; "±DD:MM:SS.s" → decimal degrees.
function raHours(s) {
  const [h, m, sec] = s.split(':').map(Number);
  if ([h, m, sec].some((x) => Number.isNaN(x))) return null;
  return h + m / 60 + sec / 3600;
}
function decDeg(s) {
  const sign = s.trim().startsWith('-') ? -1 : 1;
  const [d, m, sec] = s.replace('+', '').replace('-', '').split(':').map(Number);
  if ([d, m, sec].some((x) => Number.isNaN(x))) return null;
  return sign * (d + m / 60 + sec / 3600);
}

// Pretty designation from the OpenNGC compact Name (NGC0224 → "NGC 224").
function displayName(name) {
  const m = name.match(/^(NGC|IC)0*(\d+.*)$/);
  return m ? `${m[1]} ${m[2]}` : name;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(';');
  const col = (name) => header.indexOf(name);
  const idx = {
    name: col('Name'), type: col('Type'), ra: col('RA'), dec: col('Dec'),
    maj: col('MajAx'), min: col('MinAx'), bmag: col('B-Mag'), vmag: col('V-Mag'),
    m: col('M'), common: col('Common names'),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(';');
    rows.push({
      name: f[idx.name], type: f[idx.type], ra: f[idx.ra], dec: f[idx.dec],
      maj: f[idx.maj], min: f[idx.min], bmag: f[idx.bmag], vmag: f[idx.vmag],
      m: f[idx.m], common: f[idx.common],
    });
  }
  return rows;
}

function curate(rows) {
  const out = [];
  for (const r of rows) {
    if (!r.name || !r.ra || !r.dec) continue;
    const messier = r.m ? parseInt(r.m, 10) : null;
    const isDso = DSO_TYPES.has(r.type);
    if (!messier && !isDso) continue; // keep DSOs and any Messier object

    const mag = num(r.vmag) ?? num(r.bmag); // prefer V, fall back to B
    // Non-Messier objects must be reasonably bright to make the bundle.
    if (!messier && !(mag != null && mag <= MAG_LIMIT)) continue;

    const ra = raHours(r.ra), dec = decDeg(r.dec);
    if (ra == null || dec == null) continue;

    const maj = num(r.maj), min = num(r.min);
    out.push({
      id: r.name,
      name: displayName(r.name),
      m: messier,
      common: (r.common && r.common.trim()) || null,
      type: r.type,
      typeLabel: TYPE_LABEL[r.type] || r.type,
      ra: round(ra, 5),
      dec: round(dec, 4),
      mag: mag != null ? round(mag, 2) : null,
      size: maj != null ? { maj, min: min ?? maj } : null, // arcmin, raw
    });
  }
  // Messier first (by number), then the rest brightest-first — a sensible
  // default order; the UI re-sorts anyway.
  out.sort((a, b) => {
    if (a.m && b.m) return a.m - b.m;
    if (a.m) return -1;
    if (b.m) return 1;
    return (a.mag ?? 99) - (b.mag ?? 99);
  });
  return out;
}

const round = (x, p) => { const k = 10 ** p; return Math.round(x * k) / k; };

async function loadCsv() {
  if (process.env.CATALOG_CSV) return readFile(process.env.CATALOG_CSV, 'utf8');
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`fetch OpenNGC failed: ${res.status}`);
  return res.text();
}

async function build(force) {
  if (existsSync(OUT) && !force) {
    console.log(`${OUT} exists — pass --force to rebuild. (Validating instead.)`);
    return validate();
  }
  const csv = await loadCsv();
  const objects = curate(parseCsv(csv));
  const doc = {
    _generated: 'AUTO-GENERATED by scripts/build-catalog.mjs — do not edit by hand',
    _source: SOURCE,
    builtAt: new Date().toISOString(),
    magLimit: MAG_LIMIT,
    count: objects.length,
    objects,
  };
  await writeFile(OUT, JSON.stringify(doc, null, 0) + '\n');
  const messier = objects.filter((o) => o.m).length;
  console.log(`Wrote ${objects.length} objects (${messier} Messier) → ${OUT}`);
  console.log(`Size: ${(JSON.stringify(doc).length / 1024).toFixed(0)} KB`);
}

// CI gate: the committed catalog must parse and every record must be sane.
async function validate() {
  const doc = JSON.parse(await readFile(OUT, 'utf8'));
  const errs = [];
  if (!Array.isArray(doc.objects) || doc.objects.length === 0) errs.push('no objects');
  if (doc.count !== doc.objects.length) errs.push('count mismatch');
  const ids = new Set();
  for (const o of doc.objects) {
    const tag = o.id || '(no id)';
    if (!o.id) errs.push('missing id');
    if (ids.has(o.id)) errs.push(`duplicate id ${o.id}`);
    ids.add(o.id);
    if (!(o.ra >= 0 && o.ra < 24)) errs.push(`${tag}: ra out of range ${o.ra}`);
    if (!(o.dec >= -90 && o.dec <= 90)) errs.push(`${tag}: dec out of range ${o.dec}`);
    if (o.mag != null && !Number.isFinite(o.mag)) errs.push(`${tag}: bad mag`);
    if (o.size && !(o.size.maj > 0)) errs.push(`${tag}: bad size`);
    if (!o.type) errs.push(`${tag}: missing type`);
  }
  if (errs.length) {
    console.error(`validate FAILED (${errs.length}):`);
    for (const e of errs.slice(0, 20)) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`validate OK — ${doc.objects.length} objects, built ${doc.builtAt}`);
}

const cmd = process.argv[2] || 'build';
const force = process.argv.includes('--force');
if (cmd === 'build') await build(force);
else if (cmd === 'validate') await validate();
else { console.error(`unknown command: ${cmd}`); process.exit(2); }
