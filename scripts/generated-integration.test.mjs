import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { checkGenerated } from './check-generated.mjs';
const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'generated-policy.json'), 'utf8'));
function snapshot() {
 const files = new Map();
 function scan(file) {
  if (!existsSync(file)) return;
  const stat = lstatSync(file);
  if (stat.isDirectory()) for (const name of readdirSync(file).sort()) scan(join(file,name));
  else if (stat.isFile()) files.set(file,createHash('sha256').update(readFileSync(file)).digest('hex'));
  else assert.fail('Expected regular output: '+file);
 }
 for (const job of config.jobs) for (const output of job.outputs) scan(join(root,output));
 return files;
}
test('actual project generators honor temporary destinations without repairing normal outputs', () => {
 const before = snapshot();
 const reports = checkGenerated(root, config);
 assert.equal(reports.length, config.jobs.length);
 assert.deepEqual(snapshot(), before, 'Freshness validation must not rewrite normal outputs');
});
test('portal landings omit GitHub language selectors while keeping their canonical README pairs', () => {
 const landings = JSON.parse(readFileSync(join(root, 'readme-landings.json'), 'utf8'));
 for (const { source, output } of landings) {
  const canonical = readFileSync(join(root, source), 'utf8');
  const translated = readFileSync(join(root, source.replace('README.md', 'README.ja.md')), 'utf8');
  const landing = readFileSync(join(root, output), 'utf8');
  assert.match(canonical.split('\n')[2], /^\[English\]\(.+\) \| \[日本語\]\(.+\)$/);
  assert.match(translated.split('\n')[2], /^\[English\]\(.+\) \| \[日本語\]\(.+\)$/);
  assert(!landing.includes('[日本語]('), output + ': portal owns language navigation');
  assert(!landing.includes('README.ja.md'), output + ': Japanese README is not a portal translation source');
  assert(landing.includes('## Quickstart'), output + ': preserve the source introduction');
 }
});
