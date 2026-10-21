import assert from 'node:assert/strict';
import { githubRequest } from './evidence.mjs';
export async function recordDeployments(manifest, { request = githubRequest } = {}) {
  for (const name of manifest.targets) {
    const artifact = manifest.artifacts.find(item => item.name === name);
    assert(artifact && ['core','server','react','cli','plugins'].map(k=>'@alneas/eaos-'+k).includes(name));
    const environment = 'npm-'+name.split('-').at(-1);
    const payload = { name, version: artifact.version, integrity: artifact.integrity, sourceSha: manifest.commit };
    const existing = await request(`/deployments?sha=${manifest.commit}&environment=${environment}&per_page=100`);
    assert(Array.isArray(existing) && existing.length < 100, 'Deployment history requires inspection');
    const matches = existing.filter(item => {
      let recorded = item.payload;
      if (typeof recorded === 'string') { try { recorded = JSON.parse(recorded); } catch { return false; } }
      return item.sha === manifest.commit && item.environment === environment && Object.entries(payload).every(([key, value]) => recorded?.[key] === value);
    });
    assert(matches.length < 2, 'Ambiguous deployment history');
    let deployment = matches[0];
    if (deployment) {
      const statuses = await request(`/deployments/${deployment.id}/statuses?per_page=100`);
      assert(Array.isArray(statuses) && statuses.length < 100);
      if (statuses.some(status => status.state === 'success')) continue;
    } else {
      deployment = await request('/deployments', { method: 'POST', body: JSON.stringify({ ref: manifest.commit, auto_merge: false, required_contexts: [], environment, production_environment: true, description: `Verified ${name}@${artifact.version}`, payload }) });
    }
    assert(Number.isSafeInteger(deployment.id) && deployment.id > 0);
    await request(`/deployments/${deployment.id}/statuses`, { method: 'POST', body: JSON.stringify({ state: 'success', auto_inactive: false, environment_url: `https://www.npmjs.com/package/${name}/v/${artifact.version}`, description: 'Registry bytes and required consumer channels verified' }) });
  }
}
