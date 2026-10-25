---
title: "Contribute to EAOS"
description: "Develop and verify public EAOS without a private checkout."
sidebar:
  order: 40
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "maintenance"]
---

# Contribute to EAOS

## Prerequisites

Use Node.js 24 and Bun 1.4.3, as declared in package.json and CI. All dependencies
come from npmjs; no private registry credentials or sibling checkout is required.
Appkit Core is pinned to 0.2.0 and Appkit React to 0.3.0. Read [AGENTS.md](https://github.com/dataarthub/eaos/blob/main/AGENTS.md) and the
[shared development policy](https://tech-docs.alneas.com/policies/development-policy.md).

## Step-by-Step Implementation

```bash
bun install --frozen-lockfile --ignore-scripts --linker hoisted
bun run secrets:setup
bun run check
```

The check runs public boundaries/Changesets, read-only defect linting, tooling
tests, all five package builds and tests, README/API/JSDoc freshness and a
redacted secret scan. Raw logs and machine-specific evidence stay in ignored
.verification/. Installation does not run dependency lifecycle scripts. The
explicit Gitleaks setup downloads a pinned official archive and verifies SHA-256.

Each package owns its source, tests, exports and documentation. The single
`plugins/package.json` owns the standard plugin collection; its three feature
folders keep their tests and guides without individual package manifests. Internal workspace
resolution is permitted inside this monorepo; cross-repository source aliases and
private dependencies are forbidden. Core owns portable contracts, Server owns
trusted implementations, and React owns browser UI. CLI remains development tooling.

For focused iteration, use the owning package's build/test script. For API or
peer changes, also test the actual package archives:

```bash
bunx playwright install chromium
bun run release:plan
bun run release:prepare
bun run test:consumer -- <printed-bundle-directory>
bun run release:verify -- <printed-bundle-directory>
```

Consumers install the exact archives outside this checkout, verify their hashes,
load representative server/browser entries, type-check supported imports and
the shipped/root README examples, then exercise a real Chromium workspace header/help dialog. The browser matrix runs
sequentially at 1280×800 and 390×844 in light/dark with default, blue, green,
rose, orange and future (the palettes shipped by Appkit React 0.3.0; future has a
dark-only stylesheet and falls back to default in light mode). It asserts active
styles, axe WCAG failures (including opened overlays), alpha-composited contrast
for scroll-clipped text that axe flags for review, modal focus containment,
24px control targets, clipping/overflow and opened overlay containment. Host-provided
custom palettes require host validation. Registry availability and production
integration are separate checks.

### Document and record changes

Follow the [documentation policy](https://tech-docs.alneas.com/policies/documentation-policy.md)
and [authoring skill](https://tech-docs.alneas.com/skills/document-authoring/SKILL.md).
Edit README/source JSDoc and guides; generate wrappers/API cards explicitly:

```bash
bun run docs:readmes:prepare
bun run docs:api
bun run docs:check
bun run changeset
```

The freshness check regenerates into temporary directories and never repairs
normal output. The manifest lists approved public ingestion candidates; verify
published-version eligibility before portal delivery (see [RELEASING.md](RELEASING.md)).
Private guides and operator evidence are excluded. Japanese portal translations belong to github-docs;
project-owned runtime help remains here.

The standard plugin collection was published as `@alneas/eaos-plugins@0.1.0`.
Use that release as the baseline for accumulated changes; prepare later versions
independently and preserve feature lifecycle identities.

Add a reviewed .changeset fragment naming affected packages, version increments,
consumer impact and upgrade steps. Use minor increments for pre-1.0 breaking
adoption changes. Maintainer-only edits can instead state their no-release rationale
in the PR. Preserve existing fragments until deliberate version preparation.

### Verification resource limits and records

`bun run check` uses a 6144 MiB aggregate process-tree RSS budget and a 20-minute
deadline; `test:consumer` uses 3072 MiB and 10 minutes. Concurrency is one within
each invocation, with sequential browser cases and fresh pages. The guard includes
Node and browser descendants, fails closed when process inspection fails, and
cleans owned groups on success, failure, interruption and deadline expiry.
`quality-latest.json` and `consumer-latest.json` record status, configured limits
and observed peak under ignored .verification/. A terminated run is a failure;
its unexecuted cases remain unverified. Reduce concurrency/batch size on a limit
failure; do not increase budgets, omit matrix cases or disable accessibility rules.
A shared invocation lock prevents competing quality/consumer runs. If a hard-killed
invocation leaves a lock, inspect .verification/verification.lock/owner.json and
confirm that process has stopped before removing the stale lock. Resource-guard
regressions cover descendant RSS, deadline, missing inspection,
exit status, early exits and forced cleanup.

The PR gate runs `check:release-impact` against its base SHA. For local committed
work use `bun run check:release-impact -- <full-base-sha>`. New fragments must cover
affected owners and runtime dependents; unknown/shared inputs conservatively affect
all targets. Alternatively provide the PR template's concrete **No-release rationale**
for human review. Presence checks do not approve semantic impact. Without a baseline
or PR body, local checks explicitly report that coverage is not established.

CI scans both the source snapshot and Git history with pinned Gitleaks. Before an
authorized push, run `bun run secrets:check -- --history` on a checkout with real
history. No hooks are installed automatically; any opted-in pre-commit hook should
scan staged secrets and lint staged inputs, while pre-push must verify relevant
history and the required local gate. Branch protection is separate configuration.

## Verification

`bun run check` verifies source and documentation. The archive consumer check
verifies the delivered candidate bytes and browser interactions separately.
On Linux, install Chromium system dependencies with
`bunx playwright install --with-deps chromium` when needed.

## Troubleshooting

- A failed check names its ignored log. Correct the owning source and rerun it;
  do not edit generated output or relax assertions to pass.
- Large declaration graphs may need `NODE_OPTIONS=--max-old-space-size=8192`.
  The aggregate check supplies that default. Individual builds may need it too.
- Frozen installation failure means package.json and bun.lock differ. Regenerate
  the lock explicitly and review it; never add private-source overrides.
- No hooks are installed by these commands. PR CI runs the maintained local gate;
  repository branch protection still requires separate GitHub configuration.

See [RELEASING.md](RELEASING.md) before versioning or publishing. A local check
never authorizes a commit, push, tag, registry write or deployment.

## Generated workflow maintenance

See [workflow supply and local quality](docs/workflow-supply.md) for `quality:commit`, `quality:push`, generated workflow checks and the actual selection/reuse limits.
