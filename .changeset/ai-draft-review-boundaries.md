---
"@alneas/eaos-core": minor
"@alneas/eaos-react": minor
"@alneas/eaos-plugins": minor
---

Add configurable document ingestion and exact journal-line helpers, with shared AI policy normalization and policy-bound review envelopes. Industry routing, account selection and posting remain owned by domain plugins and Hosts.

Record workspaces require a Host review connection before submitting an AI draft. The approval collection connects the reviewed command to its existing durable approval workflow and checks current input, target, policy and decision evidence before invoking the owning save command. Hosts retain final authorization, CAS, command idempotency and transactional audit responsibilities.

These development APIs replace the branch's unreleased construction, simulated model and independent ledger lifecycle helpers. React now declares its Core peer explicitly.
