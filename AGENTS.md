# EAOS public monorepo

These instructions apply to this entire repository. Read additional AGENTS.md
files in the package or plugin being changed. This checkout must be usable
without a parent workspace or private repository.

## Ownership and dependencies

- This repository owns the MIT implementations of packages/core, server, react
  and cli, plus the @alneas/eaos-plugins collection. The collection owns
  plugins/package.json and the approval, field-customization and admin feature
  folders; each feature keeps its source, tests and documentation together.
  Do not create feature-level package manifests or a root runtime barrel.
- Core owns pure SDK, schema and entitlement contracts and must not depend on
  Server. Server owns database, Lifecycle and storage implementations. React
  owns browser clients and UI; CLI owns authoring and diagnostic tooling.
- Public packages must never import private implementations, business schemas,
  customer configuration or operator evidence. Keep generic implementations
  canonical here; compatibility wrappers belong to their consuming repository.
- npm workspaces are permitted inside this monorepo. Across repositories, use
  built, checksum-pinned npm tarballs. Do not link sibling source or copy
  Appkit Core 0.2.0 / React 0.3.0 implementations; those remain external dependencies.
- Preserve tenant/resource authorization, CAS, durable audit and migration
  identities. Keep business-specific presets outside generic plugins.

## Local verification

Use the package manager version declared in package.json. From this repository
root, `bun run build` builds all five packages in dependency order and
`bun run test` runs their tests. For focused changes, inspect the owning
package.json and run the relevant existing checks. Verify distributed exports
and runtime/peer requirements through built artifacts when changing package APIs.

Do not create or push GitHub repositories, publish npm packages, apply production
migrations or infrastructure, deploy, or activate real tenants without an
explicit user request.

## Shared standards

### Documentation

For all documentation and JSDoc work, read and follow these shared standards
without a separate user reminder:

- Policy: https://tech-docs.alneas.com/policies/documentation-policy.md
- Skill: https://tech-docs.alneas.com/skills/document-authoring/SKILL.md
- Adoption template: https://tech-docs.alneas.com/templates/project-documentation-instructions.md

Apply them to repository/package READMEs, guides and exported API JSDoc.
Keep GitHub/npm READMEs plain Markdown with these first five H2 sections:
Elevator Pitch; Why & Value; Key Highlights; Quickstart; Next Steps.
Use 3-4 highlights and exact supported imports, with required setup and peers.
Full overview READMEs also keep paired project-owned README.ja.md files,
reciprocal language links, actual technology badges and English support links.
Review translated requirements and code against the canonical English source;
GitHub language selectors are excluded from generated English portal wrappers.
CONTRIBUTING.md names the actual reporting channel and maintainer review ownership.
Generate portal metadata wrappers from their owning README. Change generated
API cards and guidance through their canonical sources, then regenerate and
verify freshness; checks must not repair normal output.

Keep canonical project guides and English JSDoc with their owning project.
github-docs owns shared navigation and Japanese portal translations; ingestion
of approved public content is one-way. Preserve project-owned UI strings and
runtime help separately. Exclude private guides, unapproved drafts,
customer/operator evidence and secrets from public documentation and artifacts.
Production ingestion must match actually published package versions/revisions;
the manifest and disposable previews do not prove release eligibility. Keep
unreleased APIs separate; docs-only corrections must describe released behavior.
The public references above do not require a sibling github-docs checkout.

### Development and release

For implementation and verification selection, read:

- Policy: https://tech-docs.alneas.com/policies/development-policy.md
- Skill: https://tech-docs.alneas.com/skills/developing-projects/SKILL.md
- Adoption template: https://tech-docs.alneas.com/templates/project-workflow-instructions.md

For automated testing and verification setup, read the applicable skill:

- UI, Storybook, Playwright and Kratos auth: https://tech-docs.alneas.com/skills/testing-ui-services/SKILL.md
- UI boilerplate: https://tech-docs.alneas.com/templates/testing/README.md
- Logic, Hono, Oracle DB and contracts: https://tech-docs.alneas.com/skills/testing-logic-services/SKILL.md
- Logic boilerplate: https://tech-docs.alneas.com/templates/testing-logic/README.md

For release preparation, publication or partial-release recovery, read:

- Policy: https://tech-docs.alneas.com/policies/release-policy.md
- Skill: https://tech-docs.alneas.com/skills/preparing-releases/SKILL.md

Derive commands and release conditions from the owning package.json, executable
configuration and existing local guides. Preserve stronger local gates; select
verification from changed inputs. Follow existing user authorization for Git
and external writes. Shared references do not authorize publication or deployment.

### Optional development skills

When Superpowers is available, use its relevant planning, implementation,
debugging, review and verification skills and explain which are being used.
Adapt the workflow to user instructions and repository requirements. Otherwise,
continue with the documented local workflow. Keep useful project decisions in
owning documentation; do not copy external skills or templates unnecessarily.

## Public documentation commands

Run these commands from this repository root; parent-workspace aggregation
commands are not prerequisites for a standalone checkout.

- Canonical guides: docs/, packages/*/docs/ and plugins/*/docs/. Source JSDoc and
  package exports own API contracts. See docs/documentation.md for portal workflows.
- Public ingestion manifest: docs.manifest.json. Register only approved public
  guides and API entrypoints; do not add private sources to resolve public links.
- README targets: readme-policy.json. Run `bun run docs:readmes`.
- README-derived metadata: readme-landings.json. Regenerate with
  `bun run docs:readmes:prepare`; never edit wrappers by hand.
- Generated-output configuration: generated-policy.json. Run
  `bun run docs:generated` for temporary-regeneration freshness verification.

For standalone development and release preparation, follow CONTRIBUTING.md and
RELEASING.md. Run `bun run check`, then prepare and test the exact archive bundle
with `bun run release:prepare` and `bun run test:consumer -- <bundle-directory>`.
The maintained commands enforce process-tree memory/deadline limits; record peak,
status and unexecuted cases. Never relax limits, matrices or a11y to pass. Require
the latest successful invocation; older success cannot override a later failure.
Record reviewed Changesets or a concrete no-release rationale for every change.
Publication requires separate authorization and clean-commit binding. First npm
publication uses the real version and reviewed archive with human 2FA; subsequent
publication requires staged OIDC, human approval and public integrity/tag checks.
Do not create placeholder versions, install hooks or change deployment triggers
merely to adopt shared references.

These are the checks declared in this repository's package.json. Cross-repository
API generation and portal aggregation belong to the maintainer workspace;
confirm its applicable checks when changing those inputs.
