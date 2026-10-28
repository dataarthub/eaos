---
"@alneas/eaos-core": patch
"@alneas/eaos-server": patch
"@alneas/eaos-react": patch
"@alneas/eaos-cli": patch
"@alneas/eaos-plugins": patch
---

Use compatible caret ranges for distributed runtime and peer dependencies, with exact versions and integrity retained in the lockfile. Keep Appkit Core and React on their independently versioned compatible lines. Manifest and registry preflight checks now accept compatible Appkit ranges while rejecting unsupported lines. Host runtime builds preserve dynamic imports in separate chunks so optional implementations remain deferred.
