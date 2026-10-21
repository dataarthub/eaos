// Adapted from https://tech-docs.alneas.com/templates/testing/browser-containment.cjs
// Reviewed upstream revision: 7adef0d1ff740e1b9fdd3471583aab02285996c8 (MIT).
// Test-runner preload: Node/Playwright children must remain in the owned group.
// This is process containment for trusted test tooling, not an OS security sandbox.
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const { syncBuiltinESMExports } = require('node:module');
const preload = `--require=${JSON.stringify(__filename)}`;
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const original = childProcess[name];
  const wrapped = function (...args) {
    let index = args.findIndex((arg, i) => i > 0 && arg && typeof arg === 'object' && !Array.isArray(arg));
    if (index < 0) {
      index = Array.isArray(args[1]) ? 2 : 1;
      args.splice(index, 0, {});
    }
    const options = args[index];
    const env = { ...(options.env ?? process.env) };
    if (!env.NODE_OPTIONS?.includes(__filename)) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} ${preload}`.trim();
    args[index] = { ...options, detached: false, env };
    return original.apply(this, args);
  };
  for (const key of Reflect.ownKeys(original)) {
    if (key === promisify.custom) continue;
    Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(original, key));
  }
  if (original[promisify.custom]) {
    Object.defineProperty(wrapped, promisify.custom, {
      ...Object.getOwnPropertyDescriptor(original, promisify.custom),
      value: (...args) => {
        let child;
        const promise = new Promise((resolve, reject) => {
          child = wrapped(...args, (error, stdout, stderr) => {
            if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); }
            else resolve({ stdout, stderr });
          });
        });
        promise.child = child;
        return promise;
      },
    });
  }
  childProcess[name] = wrapped;
}
syncBuiltinESMExports();
