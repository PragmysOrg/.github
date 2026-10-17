import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bump, readVersion, run } from './bump-version.mjs';

const mem = (files) => ({
  read: (f) => files[f],
  write: (f, t) => { files[f] = t; },
});

test('adds one to the third number only', () => {
  assert.equal(bump('1.1.5'), '1.1.6');
  assert.equal(bump('0.0.5'), '0.0.6');
  assert.equal(bump('1.2.0'), '1.2.1');
  assert.equal(bump('1.2.9'), '1.2.10'); // no carry into the second number
  assert.equal(bump('9.9.99'), '9.9.100');
});

test('rejects anything that is not plain x.y.z', () => {
  for (const bad of ['', '1.2', '1.2.3.4', 'v1.2.3', '1.2.3-beta', '1.2.x', 'latest']) {
    assert.throws(() => bump(bad), /plain x\.y\.z/, bad);
  }
});

test('reads JSON and VERSION files', () => {
  assert.equal(readVersion('package.json', '{\n  "name": "x",\n  "version": "1.1.5"\n}\n'), '1.1.5');
  assert.equal(readVersion('VERSION', '1.2.0\n'), '1.2.0');
  assert.throws(() => readVersion('package.json', '{"name":"x"}'), /no "version"/);
});

test('dry run plans every file and writes nothing', () => {
  const files = { 'package.json': '{"version": "1.1.5"}', 'manifest.json': '{"version": "1.1.5"}' };
  const before = JSON.stringify(files);
  const plan = run(['package.json', 'manifest.json'], { dryRun: true, ...mem(files) });
  assert.deepEqual(plan, [
    { file: 'package.json', from: '1.1.5', to: '1.1.6' },
    { file: 'manifest.json', from: '1.1.5', to: '1.1.6' },
  ]);
  assert.equal(JSON.stringify(files), before);
});

test('a real run bumps all files together and preserves formatting', () => {
  const files = {
    'package.json': '{\n  "name": "ext",\n  "version": "1.1.5",\n  "private": true\n}\n',
    'manifest.json': '{\n    "manifest_version": 3,\n    "version": "1.1.5"\n}\n',
    VERSION: '1.1.5\n',
  };
  run(['package.json', 'manifest.json', 'VERSION'], { dryRun: false, ...mem(files) });
  assert.equal(files['package.json'], '{\n  "name": "ext",\n  "version": "1.1.6",\n  "private": true\n}\n');
  assert.equal(files['manifest.json'], '{\n    "manifest_version": 3,\n    "version": "1.1.6"\n}\n');
  assert.equal(files.VERSION, '1.1.6\n');
});

test('only the top-level version is touched, not dependency versions', () => {
  const files = { 'package.json': '{"version": "0.0.5", "dependencies": {"x": "1.0.0"}}' };
  run(['package.json'], { dryRun: false, ...mem(files) });
  assert.equal(files['package.json'], '{"version": "0.0.6", "dependencies": {"x": "1.0.0"}}');
});

test('files that disagree are refused and nothing is written', () => {
  const files = { 'package.json': '{"version": "1.1.5"}', 'manifest.json': '{"version": "1.1.4"}' };
  const before = JSON.stringify(files);
  assert.throws(() => run(['package.json', 'manifest.json'], { dryRun: false, ...mem(files) }), /disagree.*package\.json=1\.1\.5.*manifest\.json=1\.1\.4/);
  assert.equal(JSON.stringify(files), before);
});

test('no files is an error', () => {
  assert.throws(() => run([]), /no version files/);
});
