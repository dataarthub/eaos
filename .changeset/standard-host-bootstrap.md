---
"@alneas/eaos-server": minor
---

Add the `/host` entry for standard authenticated backend startup with explicit feature adoption, injected membership/Lifecycle/entitlement capabilities and shared current-request MCP binding. Hosts retain their concrete providers, application routers and process listener. Empty adoption remains empty, tenant-scoped extensions preserve admission, and missing Lifecycle fails closed in the standard API. Existing Engine and extension APIs remain supported.
