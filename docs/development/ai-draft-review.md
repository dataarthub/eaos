---
title: "AI draft review integration"
description: "Development contracts for plugin-owned extraction and policy-bound approval before saving reviewed commands."
archetype: "how-to"
project: "eaos-workspace"
tags: ["ai", "development", "approval"]
---

# AI draft review integration

This guide describes the AI draft APIs included in the 0.2.0 release candidate. It is not registered for portal ingestion. Use the matching package versions or verified candidate archives; publication and deployment are separate actions.

## Prerequisites

- Compatible Core, Server, React and the optional approval collection from the same reviewed candidate.
- Appkit Core 0.2.0 / React 0.3.0, the React peers declared by the owning manifest, and `@alneas/appkit-react/styles` at the application boundary. The Host stylesheet supplies its native-control reset (for example Tailwind preflight), including inherited font/theme foreground and transparent default backgrounds for native buttons, inputs, selects and textareas. Keep the reset in the Host base CSS layer so component utilities retain precedence.
- A verified principal resolver, current plugin/resource authorization, durable proposal and approval stores, and an owning command that enforces schema validation, CAS, idempotency and atomic audit.

## Keep business decisions with their owner

Core exposes `IngestionModelAdapter`, configurable classifiers and domain handlers. Without a model or classifier, input remains a general memo. Business plugins provide domain routing, extraction prompts, account mappings and completion providers. Core does not supply a live LLM or Docling connection.

`generateJournalDraftFromDocument` from `@alneas/eaos-core/plugin-sdk/journal-draft` produces an uncommitted candidate using injected debit/credit mappings. `assertBalancedLines` and `invertJournalLines` are pure helpers. Posting, open-period checks, approvals and reversal records belong to the domain service; Core does not implement a parallel ledger lifecycle.

## Reuse Appkit at the shared boundary

The pinned Appkit Core 0.2.0 / React 0.3.0 public APIs remain canonical for generic presentation and review mechanics:

| Responsibility | Owner and integration |
| --- | --- |
| Primitive proposal validation, source consistency and candidate/apply payloads | Appkit Core `ai/proposal`; `prepareAiDraftSubmission` delegates to `prepareProposalBatch` before the Host request. |
| Generic JSON Schema validation | Appkit Core `ai/validation`; the EAOS hybrid ledger projection uses `createAjvValidator` with noncoercing defaults. |
| Forms, tables, theme and UI controls | Appkit React `tools/form`, `tools/data-table`, `tools/core` and `tools/ui`. |
| Generated UI component schemas | Appkit Core `ai/generative-ui`; EAOS supplies domain component registration and authorized data. |
| General editor blocks and JSON persistence | Appkit Core `data/editor`; use its block schema and serializers for an actual editor. The EAOS hybrid ledger projection is not an alternative editor engine. |
| Provider chat HTTP/SSE protocols | Appkit Core `ai/ai-chat`, including its OpenAI-compatible adapter; new Host ingestion adapters compose that transport with plugin-owned extraction/schema policy. |
| Tenant authorization, policy-bound durable approvals, CAS and domain transactions | EAOS Server, approval feature and the owning Host/domain command. Appkit review/actions do not provide these server guarantees. |

Current public Appkit APIs do not expose an OCR table parser, evidence-coordinate contract or completion-provider contract matching these ports. They and generic confidence/simulation presentation contracts are candidates for a separate upstream Appkit contribution. EAOS retains operation routing, source revision and approval policy fields. Keep the EAOS adapters minimal until a supported public contract exists; do not copy an Appkit implementation or import its internal files. The existing LiteLLM worker remains a Host-specific pre-existing execution adapter; this draft integration adds no provider HTTP client.

## Connect review before saving

1. Supply `RecordWorkspace.aiDraft` with the owning `scope`. An edit or record-bound command also needs the exact `targetId` and `baseRevision`. Creation and independent commands have no existing target. Form inputs are normalized against the owning schema after operator edits.
2. Configure `reviewAiDraft` as a transport to an authenticated Host endpoint. The UI converts the exact command input into an Appkit `RecordProposal` envelope. Its primitive `title` and JSON `data` fields describe the review envelope, not arbitrary domain fields. Existing source values form the edit baseline.
3. Configure `ApprovalPluginOptions.reviewedDrafts` on the existing approval plugin. Its authenticated router mounts `POST /drafts/review` under the configured approval API prefix and shares the configured `ApprovalService`. Without these Host ports the endpoint remains unavailable.

   ```typescript
   import { createPlugin, type ApprovalPluginOptions } from '@alneas/eaos-plugins/approval'

   export function connectApproval(options: ApprovalPluginOptions, resolvePrincipal: Parameters<typeof createPlugin>[1]) {
     return createPlugin(options, resolvePrincipal)
   }
   ```

   The normal approval options supply durable storage, live authorization, template resolution and `verifyBinding`. The `reviewedDrafts` ports supply `templateId`, `resolveContract`, `saveProposal` and `execute`. `resolveContract` authorizes the current operation and resolves its current execution contract on every request. `saveProposal` durably retains the exact proposal/binding before approval submission. `execute` invokes the owning domain command with the approved input and approval request ID. Bind `reviewAiDraft` to this existing endpoint using the Host's authenticated transport.
4. A first submission returns `pending` and an approval request ID, with no domain write. The assigned reviewer uses the existing approval workflow. On a later save attempt, the bridge rereads and verifies the stored proposal, current contract, tenant, requester, resource, revision and final decision receipt. Only an unchanged approved request reaches `execute`.
5. Return the owning command's scoped `WorkspaceSnapshot` as the applied result. The UI consumes the draft after a valid response. `onApplyAiDraft` is an optional post-save notification; its failure does not turn a completed save into a retryable form.

The browser cannot grant approval. The Host must resolve identity independently and reauthorize at the owning save transaction. `execute` must deduplicate retries by approval request ID or the reviewed command ID, and preserve final CAS/audit checks. The bridge does not create a transaction across arbitrary stores. If submission or execution has an uncertain outcome, reconcile the retained proposal, approval and command receipt before replaying it.

## Verify policy changes and failure paths

Declare `aiRiskLevel` on the plugin's canonical Gatekeeper policy. Shared normalization prevents explicit policy fields from weakening an AI tier's minimum review requirements. Contract snapshots retain the AI tier so changed restrictions invalidate approval compatibility.

Verify missing review connections, rejected/pending approvals, operator edits after approval, foreign/stale targets, policy changes, revoked access, session replacement and repeated execution. Browser coverage must exercise actual edits and ordinary clicks with the real UI styles. Local workflow tests do not certify production identity providers, LLM credentials or database deployments.
