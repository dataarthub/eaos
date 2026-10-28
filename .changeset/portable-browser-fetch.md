---
"@alneas/eaos-react": patch
---

Use a portable BrowserFetch call signature for workspace and verified compute asset adapters, allowing ordinary browser fetch functions when Bun adds static helpers to the global fetch type. Runtime credential, cancellation and checksum behavior remains unchanged.
