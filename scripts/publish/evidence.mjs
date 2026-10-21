// Trusted completion resolves original run/attempt/artifact identity; downloaded data is never executed.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseTarget } from './context.mjs';
export const repository = 'dataarthub/eaos';
const workflow = '.github/workflows/publish.yml';
export async function githubRequest(path, options = {}) {
  assert(process.env.GITHUB_TOKEN, 'GitHub evidence token unavailable');
  const {timeoutMs=30000,...requestOptions}=options;
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...requestOptions, headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(Math.max(1,Math.floor(Math.min(timeoutMs,30000)))),
  });
  assert(response.ok, 'GitHub evidence request failed');
  return response.status === 204 ? null : response.json();
}
export async function resolveStagingRun(value, { request = githubRequest, now = Date.now() } = {}) {
  assert(/^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)), 'Invalid staging run ID');
  const runId = Number(value);
  const run = await request(`/actions/runs/${runId}`);
  const owner = await request('/actions/workflows/publish.yml');
  assert.equal(run.id, runId); assert.equal(run.workflow_id, owner.id);
  assert.equal(run.path, workflow); assert.equal(run.event, 'release');
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success', 'Original staging attempt must succeed');
  assert.equal(run.head_repository?.full_name, repository);
  const target=releaseTarget(run.head_branch);
  const release=await request('/releases/tags/'+encodeURIComponent(target.tag));
  assert(release.tag_name===target.tag&&release.draft===false&&release.prerelease===false,'Original Release unavailable or no longer published');
  assert(Number.isSafeInteger(release.id)&&release.id>0,'Invalid original Release identity');
  let ref=await request('/git/ref/tags/'+encodeURIComponent(target.tag));
  for(let depth=0;ref.object?.type==='tag'&&depth<5;depth++)ref=await request('/git/tags/'+ref.object.sha);
  assert(ref.object?.type==='commit'&&ref.object.sha===run.head_sha,'Original release tag moved');
  const comparison=await request('/compare/'+run.head_sha+'...main');
  assert(['identical','ahead'].includes(comparison.status),'Original release source is outside main');
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
  assert(Number.isFinite(Date.parse(run.created_at)), 'Missing original run creation time');
  assert.equal(run.run_attempt, 1, 'A rerun cannot replace the original staging attempt');
  const jobs = await request(`/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
  assert(jobs.total_count <= 100, 'Ambiguous job evidence');
  for (const name of ['verify', 'stage']) {
    const selected = jobs.jobs.filter(job => job.name === name);
    assert.equal(selected.length, 1, 'Missing or duplicate required job');
    assert.equal(selected[0].status, 'completed'); assert.equal(selected[0].conclusion, 'success', 'Required staging job did not succeed');
  }
  const listed = await request(`/actions/runs/${runId}/artifacts?per_page=100`);
  assert(listed.total_count <= 100, 'Ambiguous artifact evidence');
  const artifacts = listed.artifacts.filter(artifact => artifact.name === `verified-npm-release-${runId}-${run.run_attempt}`);
  assert.equal(artifacts.length, 1, 'Missing or ambiguous original artifact');
  const artifact = artifacts[0];
  assert.equal(artifact.expired, false); assert(Date.parse(artifact.expires_at) > now, 'Original evidence expired');
  assert(Number.isSafeInteger(artifact.id) && artifact.id > 0);
  assert.equal(artifact.workflow_run?.id, runId); assert.equal(artifact.workflow_run?.head_sha, run.head_sha);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
  return { release:{id:release.id,tag:target.tag}, repository, runId, createdAt:run.created_at, attempt: run.run_attempt, commit: run.head_sha, artifactId: artifact.id, artifactDigest: artifact.digest, expiresAt: artifact.expires_at };
}
export function assertCompletionContext(env) {
  assert.equal(env.GITHUB_ACTIONS, 'true'); assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch'); assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.equal(env.GITHUB_WORKFLOW_REF, `${repository}/${workflow}@refs/heads/main`);
}
async function main() {
  assertCompletionContext(process.env);
  const evidence = await resolveStagingRun(process.env.STAGED_RUN);
  await writeFile('.verification/resolved-release.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  const { appendFile } = await import('node:fs/promises');
  assert(process.env.GITHUB_OUTPUT);
  await appendFile(process.env.GITHUB_OUTPUT, `run=${evidence.runId}\nartifact=${evidence.artifactId}\ncommit=${evidence.commit}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Original staging evidence unavailable or invalid; no completion writes permitted.'); process.exitCode = 1; });
