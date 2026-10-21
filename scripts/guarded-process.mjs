// Adapted from https://tech-docs.alneas.com/templates/testing/guarded-process.mjs
// Reviewed upstream revision: 7adef0d1ff740e1b9fdd3471583aab02285996c8 (MIT).
import { spawn, execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Bound a trusted Node browser-test entrypoint, its descendants and owned groups. */
export async function runGuarded(command, args, {
  cwd = process.cwd(), env = process.env, memoryLimitMiB = 3072,
  timeoutMs = 600_000, intervalMs = 500, stdio = 'inherit',
} = {}) {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Browser memory guard requires macOS or Linux ps/process groups.');
  if (![memoryLimitMiB, timeoutMs, intervalMs].every(value => Number.isFinite(value) && value > 0)) throw new Error('Guard budgets must be positive finite numbers.');
  if (realpathSync(command) !== realpathSync(process.execPath)) throw new Error('Guard requires a Node entrypoint; native daemon launchers require OS containment.');
  const preload = fileURLToPath(new URL('./browser-containment.cjs', import.meta.url));
  const childEnv = { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --require=${JSON.stringify(preload)}`.trim() };
  const child = spawn(command, args, { cwd, env: childEnv, stdio, detached: true });
  const groups = new Set([child.pid]);
  const cleanupErrors = [];
  let reason, peakMiB = 0, escalation, abandoned;
  let abandon;
  const cleanupDeadline = new Promise(resolve => { abandon = resolve; });
  const signalGroups = signal => {
    if (!child.pid) return;
    for (const groupId of groups) {
      try { process.kill(-groupId, signal); } catch (error) {
        if (error.code === 'ESRCH') continue;
        try {
          // macOS can deny signals to groups that contain only exiting/zombie tasks.
          const states = execFileSync('/bin/ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', timeout: 2_000 })
            .trim().split('\n').map(line => line.trim().split(/\s+/));
          if (error.code === 'EPERM' && !states.some(([group, state]) => Number(group) === groupId && !/[ZE]/.test(state))) continue;
        } catch (inspectionError) { cleanupErrors.push(inspectionError.message); }
        cleanupErrors.push(`Cannot ${signal} owned group ${groupId}: ${error.message}`);
      }
    }
  };
  const stop = message => {
    if (reason) return;
    reason = message;
    signalGroups('SIGTERM');
    escalation = setTimeout(() => signalGroups('SIGKILL'), 2_000);
    abandoned = setTimeout(() => {
      signalGroups('SIGKILL');
      cleanupErrors.push(`Owned process cleanup did not complete; groups: ${[...groups].join(', ')}`);
      abandon({ code: null, signal: null });
    }, 4_000);
  };
  const interrupted = () => stop('Interrupted; browser process groups terminated.');
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const started = Date.now();
  const timer = setInterval(() => {
    try {
      const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,rss='], { encoding: 'utf8', timeout: 2_000 })
        .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      const owned = new Set(rows.filter(([, , group]) => groups.has(group)).map(([pid]) => pid));
      owned.add(child.pid);
      for (let changed = true; changed;) {
        changed = false;
        for (const [pid, parent] of rows) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); changed = true; }
      }
      const descendants = rows.filter(([pid]) => owned.has(pid));
      for (const [pid, , group] of descendants) if (pid === group) groups.add(group);
      const used = descendants.reduce((sum, [, , , rss]) => sum + rss, 0) / 1024;
      peakMiB = Math.max(peakMiB, used);
      if (used > memoryLimitMiB) stop(`Browser memory budget exceeded: ${Math.ceil(used)} MiB > ${memoryLimitMiB} MiB. No tests were skipped.`);
      if (Date.now() - started > timeoutMs) stop(`Browser deadline exceeded: ${timeoutMs} ms. No tests were skipped.`);
    } catch (error) { stop(`Cannot enforce browser memory guard: ${error.message}`); }
  }, intervalMs);
  let result;
  try {
    result = await Promise.race([cleanupDeadline, new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    })]);
  } finally {
    clearInterval(timer);
    clearTimeout(escalation);
    clearTimeout(abandoned);
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    signalGroups('SIGKILL');
  }
  if (cleanupErrors.length) reason = [reason, ...cleanupErrors].filter(Boolean).join('\n');
  return { ...result, reason, peakMiB: Math.ceil(peakMiB), ok: result.code === 0 && !reason };
}
