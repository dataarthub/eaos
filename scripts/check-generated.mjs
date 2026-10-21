// Canonical source: https://tech-docs.alneas.com/templates/generated/check-generated.mjs
// Node 24+. Reviewed project generators must honor {outputDir}; this is not a sandbox.
import { lstatSync, readdirSync, readFileSync, realpathSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, isAbsolute, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function validate(config) {
 if (config?.schemaVersion !== 1 || !Array.isArray(config.jobs) || !config.jobs.length) throw Error('Expected schemaVersion 1 and at least one generation job');
 const names = new Set();
 for (const job of config.jobs) {
  if (typeof job.name !== 'string' || !job.name.trim() || names.has(job.name)) throw Error('Generation jobs need unique, nonempty names');
  names.add(job.name);
  if (!Array.isArray(job.command) || !job.command.length || job.command.some(arg => typeof arg !== 'string' || !arg.length)) throw Error(job.name + ': command must be an executable/argument array');
  if (job.command[0].includes('{outputDir}') || !job.command.slice(1).some(arg => arg.includes('{outputDir}'))) throw Error(job.name + ': command arguments must explicitly contain {outputDir}');
  if (!Array.isArray(job.outputs) || !job.outputs.length) throw Error(job.name + ': expected generated output paths');
  for (const output of job.outputs) {
   if (typeof output !== 'string' || !output || output === '.' || isAbsolute(output) || /^[A-Za-z]:/.test(output) || /[\\*?\u0000]/.test(output) || output.split('/').some(part => !part || part === '..' || part === '.') || output !== posix.normalize(output)) throw Error(job.name + ': output paths must be canonical project-relative files or directories');
   if (['.git', 'node_modules'].includes(output.split('/')[0])) throw Error(job.name + ': reserved output scope');
  }
  if (job.outputs.some((scope, i) => job.outputs.some((other, j) => i !== j && (scope === other || scope.startsWith(other + '/'))))) throw Error(job.name + ': overlapping output scopes');
  if (!Number.isInteger(job.timeoutMs ?? 60000) || (job.timeoutMs ?? 60000) < 1 || (job.timeoutMs ?? 60000) > 60000) throw Error(job.name + ': timeoutMs must be between 1 and 60000');
 }
}
function info(path) {
 try { return lstatSync(path); }
 catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
function checkParents(root, path) {
 let current = root;
 for (const part of path.split('/')) {
  current = join(current, part);
  const stat = info(current);
  if (!stat) break;
  if (stat.isSymbolicLink()) throw Error('Symlink in output path: ' + path);
 }
}
function collect(root, path, files) {
 const stat = info(join(root, path));
 if (!stat) return;
 if (stat.isSymbolicLink()) throw Error('Symlink in output tree: ' + path);
 // Finder metadata is not a generated artifact; never delete or compare it.
 if (stat.isFile() && posix.basename(path) === '.DS_Store') return;
 if (stat.isDirectory()) {
  for (const name of readdirSync(join(root, path)).sort()) collect(root, path ? path + '/' + name : name, files);
 } else if (stat.isFile()) files.set(path, readFileSync(join(root, path)));
 else throw Error('Unsupported generated output type: ' + path);
}

/**
 * Regenerate into disposable output directories and compare bytes with project outputs.
 * @param {string} projectRoot Owning repository directory; used as the generator's working directory.
 * @param {{schemaVersion: number, jobs: Array<{name: string, command: string[], outputs: string[], timeoutMs?: number}>}} config Reviewed generation commands and exclusive generated file/directory scopes.
 * @returns {Array<{name: string, differences: Array<{path: string, kind: 'changed'|'missing'|'extra'}>}>} Per-job differences; an empty differences array means a byte-for-byte match.
 * @throws {Error} For invalid config, unsafe output paths, failed/timed-out generators or empty/unregistered generated output. Temporary directories are removed on success and failure.
 * @example
 * import { readFileSync } from 'node:fs';
 * import { checkGenerated } from './scripts/check-generated.mjs';
 * const config = JSON.parse(readFileSync('generated-policy.json', 'utf8'));
 * const reports = checkGenerated(process.cwd(), config);
 * if (reports.some(report => report.differences.length)) process.exitCode = 1;
 */
export function checkGenerated(projectRoot, config) {
 validate(config);
 const root = realpathSync(resolve(projectRoot));
 // Validate existing output boundaries before executing any generator.
 for (const job of config.jobs) for (const output of job.outputs) {
  checkParents(root, output);
  collect(root, output, new Map());
 }
 const reports = [];
 for (const job of config.jobs) {
  const temporary = mkdtempSync(join(tmpdir(), 'alneas-generated-'));
  try {
   const [executable, ...args] = job.command.map(arg => arg.replaceAll('{outputDir}', temporary));
   const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: job.timeoutMs ?? 60000, maxBuffer: 1024 * 1024, windowsHide: true });
   if (result.error?.code === 'ETIMEDOUT') throw Error(job.name + ': generator timed out');
   if (result.error || result.status !== 0) throw Error(job.name + ': generator failed' + (result.status === null ? '' : ' (exit ' + result.status + ')'));
   const fresh = new Map();
   collect(temporary, '', fresh);
   if (!fresh.size) throw Error(job.name + ': generator produced no output files; verify {outputDir} support');
   for (const path of fresh.keys()) if (!job.outputs.some(scope => path === scope || path.startsWith(scope + '/'))) throw Error(job.name + ': unregistered generated output: ' + path);
   const current = new Map();
   for (const output of job.outputs) {
    checkParents(root, output);
    collect(root, output, current);
    if (![...fresh.keys()].some(path => path === output || path.startsWith(output + '/'))) throw Error(job.name + ': no regenerated files for output scope: ' + output);
   }
   const differences = [];
   for (const path of [...new Set([...current.keys(), ...fresh.keys()])].sort()) {
    if (!current.has(path)) differences.push({ path, kind: 'missing' });
    else if (!fresh.has(path)) differences.push({ path, kind: 'extra' });
    else if (!current.get(path).equals(fresh.get(path))) differences.push({ path, kind: 'changed' });
   }
   reports.push({ name: job.name, differences });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
 }
 return reports;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  const config = JSON.parse(readFileSync(resolve(process.cwd(), process.argv[2] ?? 'generated-policy.json'), 'utf8'));
  const reports = checkGenerated(process.cwd(), config);
  for (const report of reports) {
   if (!report.differences.length) console.log(report.name + ': generated outputs are current');
   for (const difference of report.differences) console.error(report.name + ': ' + difference.kind + ' ' + difference.path);
  }
  if (reports.some(report => report.differences.length)) process.exitCode = 1;
 } catch (error) { console.error(error.message); process.exitCode = 1; }
}
