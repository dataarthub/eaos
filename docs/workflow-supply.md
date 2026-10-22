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
