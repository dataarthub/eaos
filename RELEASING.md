---
title: "Prepare and release EAOS packages"
description: "Prepare exact public archives, verify isolated consumers and distinguish local candidates from authorized publication."
sidebar:
  order: 40
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "maintenance"]
---

# Prepare and release EAOS packages

## Prerequisites

Follow the [shared release policy](https://tech-docs.alneas.com/policies/release-policy.md)
and [preparing-releases skill](https://tech-docs.alneas.com/skills/preparing-releases/SKILL.md).
The public source repository is https://github.com/dataarthub/eaos; all five
packages target public npmjs. Local preparation never writes to a registry.
Use the toolchain and checks in [CONTRIBUTING.md](CONTRIBUTING.md).

## Step-by-Step Implementation

1. Select an explicit last-release baseline per package and inspect accumulated
   Changesets plus runtime dependency impact. The aggregate `v0.1.0` release is the published baseline.
   Review later changes independently for each owner; the three former plugin
   package names are not release targets.
2. Run `bun run release:plan` to inspect versions, dependency order and required
   distribution tags. This plan lists the five-package candidate set; it does
   not infer semantic impact from paths or certify registry prerequisites. The
   targets are Core, Server, React, CLI and `@alneas/eaos-plugins`; feature
   selectors such as `@alneas/eaos-plugins/approval` are not npm packages.
3. Review .changeset fragments and run `bun run version:packages` only when ready
   to consume them. Inspect version/dependency changes, lockfile changes and
   cumulative CHANGELOG entries together. Preserve prior history; never fabricate
   historical publication or dates. Regenerate docs after README/API input changes.
   Run `bun run release:notes` to check meaningful current version entries. A
   development candidate may retain pending Changesets; final preparation rejects
   selected pending root fragments, duplicate version entries and placeholders.
4. Install with the reviewed frozen lock, run `bun run check`, then
   `bun run release:prepare`. The printed directory contains exact archives and
   bundle.json with SHA-256/SHA-512, source identity, toolchain and checks.
   Each package also has a source-derived `*.notes.md`; its hash is recorded in
   the bundle. Verification compares it with both canonical and packed CHANGELOG.
5. Run `bun run test:consumer -- <bundle-directory>`, followed by
   `bun run release:verify -- <bundle-directory>`. Retain those exact bytes.
   Changed source or a modified archive invalidates the candidate.
6. After a separately authorized source commit exists, rerun the required checks
   for that commit and use `bun run release:prepare -- --final`. Final mode requires
   a clean commit and version-matching changelog entries. Test and verify that
   final bundle; do not relabel earlier working-tree evidence as commit-bound.
   The final bundle includes `MANUAL-FIRST-PUBLICATION.md`, with exact archive
   names, integrity values and ordered manual commands. Instructions use a bundle
   variable so moving the retained bundle does not change its verification.

Package scripts do not build on publish. Publishing must use the verified .tgz,
not `npm publish` from a source directory. Archive checks enforce declared exports,
README/LICENSE/CHANGELOG, explicit files and private-source exclusion. Consumer
checks never use sibling source aliases, private tarballs or a checkout fallback.
Working-tree bundles are development evidence, not publishable releases.

### Publication and external setup

The candidate quality workflow prepares artifacts without publishing. Subsequent
package releases use `.github/workflows/publish.yml` with staged Trusted
Publishing and human npm approval. Before enabling account-side trust, confirm
repository access, package ownership and registry prerequisites. A 404 alone is
not proof that a package is genuinely new.

For genuinely new packages, the shared policy permits an explicitly authorized
interactive maintainer publication of the real initial version using the exact
reviewed commit-bound archive, `npm publish <archive.tgz> --ignore-scripts`, and
human 2FA. Never stage the first publication or create a placeholder version to
establish ownership. Confirm package identity and ownership beyond a registry 404.
Configure and verify each package's npm Trusted Publisher for the exact GitHub
repository/workflow/environment before later releases. Existing packages must use
GitHub Actions/OIDC; failed OIDC setup never authorizes a manual fallback or a
long-lived npm write token. Subsequent releases require staged publishing.

### Manual initial registration

This is the same bootstrap distinction used by Appkit and Sitekit: the initial
registration is manual because the package does not yet have npm settings in
which to connect a Trusted Publisher. Missing OIDC configuration does not block
this authorized first registration. It must be configured before later releases.
The subsequent staging and completion workflow is implemented in `publish.yml`.
Account-side npm Trusted Publisher setup is a separate prerequisite; source
configuration alone does not make it operational.

After the final bundle's consumer and identity checks pass, run the read-only
registry preflight. Set the variable to your retained bundle's actual location:

```bash
EAOS_RELEASE_BUNDLE='/absolute/path/to/retained-bundle'
bun run release:verify -- "$EAOS_RELEASE_BUNDLE"
bun run release:preflight -- "$EAOS_RELEASE_BUNDLE"
npm whoami --registry=https://registry.npmjs.org
```

The bootstrap report checks all five targets and external prerequisites. It
records missing candidate-internal prerequisites as pending until their earlier
publication. A 404 requires maintainer confirmation of ownership and genuine new
package status; it never authorizes publication. Matching registered bytes mean
the version is already published and must be skipped. Conflicting integrity,
uncertain access, unavailable prerequisites or newer required channels stop work.

After separate authorization, make the exact source commit publicly readable on
GitHub. Follow the bundle's inspected dependency order. Immediately before each
dependent publication, run its strict target preflight; unlike bootstrap mode it
requires every prerequisite to be readable:

```bash
bun run release:preflight -- "$EAOS_RELEASE_BUNDLE" --target @alneas/eaos-core
```

Use the exact archive filename and version from that bundle's manual handoff.
Only after confirming genuine first-registration status, publish it once with
the maintainer's interactive 2FA session:

```bash
npm publish "$EAOS_RELEASE_BUNDLE/<verified-archive.tgz>" --ignore-scripts --access public --tag beta --registry=https://registry.npmjs.org
npm view <package>@<version> version dist.integrity --json --registry=https://registry.npmjs.org
```

Compare the returned integrity with bundle.json before advancing to a dependent.
Read current channels, add only missing required tags without moving a newer
version backwards, then read both mappings back:

```bash
npm view <package> dist-tags --json --registry=https://registry.npmjs.org
npm dist-tag add <package>@<version> latest --registry=https://registry.npmjs.org
npm view <package> dist-tags --json --registry=https://registry.npmjs.org
```

For packages below `1.0.0`, both `beta` and `latest` must point to the verified
version. Do not rebuild or repack between targets. Retain the exact archives,
notes, handoff and bundle manifest; raw local receipts remain private. Afterwards
verify every public integrity and perform a registry-only consumer installation
without local file overrides. GitHub Releases use the same package notes and
remain separately authorized actions.

For later releases, separate unprivileged verification from a minimal GitHub
Actions/OIDC writer. Configure the exact Trusted Publisher and environment for
staging and dist-tag permissions, with direct publishing disabled. Stage only the
verified archive bytes under an inspection-only tag, inspect the npm stage, and
require human 2FA approval. A completion step must verify public version/integrity
and channel ordering before beta/latest writes. Staging, approval and public
availability are distinct states; a successful staging job is not a release.
Do not introduce npm write tokens or bypass staging to recover failed OIDC setup.

Publish prerequisites before their dependents, preserving the inspected order.
For independently released prerequisites, verify the exact required public
version and content before adopting it; do not republish an unchanged predecessor.
For versions below 1.0.0, both beta and latest must resolve to the exact released
version; from 1.0.0 onward require latest without automatically changing beta.
Check current channels before writes and never move a newer channel backwards.

### Subsequent package releases through Actions

1. Prepare and commit the selected package version, dependency updates and notes.
   Publish prerequisites before dependents whose declared ranges require them.
2. Configure that existing npm package's Trusted Publisher for GitHub organization
   `dataarthub`, repository `eaos`, workflow filename `publish.yml`, with no
   environment constraint. Allow staging and **Allow npm dist-tag**; leave
   **Allow npm publish** disabled. The observer needs no npm identity. This account
   setup remains pending until a maintainer performs and verifies it.
3. Create the package-specific tag at the reviewed commit on `main`, then publish
   its stable GitHub Release. The accepted tags are `eaos-core-vX.Y.Z`,
   `eaos-server-vX.Y.Z`, `eaos-react-vX.Y.Z`, `eaos-cli-vX.Y.Z` and
   `eaos-plugins-vX.Y.Z`. The initial aggregate `v0.1.0` is historical and never
   triggers package staging. Main/tag pushes do not stage; manual dispatch only
   completes an existing successful staging run.
4. `publish.yml` runs the mandatory quality and exact-archive consumer gates on
   Node 24 / Bun 1.4.3, then transfers only the selected archive, source-derived
   notes and sanitized `release.json` as an immutable artifact retained 14 days.
   Its credentialed writer uses pinned npm 11.21.0 to stage those exact bytes on
   the inspection-only `staged` tag. It never rebuilds. Existing published
   versions require byte equality and are never republished.
5. Review the npm Staged Packages entry and approve with human 2FA.
   `complete-approved.yml` observes matching public bytes for up to 30 minutes
   and dispatches `publish.yml` completion once. Completion revalidates the
   original successful staging run, attempt, tag, commit and artifact; verifies
   public bytes and prerequisite ranges; sets required consumer tags without
   rolling newer channels back; then records npm Deployment success against the
   original source SHA. Observer success alone is not completed publication.
6. If approval finishes after the observation window, resume completion on `main`:

   ```bash
   gh workflow run publish.yml --ref main -f staged_run=ORIGINAL_SUCCESSFUL_STAGE_RUN_ID
   ```

   Recover only the original successful run and unexpired immutable artifact.
   Changed attempts, moved tags, expired evidence, conflicting bytes or newer
   channels block writes. On an ambiguous upload/dispatch, inspect Actions and npm
   before retrying; never re-stage or rebuild as a completion shortcut. Release
   staging and observer reruns are rejected, including Re-run all jobs. Inspect
   failures against their original attempt before using completion-only recovery. The
   observer's concurrency is separate from the serialized staging/completion
   lock, so waiting for approval does not block other package releases.

### Dependency order for the prepared 0.2.0 set

The prepared targets remain the same five 0.2.0 versions. Stage Core first. After
human approval, verify its public bytes and required tags before staging React
and Server. After those prerequisites are public and verified, stage CLI and the
plugin collection. Each package has its own Release, original run and human npm
approval; staging alone does not satisfy an npm dependency range. Do not weaken
registry prerequisite checks to submit dependents early.

The approval observer can request the existing completion path while this task
continues. If its 30-minute window expires, use completion-only recovery with the
original successful staging run. Never create a new stage to recover missing
consumer tags or records.

After registry bytes, beta/latest and the original-SHA Deployment are verified,
attach a sanitized completion receipt to the same package Release. Include only
the package/version, original source/run, verified integrity and consumer tags.
Recheck the Release ID and tag/source before upload; compare existing asset bytes
and preserve matching assets and reviewed notes. Keep raw logs, local paths and
restricted coordination evidence out of public Release assets.

### Evidence and documentation delivery

The maintained local gate always runs fresh; it does not reuse task-cache or remote
CI success. `quality-latest.json` must identify the same successful guarded run as
`quality.json`. A running, interrupted or failed later attempt blocks older
success, even when source bytes match. Archive consumers are sealed only after
the process guard succeeds. Keep these receipts and raw logs private.

Any future exact-commit CI reuse must validate repository, workflow, event/branch,
required outcomes, toolchain/platform and complete selected inputs, and reject a
newer failed attempt. Missing or untrusted evidence requires fresh checks; an npm
download cache is not verification evidence.

The approved documentation manifest is an eligibility list, not proof that its
API is published. Before production portal ingestion, bind consumer guidance to
actually published package versions/revisions, separately for independent targets.
Defer unreleased contracts or keep them in explicitly marked development material.
Reviewed typo/link corrections for already released behavior can ship separately.
Never mix unreleased generated API changes into that docs-only delivery. Translation,
ingestion and portal deployment remain separate from package publication.

## Verification

After authorized publication, compare npm's dist.integrity with bundle.json,
install the exact registry versions without overrides, and verify README/history
links, required tags and any provenance. The local bundle verifier does not make
registry requests or certify publication. Generate GitHub Release notes from the
same package/version changelog entry; keep write-triggering Releases as drafts
until authorized. A version heading alone does not mean publication succeeded.

On ambiguity or partial failure, stop writes and inspect each package/version,
integrity and channel read-only. Resume only confirmed missing work from the same
bundle; never republish an existing version or rebuild replacement bytes under
its identity. Tag-only failures require tag repair after integrity/order checks.
Expired or missing evidence requires review. Keep deployment records separate
from package publication and preserve successful records during recovery.

## Troubleshooting

- Stale quality/source or changed bytes: rerun the affected checks and prepare a
  new candidate. Do not edit receipts or hand off raw .verification logs publicly.
- Missing version notes: review Changesets preparation; Unreleased is not a
  versioned release entry. Do not silently bump versions in the publisher.
- Missing remote trust, Git baseline or registry prerequisites: local preparation
  can finish, but publication remains blocked until those external gates are met.
