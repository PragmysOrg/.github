#!/usr/bin/env node
// Adds 1 to the third number (x.y.Z) of every version file listed, keeping them in step.
//
//   node bump-version.mjs [--dry-run] <file> [<file> ...]
//
// A file is either JSON with a top-level "version" (package.json, manifest.json) or a
// plain-text VERSION file. All files must hold the same version before the bump; if
// they disagree nothing is written. With --dry-run (or outside CI) it only prints
// `file: old -> new`. Formatting of JSON files is preserved (only the version string
// is replaced, the file is not re-serialised).
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function bump(version) {
  const m = SEMVER.exec(String(version).trim());
  if (!m) throw new Error(`"${version}" is not a plain x.y.z version`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

const kindOf = (file) => (basename(file).toUpperCase() === 'VERSION' ? 'text' : 'json');
const JSON_VERSION = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/;

export function readVersion(file, text) {
  if (kindOf(file) === 'text') return text.trim();
  const m = JSON_VERSION.exec(text);
  if (!m) throw new Error(`${file}: no "version": "x.y.z" found`);
  return m[2];
}

function writeVersion(file, text, next) {
  if (kindOf(file) === 'text') return `${next}\n`;
  return text.replace(JSON_VERSION, `$1${next}$3`);
}

/** Plans (and optionally applies) the bump. Returns [{file, from, to}]; throws if files disagree. */
export function run(files, { dryRun = true, read = (f) => readFileSync(f, 'utf8'), write = writeFileSync } = {}) {
  if (files.length === 0) throw new Error('no version files given');
  const loaded = files.map((file) => {
    const text = read(file);
    return { file, text, from: readVersion(file, text) };
  });
  const distinct = [...new Set(loaded.map((l) => l.from))];
  if (distinct.length > 1) {
    throw new Error(`version files disagree, refusing to bump: ${loaded.map((l) => `${l.file}=${l.from}`).join(', ')}`);
  }
  const to = bump(distinct[0]);
  const plan = loaded.map((l) => ({ file: l.file, from: l.from, to }));
  if (!dryRun) for (const l of loaded) write(l.file, writeVersion(l.file, l.text, to));
  return plan;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const files = args.filter((a) => !a.startsWith('--'));
  try {
    const plan = run(files, { dryRun });
    for (const p of plan) console.log(`${p.file}: ${p.from} -> ${p.to}${dryRun ? '  (dry run, nothing written)' : ''}`);
  } catch (e) {
    console.error(`bump-version: ${e.message}`);
    process.exit(1);
  }
}
