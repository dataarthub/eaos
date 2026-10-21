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
   Changesets plus runtime dependency impact. A retained initial commit provides
   a review baseline, not a published release. The unpublished collection stays
   at `@alneas/eaos-plugins@0.1.0`; do not invent a later version or treat the three
   former unpublished plugin package names as release targets.
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

There is deliberately no package-publishing trigger in this repository yet.
The candidate workflow only prepares and checks artifacts. Before enabling a
publishing workflow, separately confirm repository access, package ownership,
registry availability of runtime prerequisites and each package's actual first-
publication status. A 404 alone is not proof that a package is genuinely new.

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
The current EAOS repository does not implement that later staging workflow yet;
preparation of the first release does not claim it is operational.

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

For these `0.1.0` packages, both `beta` and `latest` must point to the verified
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
