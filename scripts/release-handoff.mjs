import assert from 'node:assert/strict'
import {requiredTags} from './release-contract.mjs'
const quote=value=>"'"+String(value).replaceAll("'","'\"'\"'")+"'"
export function manualFirstPublication(bundle) {
  assert.equal(bundle.state,'commit-bound','Only a clean commit-bound candidate can have publication instructions')
  assert.match(bundle.commit??'',/^[a-f0-9]{40}$/)
  assert.match(bundle.sourceHash??'',/^[a-f0-9]{64}$/)
  assert.ok(bundle.archives?.length)
  let text=`# Manual first publication\n\nSource commit: ${bundle.commit}\nSource SHA-256: ${bundle.sourceHash}\n\nThese commands are a reviewed handoff, not publication authorization. Do not execute them until GitHub publication and npm publication have been separately authorized. First registration uses the maintainer's interactive npm session and human 2FA. Configure Trusted Publishing after first registration and before later releases; it is not a first-registration prerequisite. Never use placeholders or staging to create the initial package.\n\n## Before any write\n\nSet \`EAOS_RELEASE_BUNDLE\` to the retained bundle location; this variable is intentionally independent of its original preparation directory. Make the exact source commit publicly readable on GitHub after authorization. Confirm the repository points to the commit above, and run the maintained bundle verifier from that checkout. Confirm npm account/scope ownership and genuine first-registration eligibility for every target in the maintainer account; a registry 404 is insufficient. Check all targets before starting and preserve this exact bundle.\n\n\`\`\`bash\nEAOS_RELEASE_BUNDLE='/absolute/path/to/retained-bundle'\nnode scripts/release.mjs verify "$EAOS_RELEASE_BUNDLE"\nnode scripts/release.mjs preflight "$EAOS_RELEASE_BUNDLE"\nnpm whoami --registry=https://registry.npmjs.org\n\`\`\`\n\nA read-only preflight can report pending internal prerequisites during bootstrap. Before each dependent write, its per-target preflight must find readable prerequisites. An already-published matching version must be skipped; conflicts or uncertain registry state require inspection, never a blind retry.\n`
  for(const item of bundle.archives) {
    assert.match(item.name,/^@alneas\/eaos-[a-z0-9-]+$/)
    assert.match(item.archive,/^[A-Za-z0-9._-]+\.tgz$/)
    assert.match(item.sha256??'',/^[a-f0-9]{64}$/)
    assert.match(item.integrity??'',/^sha512-[A-Za-z0-9+/]+={0,2}$/)
    assert.match(item.notes?.file??'',/^[A-Za-z0-9._-]+\.notes\.md$/)
    assert.match(item.notes?.sha256??'',/^[a-f0-9]{64}$/)
    assert.deepEqual(item.requiredTags,requiredTags(item.version))
    const tag=item.requiredTags[0],target=`${item.name}@${item.version}`
    text+=`\n## ${target}\n\nArchive SHA-256: ${item.sha256}\nExpected registry integrity: ${item.integrity}\nNotes: ${item.notes?.file} (SHA-256 ${item.notes?.sha256}).\n\nAfter manually confirming this is a genuinely new package, publish this exact archive once.\n\n\`\`\`bash\nnode scripts/release.mjs preflight "$EAOS_RELEASE_BUNDLE" --target ${quote(item.name)}\nnpm publish "$EAOS_RELEASE_BUNDLE"/${quote(item.archive)} --ignore-scripts --access public --tag ${tag} --registry=https://registry.npmjs.org\nnpm view ${quote(target)} version dist.integrity --json --registry=https://registry.npmjs.org\n\`\`\`\n\nStop until the returned integrity equals the value above. Read current channels and refuse to move a newer version backwards. Complete only missing required tags:\n\n\`\`\`bash\nnpm view ${quote(item.name)} dist-tags --json --registry=https://registry.npmjs.org\n`
    for(const channel of item.requiredTags)text+=`npm dist-tag add ${quote(target)} ${channel} --registry=https://registry.npmjs.org\n`
    text+=`npm view ${quote(item.name)} dist-tags --json --registry=https://registry.npmjs.org\n\`\`\`\n\nConfirm required tags (${item.requiredTags.join(', ')}) resolve to ${item.version} before advancing to dependent packages.\n`
  }
  return text+'\n## Completion\n\nCompare every public archive with its retained integrity, then perform a fresh registry-only consumer install without file overrides. Use the retained package notes for separately authorized GitHub Releases. Record source/versions/bytes/tags and any remaining failures. Configure and verify the later GitHub Actions/OIDC workflow and npm Trusted Publisher after first registration; do not republish this initial version merely to test that connection. On timeout or partial success stop writes, inspect public bytes/tags and resume only confirmed missing work without rebuilding.\n'
}
