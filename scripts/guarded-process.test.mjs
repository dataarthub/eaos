// Adapted from https://tech-docs.alneas.com/templates/testing/guarded-process.test.mjs
// Reviewed upstream revision: 7adef0d1ff740e1b9fdd3471583aab02285996c8 (MIT).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runGuarded } from './guarded-process.mjs';

const options = { stdio: 'ignore', intervalMs: 30, memoryLimitMiB: 512, timeoutMs: 5_000 };
test('normal completion and failed checks retain their exit status', async () => {
  assert.equal((await runGuarded(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], options)).ok, true);
  const failed = await runGuarded(process.execPath, ['-e', 'process.exit(7)'], options);
  assert.equal(failed.code, 7);
  assert.equal(failed.ok, false);
});

test('deadline terminates a stuck invocation and reports failure', async () => {
  const result = await runGuarded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeoutMs: 120 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /deadline exceeded/);
});

test('memory budget includes a browser-like grandchild and cleans the group', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'appkit-memory-guard-'));
  const pidFile = path.join(dir, 'child.pid');
  try {
    const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); globalThis.held = Buffer.alloc(192 * 1024 * 1024, 1); setInterval(() => {}, 1000);`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore', detached: true }); setInterval(() => {}, 1000);`;
    const result = await runGuarded(process.execPath, ['-e', parent], { ...options, memoryLimitMiB: 128 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /memory budget exceeded/);
    assert.ok(result.peakMiB > 128);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let active = true;
    for (let i = 0; i < 30 && active; i++) {
      try { active = !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim().startsWith('Z'); }
      catch { active = false; }
      if (active) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(active, false, 'descendant must no longer be running');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('missing process inspection fails closed instead of silently dropping the guard', async () => {
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-appkit-path';
    const result = await runGuarded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, env: { ...process.env, PATH: originalPath } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /Cannot enforce browser memory guard/);
  } finally { process.env.PATH = originalPath; }
});

test('invalid budgets are rejected before starting a process', async () => {
  await assert.rejects(runGuarded(process.execPath, [], { memoryLimitMiB: 0 }), /positive finite/);
});

test('a runner exiting before the first poll cannot orphan a detached Node child', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'appkit-early-exit-'));
  const pidFile = path.join(dir, 'child.pid');
  let pid;
  try {
    const code = `const cp = require('node:child_process'); const fs = require('node:fs'); const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH } }); fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setTimeout(() => process.exit(0), 50);`;
    const result = await runGuarded(process.execPath, ['-e', code], { ...options, intervalMs: 500 });
    assert.equal(result.ok, true);
    pid = Number(readFileSync(pidFile, 'utf8'));
    let active = true;
    for (let i = 0; i < 40 && active; i++) {
      try { active = !/[ZE]/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()); }
      catch { active = false; }
      if (active) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(active, false, 'early-exit child must be contained and terminated');
  } finally {
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SIGTERM-resistant work is force-killed within the cleanup deadline', async () => {
  const result = await runGuarded(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { ...options, timeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /deadline exceeded/);
  assert.equal(result.signal, 'SIGKILL');
});

test('containment preserves promisified exec/execFile contracts for CJS and ESM', async () => {
  const body = `const promise = promisify(execFile)(process.execPath, ['-e', 'process.stdout.write("ok")']); assert.ok(promise.child?.pid); assert.deepEqual(await promise, { stdout: 'ok', stderr: '' }); const shell = promisify(exec)('echo ok'); assert.ok(shell.child?.pid); assert.equal((await shell).stdout.trim(), 'ok');`;
  const imports = [
    `const { promisify } = require('node:util'); const { exec, execFile } = require('node:child_process'); const assert = require('node:assert/strict'); (async () => { ${body} })().catch(() => process.exit(1));`,
    `import { promisify } from 'node:util'; import { exec, execFile } from 'node:child_process'; import assert from 'node:assert/strict'; ${body}`,
  ];
  for (const [index, code] of imports.entries()) {
    const result = await runGuarded(process.execPath, [...(index ? ['--input-type=module'] : []), '-e', code], options);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});
