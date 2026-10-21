---
name: platform-approval-policy
description: Route high-impact AI proposals through EAOS approval records and durable workflow resumption.
metadata:
  origin: AIWorker
  source: AIWorker/skills/core/approval-policy/SKILL.md
  version: "1.0.0"
  category: governance
  tags: [approval, human-in-the-loop, policy, audit]
---

# Approval Policy

Use the EAOS approval plugin and server workflow as the authority. Do not create a second LangGraph, approval database, notification engine, or approval level vocabulary.

## Workflow

1. Classify the proposed operation using the Host policy and current Gatekeeper result.
2. Create a tenant/user/trace-bound approval request with the exact target revision, evidence, requested operation, expiry, and required approver role.
3. Pause the workflow at the approval gate. Do not execute a write while the request is pending.
4. On callback, verify the approval id, revision, target, approver authorization, and current activation before consuming the decision once.
5. Continue only from the approved checkpoint. Rejection, revision, expiry, or stale state remains an explicit terminal or reviewable outcome.

## Verification

- Client fields cannot forge tenant, role, approval, or current authorization.
- Approval receipt does not prove the business operation completed.
- Every decision is linked to the same trace and audit sink.
- Notifications are delivery adapters; they do not grant approval.
