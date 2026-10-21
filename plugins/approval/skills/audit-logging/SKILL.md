---
name: platform-audit-logging
description: Preserve an immutable, tenant-scoped audit trail through the EAOS audit sink without duplicating storage providers.
metadata:
  origin: AIWorker
  source: AIWorker/skills/core/audit-logging/SKILL.md
  version: "1.1.0"
  category: governance
  tags: [audit, compliance, observability, pii]
---

# Audit Logging

Use EAOS Gatekeeper and the Host-provided audit sink as the authoritative audit path. Oracle, S3 WORM, Langfuse, retention, and PII policy are Host configuration, not plugin-owned clients.

## Workflow

1. Capture verified tenant, user, trace, operation, target revision, decision, receipt, and bounded outcome.
2. Redact secrets and unnecessary PII before the sink receives arguments or results.
3. Record blocked, pending, accepted, completed, failed, and unavailable outcomes distinctly.
4. Link retries, approvals, escalations, and external receipts to the original trace and idempotency key.
5. Treat sink failure according to Host durability policy; never invent a successful audit or business result.

## Verification

- Audit records are tenant-scoped and append-only from the Skill's perspective.
- A log entry is not a substitute for current authorization or an operation receipt.
- Observability failure does not create a second execution path.
