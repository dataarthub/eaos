import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkGenerated } from './check-generated.mjs';

function fixture(run) {
 const root = mkdtempSync(join(tmpdir(), 'freshness-test-'));
 try {
  mkdirSync(join(root, 'generated'));
  writeFileSync(join(root, 'source.txt'), 'current');
  writeFileSync(join(root, 'generated/page.md'), 'current');
  writeFileSync(join(root, 'generator.mjs'), `
import {mkdirSync, writeFileSync, readFileSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
const [out, mode] = process.argv.slice(2);
if (mode === 'record' || mode === 'record-fail') writeFileSync('output-directory.txt', out);
if (mode === 'fail' || mode === 'record-fail') process.exit(7);
if (mode === 'timeout') await new Promise(r => setTimeout(r, 2000));
if (mode === 'empty') process.exit(0);
mkdirSync(join(out, 'generated'), {recursive:true});
if (mode === 'link') symlinkSync(process.cwd() + '/source.txt', join(out, 'generated/page.md'));
else writeFileSync(join(out, 'generated/page.md'), readFileSync('source.txt'));
if (mode === 'unregistered') writeFileSync(join(out, 'unregistered.txt'), 'extra');
`);
  const config = (mode = 'same') => ({ schemaVersion: 1, jobs: [{ name: 'docs', command: [process.execPath, 'generator.mjs', '{outputDir}', mode], outputs: ['generated'] }] });
  return run(root, config);
 } finally { rmSync(root, { recursive: true, force: true }); }
}

test('passes byte-identical regeneration without touching original outputs', () => fixture((root, config) => {
 const before = readFileSync(join(root, 'generated/page.md'));
 assert.deepEqual(checkGenerated(root, config()), [{ name: 'docs', differences: [] }]);
 assert.deepEqual(readFileSync(join(root, 'generated/page.md')), before);
}));
test('reports changed, missing and extra outputs without repairing them', () => fixture((root, config) => {
 writeFileSync(join(root, 'generated/page.md'), 'stale');
 writeFileSync(join(root, 'generated/old.md'), 'obsolete');
 const result = checkGenerated(root, config())[0].differences;
 assert.deepEqual(result, [{ path: 'generated/old.md', kind: 'extra' }, { path: 'generated/page.md', kind: 'changed' }]);
 assert.equal(readFileSync(join(root, 'generated/page.md'), 'utf8'), 'stale');
 rmSync(join(root, 'generated/page.md'));
 assert(checkGenerated(root, config())[0].differences.some(d => d.path === 'generated/page.md' && d.kind === 'missing'));
}));
test('fails on generator errors and timeout', () => fixture((root, config) => {
 assert.throws(() => checkGenerated(root, config('fail')), /docs.*(?:failed|exited)/i);
 const value = config('timeout'); value.jobs[0].timeoutMs = 50;
 assert.throws(() => checkGenerated(root, value), /docs.*(?:timeout|timed out)/i);
}));
test('fails when a generator ignores the output destination or emits nothing', () => fixture((root, config) => {
 assert.throws(() => checkGenerated(root, config('empty')), /no.*(?:file|output)/i);
}));
test('rejects output outside the declared generated scopes', () => fixture((root, config) => {
 assert.throws(() => checkGenerated(root, config('unregistered')), /unregistered.*unregistered.txt/i);
}));
test('rejects traversal, absolute paths and overlapping scopes before running a generator', () => fixture((root, config) => {
 for (const outputs of [['../outside'], ['/tmp/outside'], ['generated', 'generated/page.md'], ['.git'], ['generated/../source.txt']]) {
  const value = config(); value.jobs[0].outputs = outputs;
  assert.throws(() => checkGenerated(root, value), /(?:path|scope|overlap|reserved)/i);
 }
}));
test('rejects symlinks in generated and existing output trees', () => fixture((root, config) => {
 assert.throws(() => checkGenerated(root, config('link')), /symlink/i);
 rmSync(join(root, 'generated/page.md'));
 symlinkSync(join(root, 'source.txt'), join(root, 'generated/page.md'));
 assert.throws(() => checkGenerated(root, config()), /symlink/i);
}));
test('rejects symlinked parent directories for individually declared files', () => fixture((root, config) => {
 mkdirSync(join(root, 'other')); writeFileSync(join(root, 'other/page.md'), 'current');
 symlinkSync(join(root, 'other'), join(root, 'alias'));
 const value = config(); value.jobs[0].outputs = ['alias/page.md'];
 assert.throws(() => checkGenerated(root, value), /symlink/i);
}));
test('requires explicit commands and destinations and at least one named job', () => fixture((root, config) => {
 for (const value of [{ schemaVersion: 1, jobs: [] }, { ...config(), schemaVersion: 2 }]) assert.throws(() => checkGenerated(root, value));
 const value = config(); value.jobs[0].command = [process.execPath, 'generator.mjs'];
 assert.throws(() => checkGenerated(root, value), /outputDir/);
}));
test('cleans this invocation temporary output on success and failure', () => fixture((root, config) => {
 checkGenerated(root, config('record'));
 assert.equal(existsSync(readFileSync(join(root, 'output-directory.txt'), 'utf8')), false);
 assert.throws(() => checkGenerated(root, config('record-fail')), /generator failed/);
 assert.equal(existsSync(readFileSync(join(root, 'output-directory.txt'), 'utf8')), false);
}));

test('CLI exits nonzero for drift and reports paths, without rewriting generated files', () => fixture((root, config) => {
 writeFileSync(join(root, 'generated-policy.json'), JSON.stringify(config()));
 const cli = fileURLToPath(new URL('./check-generated.mjs', import.meta.url));
 let result = spawnSync(process.execPath, [cli], { cwd: root, encoding: 'utf8' });
 assert.equal(result.status, 0, result.stderr);
 writeFileSync(join(root, 'generated/page.md'), 'stale');
 result = spawnSync(process.execPath, [cli], { cwd: root, encoding: 'utf8' });
 assert.equal(result.status, 1);
 assert.match(result.stdout + result.stderr, /changed.*generated\/page.md/);
 assert.equal(readFileSync(join(root, 'generated/page.md'), 'utf8'), 'stale');
}));

test('ignores Finder metadata while still detecting obsolete generated documents', () => fixture((root, config) => {
 writeFileSync(join(root, 'generated/.DS_Store'), 'Finder metadata');
 assert.deepEqual(checkGenerated(root, config())[0].differences, []);
 assert.equal(readFileSync(join(root, 'generated/.DS_Store'), 'utf8'), 'Finder metadata');
 writeFileSync(join(root, 'generated/obsolete.md'), 'obsolete');
 assert.deepEqual(checkGenerated(root, config())[0].differences, [{ path: 'generated/obsolete.md', kind: 'extra' }]);
}));
