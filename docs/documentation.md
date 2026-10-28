---
title: "Maintain public EAOS documentation"
description: "Read the ALNEAS documentation policy and the document-authoring skill before editing. Build public declarations before generating API reference. Keep local operator evidence, credentials, private business guides and migration scratchpads outside the public manifest."
sidebar:
  order: 20
archetype: "how-to"
project: "eaos-workspace"
tags: ["eaos", "how-to"]
---

# Maintain public EAOS documentation

## Prerequisites

Read the [ALNEAS documentation policy](https://tech-docs.alneas.com/policies/documentation-policy.md) and the [document-authoring skill](https://tech-docs.alneas.com/skills/document-authoring/SKILL.md) before editing. Build public declarations before generating API reference. Keep local operator evidence, credentials, private business guides and migration scratchpads outside the public manifest.

## Step-by-Step Implementation

1. Update paired English/Japanese READMEs together, including reciprocal language links, verified technology badges, Japanese portal coverage and an English support path. English is canonical; README translations stay project-owned and separate from portal translations.
2. Edit the owning package's English source under `docs/` or its README. Classify each page as tutorial, how-to, reference or explanation. Landing pages use Elevator Pitch → Why & Value → Key Highlights → Quickstart → Next Steps.
3. Add title, description, sidebar order, archetype, project and tags frontmatter. Examples include complete imports and use only synthetic values. Keep local paths and real host/tenant settings out of public content.
4. Keep this project's canonical public guides in English. Japanese portal translations are owned by github-docs under `src/data/translations/pages/eaos-workspace/` and rendered into its `src/content/docs/ja/eaos-workspace/` routes. Do not register portal translations as upstream `sourceJa` entries. Preserve code snippets and identifiers; missing portal translations fall back to English. Existing Japanese runtime-help assets remain separate from portal translation ownership.
5. Regenerate API cards from built declarations and source export names. Do not edit generated reference cards. TypeScript/JSDoc and the package export map own these contracts.
6. In each developer feature guide, add a **Public import** section with a package installation command, exact exported subpath and a self-contained example. State the selected runtime, peers, stylesheet and provider requirements. Keep implementation instructions in developer guides; link to them from end-user operation guides. Check named exports against built declarations as well as the package export map.
7. Add only reviewed public pages to `docs.manifest.json`. Use relative source links; ingestion maps them to registered page routes. New files and private folders are excluded by default.

From this public repository, run `bun run docs:readmes:prepare`, `bun run docs:api` and `bun run docs:check`. These commands need no private checkout.

The following additional aggregation commands are maintainer-workspace commands, run from its root:

```bash
bun run docs:prepare
bun run docs:verify
bun run docs:portal:verify
bun run docs:sync
bun run docs:build
```

The public manifest is `eaos/docs.manifest.json`. The workspace adapter requires a prepared github-docs checkout on `docs/eaos-docs-updates`; `EAOS_DOCS_PORTAL` can select another checkout of that branch. Its approved EAOS source must point to this public repository. `docs:sync` delegates to the portal's native `scripts/ingest.ts` for this manifest only, retaining portal-owned Japanese translations and recording source hashes and revision provenance. `docs:portal:check` regenerates EAOS pages into temporary storage and fails on changed, missing or obsolete portal output without repairing it. `docs:build` runs that freshness check and the shared portal build; `docs:preview` starts its background development server. The retired standalone preview is no longer used. A local preview can reflect the working tree and is not
release-aligned publication evidence. Before production ingestion, identify the
actual published version/revision for each independently released target and
exclude unpublished behavior/API cards, or place them in explicitly marked
development material. Reviewed corrections to already released behavior may ship
without a package release, provided API generation does not sweep in unreleased
contracts. See [release preparation](../RELEASING.md) for the delivery boundary;
 github-docs remains the shared portal for ecosystem navigation and governance.

## Verification

`docs:verify` checks manifest paths, visibility, frontmatter, archetypes, English root content, public links, API cards, landing sections and secret/path exclusions. `docs:portal:verify` runs the native portal preflight without writing pages. `docs:sync` refuses invalid sources before ingestion. `docs:test` runs adapter tests and the portal ingestion, translation and API regressions; `docs:build` runs the portal's own freshness and Astro build gates. Standalone public checks remain independent of the maintainer workspace and portal checkout.

The portal's read-only preflight can also run from the owning checkout:

```bash
bun /path/to/github-docs/scripts/ingest.ts --verify --project=docs.manifest.json
```

Run that command in `eaos`. It performs no publication. Shared ingestion remains one-way; fix errors here instead of editing generated portal pages.

## Troubleshooting / Common Pitfalls

- Missing manifests or unlisted links fail verification; explicitly register the intended public page.
- Never mark a private guide public just to resolve a link. Write a separately reviewed public explanation when needed.
- The JSDoc audit checks source summaries, parameter/return/type-parameter tags and usage references through declared package exports, including public methods and inline parameter/result properties. Cross-package re-exports point to their owning reference. The audit does not prove semantic correctness, error completeness or the validity of an example. Review implementations and tests, and type-check source examples in an isolated installed-artifact consumer with the maintainer-workspace root command `bun run docs:examples --consumer=<consumer-directory>`. This additional workspace command performs type checking without executing examples or using sibling-source aliases.
- API drift requires rebuilding declarations and regenerating cards, not hand-editing reference files.
- Keep action skills distinct from human references and keep `llms.txt` as navigation only.
- Preserve private completion receipts and deployed state separately from documentation success.
