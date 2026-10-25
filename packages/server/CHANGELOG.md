# @alneas/eaos-server

## 0.2.0

### Added

- Expose canonical `createChatClient` and `createToolAgent` execution APIs backed by existing Appkit chat, Action and execution-session primitives. Connect live authorization, model routes, limits, cancellation, guards, budgets, usage and observations.
- Route built-in LiteLLM tasks through the same chat client. Support Host-owned authentication headers and optional shared chat configuration without changing injected-executor priority or Goose/Hermes process execution.

### Changed

- Align English/Japanese setup and support guidance with actual package requirements; link the existing GitHub private reporting channel without adding a support guarantee.

- Consume EAOS Core ^0.2.0 and reauthorize after asynchronous guards/accounting/telemetry, before returning output. Recheck retained tool history before each subsequent model request.
- Require explicit model-to-adapter bindings when a model registry is configured. Reject protocol-reserved provider parameters rather than allowing them to override the selected model or messages.

### Upgrade

- Built-in LiteLLM now requests OpenAI-compatible SSE streams. JSON-only custom endpoints must provide a compatible Host adapter or injected executor. Existing task result envelopes, endpoint/model/fetch options, HTTP status errors, output ceilings and process dispatch remain supported; common stream, cancellation and validation failures use shared chat diagnostics.
- Provider usage may be unavailable in Appkit events. Host accounting receives unknown usage explicitly and must reconcile it instead of treating it as zero; accounting failures propagate. Keep external side-effect idempotency and durable accounting in the Host.
- Install Core 0.2.0 before Server 0.2.0. This update performs no migrations or tenant activation.

## 0.1.0

### Added

- Allow unrestricted, unmetered Public entitlement rules to skip an external paid entitlement runtime. Authentication and host lifecycle/resource admission remain mandatory.

### Changed

- Adopt public `@alneas/appkit-core@0.2.0`, require Node.js 24 or later, and consume `@alneas/eaos-core@^0.1.0`.
- Use the portable storage download contract: downloads return `Uint8Array` or `null`. Decode text with `TextDecoder`; Node hosts can explicitly wrap bytes with `Buffer`.
- Ship English guides, source-derived API references, complete installation requirements and package history.

### Fixed

- Read current tenant contracts inside the quota reservation's existing transaction instead of nesting a control database transaction.

### Upgrade

- Install the exact Appkit Core 0.2.0 peer, upgrade Node.js to 24 or later, and update adapters expecting a Buffer-only download result.
