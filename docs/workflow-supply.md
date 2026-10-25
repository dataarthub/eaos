---
title: "Workflow supply and local quality"
description: "Maintain generated Actions and run project-owned verification with explicit evidence boundaries."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: [development, ci, verification]
---

# Maintain workflow supply and local quality

## Prerequisites

Use the Node runtimes and pinned Bun declared in `.github/workflow-adapter.json`, the committed lockfile and the project's existing secret-scanner setup. No private checkout or private package credentials are needed. The installed supply is a reviewed local bundle, including uncommitted upstream changes; it has not been published by this adoption.

## Step-by-Step Implementation

Run `bun run quality:commit` against staged changes. It scans staged secrets and lints index bytes without changing files or staging. Run `bun run quality:push` before pushing. Existing hooks are preserved; this adoption does not install or enable hooks. Inspect `git config --get core.hooksPath` and the repository's hook files when checking local activation. CI independently enforces the verification contract.

Edit `.github/workflow-adapter.json` or `scripts/workflow-project/roles.json`, then run `bun run workflow:generate` explicitly. Never hand-edit generated workflows or the installed shared bundle. Update the supply only from reviewed source with its recorded base revision and exact local bundle digest. `workflow:check` detects drift without fixing it.

### Shared workflow contract

| Role | Adoption and owner |
| --- | --- |
| Source quality | Required: main push, PR and manual; `ci.yml` calls reusable quality. |
| Shared package quality | Required: callable only, preserving the declared runtime matrix. |
| Publish npm packages | Required: stable published Release stages verified archives; manual dispatch completes an original staging run. |
| Complete approved npm release | Required for subsequent staged releases: observe approval using default-branch code and request completion. |
| Documentation freshness | Verification is owned by source quality; no second full source gate. |
| UI browser tests | Existing relevant project checks remain owned by source quality; no duplicate standalone workflow. |
| Auth integration tests | No independent auth workflow adopted; existing applicable integration checks remain in the project gate. |
| Record npm deployments | Not adopted: no existing standalone retrospective deployment-record command; publication completion owns its existing records. |

Common code owns naming, standard triggers, scoped credentials, main-only successful task-cache writes, evidence and deterministic generation. Project fragments own commands, service/browser prerequisites, target/tag rules, supported runtime coverage, archive contents and size budgets. Steps are labeled `Shared:` or `Project:`. The public extension is additive beside the existing private supply; the private implementation is unchanged.

### Project-specific verification

The shared selector narrows standalone Markdown guide changes and publication-only helper changes; publication helpers run their gate/tooling checks without unrelated package/browser suites. Runtime, packaged README, dependency, export and unknown changes retain the broad existing gate. Fine package/browser selection remains conservative; adoption does not establish that finer optimization.

The mandatory secret-history check still runs. Selection requires a latest successful main run/attempt, successful jobs for every declared Node runtime and an unexpired immutable receipt with compatible execution identity. Failed intervening changes stay in scope. Missing/incompatible evidence, history or API access select full verification. Executed checks, exact-input local reuse and out-of-scope omissions are different outcomes. Local/PR success cannot satisfy a Release's official source-evidence requirement.

Release verification requires Source quality success for the exact selected commit and keeps existing current-archive and registry checks. Release preparation reuses deterministic source suites only after validating the exact official main proof; it retains the real build and current archive/registry checks. Staging and completion retain the existing npm implementation, original run/attempt/artifact binding and manual bootstrap. No build or direct npm publish runs in registry-writing jobs. Human npm approval is separate; pending staging is not release success.

## Verification

Run `bun run conformance:check` for project wiring and `bun run conformance:verify` for the shared regressions plus this project's maintained gate/publication/cache probes. `workflow:check` remains the read-only generated-output checker. Expected: generated output is unchanged and supplier regression tests pass. Project source and release tooling checks remain mandatory where applicable. A changed or deleted generated workflow must make `workflow:check` fail without repair; regenerate only after reviewing the source change.

Local fixture coverage and generated YAML do not prove execution on GitHub. Before an authorized rollout, review required-check names and npm Trusted Publisher/environment bindings for workflow renames. Preserve any pending original staging runs and their recovery contract. This work does not authorize a push, publication or deployment.

## Troubleshooting / Common Pitfalls

If no trusted baseline is available, full verification is expected. If Release source evidence is absent or incompatible, run the exact commit through main Source quality before staging; never substitute a PR run or local log. If generated output drifts, inspect canonical adapter/fragments and explicitly regenerate. If npm approval finishes after the observer deadline, complete with the original staging run; never rebuild or restage to finish approval.

Release impact: no package version bump; this change owns maintainer workflow tooling and verification only.

Conformance has three independent levels: shared implementation regressions, installed project wiring, and local behavioral probes. GitHub event execution remains unverified until an authorized remote run. Mandatory outcomes are catalogued centrally in the supplied `requirements.json`; hook-manager choice is a recommendation. The central supply owns adoption status and exception review; local guides describe only this project's implementation.

Conformance probes are selected from changed governance inputs, not run in full for every change. Use `bun run conformance:verify --base <reviewed-ref>` for an explicit committed range. The report distinguishes executed probes, exact-input reused probes and out-of-scope probes. Existing Turbo tasks keep their own actual success cache; this adoption adds no new task orchestrator.

## Package selection

Normal source verification reads a fingerprint-bound plan from the shared selector. Package source and test changes select the owning workspace and all reverse-transitive consumers, including runtime, peer, optional, development and literal cross-workspace source dependencies. Manifest, export, dependency, lockfile, build configuration and unknown shared changes retain full coverage. A changed workspace inventory fails closed until its adapter is updated. Missing or incompatible successful evidence also selects full coverage.

The plan records selected and omitted package tests separately from cache hits. It is checked against the current source fingerprint, commit and actual execution environment before execution. Local snapshots never establish official main or Release success.

EAOS keeps the existing guarded memory/deadline and latest-invocation rules. The selected source gate narrows package test commands; explicit `bun run check` remains full. Boundary, release-impact, lint, tooling and documentation gates remain in place. Builds and exact-archive consumer checks still cover the coupled five-package consumer contract, including its browser/a11y matrix; package selection does not claim those coupled checks were narrowed.

## Development policy inventory

The pinned `development-requirements.json` maps every clause of the reviewed shared development policy. It is descriptive evidence mapping, not a project policy profile or permission to omit a mandatory gate. `conformance:check` inspects active dependency groups, literal imports, TypeScript aliases, ignored evidence paths and declared documentation/artifact inputs. Computed module resolution and untested UI, database, authorization and human-review contracts remain explicitly unverified.

Run `bun run conformance:audit` for the complete clause inventory, existing test candidates, current source/environment identity and read-only hook status. Add `--probe-commit` to exercise the actual commit command in disposable repositories: clean and invalid index contents, a synthetic secret, missing scanner configuration and missing scanner binary. The probe preserves working files and index bytes and does not activate hooks. Existing secret/history scans remain fresh outside deterministic task caches.

The shared commit gate scans staged bytes and lints an isolated index snapshot. Hook files call the maintained commands; having hook files does not establish local activation. Inspect the audit result before claiming hooks run automatically. The source workflow performs dependency-free supply preflight, then critical inspection through its maintained selector after dependency restoration. Required failures stop the gate; inventory entries without behavioral proof are never reported as a full policy pass.

Conformance verification selects bounded tooling/commit probes for relevant verifier, hook or configuration changes. Ordinary prose and unrelated package changes do not select browser or database suites. Actual archive inspection is available with `node scripts/workflow-supply/public/policy-critical.mjs --archive <archive.tgz>`; it checks member paths/types and identity, and does not replace the existing isolated consumers, license/notices, scanner or fresh registry checks.

### Bounded GitHub policy diagnostics

Manually dispatch `ci.yml` on the reviewed branch with `verification_mode=conformance` to exercise shared/owning selector regressions and the actual commit gate on Node 24 and 26. An identical second deterministic task must reuse success; ordinary prose selects no extra probes. Use `verification_mode=negative` separately to run a clean control and then stage a synthetic secret in disposable repositories. The required step must fail with `indexed-secret-blocked`, and the downstream success sentinel must be skipped. Diagnostic concurrency is isolated from normal source verification.

The default `full` mode and normal PR/main gates retain existing checks. Diagnostics do not run product/browser/DB suites, save remote task caches or issue authoritative source evidence. Their artifacts record scoped results, not full policy compliance. Before merging, satisfy the normal required PR checks independently.

### Runtime contract review (2026-10-22)

This review uses the current shared development policy and coding/logic skills;
the supplied clause catalog remains bound to its earlier reviewed revision. Its
structural result is not evidence that the current policy is fully implemented.
No package release is selected: these changes add maintainer test execution
checks and regression fixtures; exported runtime behavior and schemas are unchanged.

The owning package test commands now require a fresh JUnit report, positive
executed tests for every selected file, and zero failed/skipped cases. The source,
push and CI gates retain their existing selector, guard and triggers. Empty files,
skip/todo-only suites, import failures and mixed empty/passing selections fail.
`test:tooling` checks this failure behavior; `package-selection.test.mjs` verifies
that the Outbox contract tests remain selected. Reports stay under ignored
`.verification/test-reports`; they do not certify an official GitHub run.

- Vulnerability response: secret/history scans and dependency boundary checks exist.
  Recurring advisory triage, severity deadlines, fallback/security owners and
  supported security-fix windows are not established by these checks.
- Recovery/migration: Lifecycle owns reviewed plans, writer locks and dirty-state
  reconciliation. No isolated production-engine restore, RTO/RPO or backup-retention
  evidence was produced; hosts own those operational contracts.
- Compatibility/support: manifests, package builds and isolated archive consumers
  own supported runtime/export combinations. Provider/database lanes, persisted
  compatibility and security-support/removal windows need explicit owner review;
  passing source tests alone do not certify them.
- Decisions/review: package boundaries and release records are checked. Required
  domain/security/data/API reviewers and deployed branch-protection enforcement
  remain human/repository configuration; assistant review cannot establish them.
- Execution authority: principal/resource, MCP and Lifecycle tests exercise trusted
  admission. Outbox suspension tests deny an effect after claim; failed work does
  not resume merely because activation returns. High-impact approval policy and
  drain/reconciliation of in-flight effects remain host responsibilities.
- Tenant surfaces: atomic Outbox rejects foreign envelopes before effects and CAS
  tokens reject stale settlers after restart. Existing storage/cache tests cover
  their owning adapters; index/export/signed-link expiry, offboarding and restore
  guarantees require host evidence and cannot be inferred from row isolation.
- Durable work: Outbox tests model remote success followed by lost publication
  acknowledgement, bounded retry exhaustion, restart/stale claims and explicit
  recovery. Stable delivery identity enables host deduplication; delivery may
  repeat. Deduplication retention, quarantined replay authorization and reconciliation
  ownership must be supplied by the host; this is not exactly-once delivery.
- AI data/budgets: Core contracts do not certify provider destinations, retention,
  training settings, tenant cost reservations or remote cancellation. Those host
  controls and live-model evaluation remain unverified.
- Publication/withdrawal: delivery tests and archive checks establish local state
  transitions and payloads. CDN invalidation, direct asset access, old URLs and
  external search/AI copies require separately authorized host delivery checks.

Coding and adapter reuse remain with the existing owners: Core provides pure
contracts; Server provides AtomicRepository/CAS/durable audit/Lifecycle and wraps
Appkit storage; CLI supplies an explicit `resolveSecret(principal,key)` development
port. Core SecretResolver reads cached process environment values, including its
environment-only OCI fallback; no connected Vault/secret-reference adapter is
certified. Appkit owns provider transports, and private business/host implementations
must not enter public imports. Current boundary inspection and isolated consumers
cover declared/literal imports and delivered exports; computed imports, resource
cleanup under real providers, malformed historical data and production DB transaction
behavior need their applicable tests. These deterministic fixtures exercise adapter
protocols, not production-engine transaction or deployed environment acceptance.


The guarded source invocation establishes its existing documented 8192 MiB Node
heap setting before containment appends the preload. Explicit caller `NODE_OPTIONS`
remain authoritative. A real guarded-child regression checks both the effective
heap setting and preserved containment/user flags. The aggregate 6144 MiB process-tree
limit and 20-minute source deadline remain enforced; increasing a child's configured
heap does not permit exceeding that aggregate limit. This corrects verifier environment
composition and requires no package release.

### Public 0.2.0 policy alignment

The source revisions used for this release-preparation review are recorded in
the release task. The older clause catalog and dated runtime review above remain
historical, scoped evidence; their structural result is not a whole-policy
certificate. Common policy does not add backup staffing, response/fix deadlines,
continuous monitoring or ongoing support guarantees to any project.

The owning READMEs and Japanese counterparts now provide reciprocal navigation,
actual technology requirements, English support and private reporting guidance.
Portal wrappers exclude the GitHub language selector because portal language
navigation and translations remain owned by github-docs. Production ingestion
still waits for the selected package's actual publication.

[CONTRIBUTING.md](https://github.com/dataarthub/eaos/blob/main/CONTRIBUTING.md)
names the actual maintainer and reporting channel. Shared policy no longer
imposes the added operating obligations on any project.
Actual contractual commitments remain
independent of adopting these policies. Required artifact,
confidentiality, authorization and publication gates are unchanged. The earlier
security/support observations remain dated findings; they do not create a promise
of staffed support or turn such staffing into a package-release prerequisite.

The private consumer's compatibility and schema-history repair are tracked in its
restricted repository. Actual registry adoption waits for verified public versions.
Private targets and receipts do not enter these public release artifacts. Production
restore/provider acceptance and deployed branch-protection configuration remain
outside this package-only release verification.
