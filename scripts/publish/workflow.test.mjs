import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const text=name=>readFileSync(new URL('../../.github/workflows/'+name,import.meta.url),'utf8')
test('canonical writer separates unprivileged verification, staged writer and original-run completion',()=>{
 const s=text('publish.yml'),verify=s.split('  verify:')[1].split('  stage:')[0],stage=s.split('  stage:')[1].split('  resolve:')[0],complete=s.split('  complete:')[1]
 assert.match(s,/release:\n\s+types: \[published\]/);assert.doesNotMatch(s,/\n  (push|pull_request):/)
 assert.match(s,/group: eaos-npm-release\n\s+cancel-in-progress: false/)
 assert.doesNotMatch(verify,/id-token: write|NPM_TOKEN|NODE_AUTH_TOKEN/)
 for(const gate of ['bun run check','bun run secrets:check -- --history','prepare --final','bun run test:consumer','bun run release:verify','scripts/publish/bundle.mjs'])assert(verify.includes(gate),gate)
 assert.match(verify,/include-hidden-files: true/);assert.match(verify,/retention-days: 14/)
 const paths=verify.split('path: |')[1].split('if-no-files-found:')[0].trim().split('\n').map(s=>s.trim())
 assert.deepEqual(paths,['.verification/handoff/release.json','.verification/handoff/*.tgz','.verification/handoff/*.notes.md'])
 assert.match(stage,/needs: verify/);assert.match(stage,/digest-mismatch: error/);assert.match(stage,/id-token: write/)
 assert.match(complete,/run-id: \$\{\{ needs.resolve.outputs.run \}\}/);assert.match(complete,/digest-mismatch: error/)
 assert.doesNotMatch(stage+complete,/bun run|npm publish|npm stage publish/)
 assert.match(s,/npm@11.21.0/)
})
test('observer has no OIDC or npm credentials, uses default branch and excludes completion loops',()=>{
 const s=text('complete-approved.yml')
 assert.match(s,/workflow_run:/);assert.match(s,/workflow_run.event == 'release'/);assert.match(s,/ref: main/)
 assert.match(s,/actions: write/);assert.match(s,/timeout-minutes: 35/)
 assert.doesNotMatch(s,/id-token: write|NODE_AUTH_TOKEN|NPM_TOKEN|npm install|npm publish|bun run/)
 assert.match(s,/group: npm-approval-/);assert.doesNotMatch(s,/group: eaos-npm-release/)
})
