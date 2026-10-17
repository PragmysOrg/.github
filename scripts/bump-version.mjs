#!/usr/bin/env node
// Adds 1 to the third number (x.y.Z) of every version file listed, keeping them in step.
//
//   node bump-version.mjs [--dry-run] [--against <git-ref>] <file> [<file> ...]
//
// --against <ref> is the "already ahead" guard. The versions in the files at <ref> (the
// remote's current state: the push's parent commit, or the PR's base branch) are compared
// with the working tree:
//   working tree == ref  -> nothing has raised the version yet: bump
//   working tree  > ref  -> the change already raised it (a manual bump): do NOT bump again
//   working tree  < ref  -> this checkout is behind the remote: refuse (a bump would collide)
//   a file missing at ref (a new VERSION file) -> nothing to compare: do NOT bump
//
// A file is either JSON with a top-level "version" (package.json, manifest.json) or a
// plain-text VERSION file. All files must hold the same version before the bump; if
// they disagree nothing is written. With --dry-run (or outside CI) it only prints
// `file: old -> new`. Formatting of JSON files is preserved (only the version string
// is replaced, the file is not re-serialised).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

const parts = (v) => v.split('.').map(Number);
export function compare(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Reads `file` as it is at git `ref`; null when the file does not exist there. */
export function readAtRef(ref, file) {
  const r = spawnSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

/**
 * The guard. Returns { action, plan }, action one of 'bump' | 'skip-ahead' | 'skip-new'.
 * Throws when the working tree is behind the ref, or the files disagree at the ref.
 */
export function runGuarded(files, { against, dryRun = true, read, write, readBase = (f) => readAtRef(against, f) } = {}) {
  if (!against) return { action: 'bump', plan: run(files, { dryRun, read, write }) };
  const local = run(files, { dryRun: true, read, write });
  const bases = files.map((f) => ({ file: f, text: readBase(f) }));
  if (bases.some((b) => b.text === null)) {
    return { action: 'skip-new', plan: local.map((p) => ({ ...p, to: p.from })) };
  }
  const baseVersions = [...new Set(bases.map((b) => readVersion(b.file, b.text)))];
  if (baseVersions.length > 1) throw new Error(`version files disagree at ${against}: ${bases.map((b) => `${b.file}=${readVersion(b.file, b.text)}`).join(', ')}`);
  const c = compare(local[0].from, baseVersions[0]);
  if (c < 0) throw new Error(`this checkout (${local[0].from}) is behind ${against} (${baseVersions[0]}); refusing to bump`);
  if (c > 0) return { action: 'skip-ahead', plan: local.map((p) => ({ ...p, to: p.from })) };
  return { action: 'bump', plan: run(files, { dryRun, read, write }) };
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
  const i = args.indexOf('--against');
  const against = i >= 0 ? args[i + 1] : undefined;
  const files = args.filter((a, idx) => !a.startsWith('--') && idx !== i + 1);
  try {
    const { action, plan } = runGuarded(files, { against, dryRun });
    const note = { bump: dryRun ? '  (dry run, nothing written)' : '', 'skip-ahead': `  (already ahead of ${against}: not bumped)`, 'skip-new': `  (new at ${against}: nothing to compare, not bumped)` }[action];
    for (const p of plan) console.log(`${p.file}: ${p.from} -> ${p.to}${note}`);
  } catch (e) {
    console.error(`bump-version: ${e.message}`);
    process.exit(1);
  }
}
