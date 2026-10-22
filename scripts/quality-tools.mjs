// Adapted from dataarthub/appkit MIT maintenance tooling. Copyright ALNEAS.
import path from 'node:path';
export const gitleaksVersion = '8.30.1';
export const gitleaksChecksums = {
  darwin_arm64: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  darwin_x64: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  linux_arm64: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  linux_x64: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
};
export const localGitleaks = path.resolve(import.meta.dirname, '../.verification/tools/gitleaks/gitleaks');


// Establish source-build flags before containment adds its own NODE_OPTIONS preload.
export function sourceVerificationEnvironment(env = process.env) {
  return { ...env, NODE_OPTIONS: env.NODE_OPTIONS || '--max-old-space-size=8192' };
}
