import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDeployments } from './deployments.mjs';
const artifact = { name: '@alneas/eaos-core', version: '0.2.0', integrity: 'sha512-reviewed' };
const manifest = { commit: 'a'.repeat(40), targets: [artifact.name], artifacts: [artifact] };
test('public deployment records are bound to original release SHA and verified bytes', async () => {
  const writes = [];
  await recordDeployments(manifest, { request: async (path, options) => { if (!options) return []; writes.push([path, JSON.parse(options.body)]); return { id: 123 }; } });
  assert.equal(writes[0][1].ref, manifest.commit);
  assert.equal(writes[0][1].payload.integrity, artifact.integrity);
  assert.equal(writes[1][1].state, 'success');
  assert.equal(writes[1][1].auto_inactive, false);
});
test('matching prior success is preserved without creating duplicate records or statuses', async () => {
  let writes = 0;
  const payload = { sourceSha: manifest.commit, integrity: artifact.integrity, version: artifact.version, name: artifact.name };
  await recordDeployments(manifest, { request: async (path, options) => {
    if (options) writes++;
    return path.includes('/statuses') ? [{ state: 'inactive' }, { state: 'success' }] : [{ id: 123, sha: manifest.commit, environment: 'npm-core', payload }];
  } });
  assert.equal(writes, 0);
});
