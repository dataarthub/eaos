import { readFile, realpath, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve, dirname, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as netServer } from 'node:net'
import {parseSitePublicationPolicy,type SitePublicationPolicy} from '@alneas/eaos-server/platform'

/**
 * Host-registered local site, script and remote control bindings.
 * @see {@link parseSiteOperationsConfig} for the canonical usage example and runtime requirements.
 */
export interface LocalSiteProfile {
 
    /**
   * Unique registered site key, limited to 1–80 letters, digits, underscores or hyphens.
   */
  id: string; 
    /**
   * Nonblank human-readable site label.
   */
  name: string; 
    /**
   * CMS site identity required to match a supplied snapshot.
   */
  cmsSiteId: string; 
    /**
   * Optional absolute trusted local project directory; required for local execution.
   */
  directory?: string; 
    /**
   * Loopback preview proxy port; defaults to 4321 and reserves the next port for the upstream process.
   */
  port?: number
 
    /**
   * Trusted package script name; defaults to build.
   */
  buildScript?: string; 
    /**
   * Trusted package preview script name; defaults to dev.
   */
  previewScript?: string; 
    /**
   * Explicit additional environment variable names forwarded to project scripts; reserved snapshot bindings cannot be selected.
   */
  envKeys?: string[]
 
    /**
   * Optional HTTPS or loopback control endpoint and the environment variable containing its token.
   */
  api?: {
    /** Registered HTTPS or loopback HTTP control-service base URL without credentials, query, or fragment; allowlisted paths are appended to it. */
  baseUrl: string;
    /** Uppercase environment-variable name containing the Bearer token read for each control request; a missing/empty value rejects the call. */
  tokenEnv: string }
 
    /**
   * Host-selected site publication policy, validated but not executed during catalog parsing.
   */
  publication?: SitePublicationPolicy
}
/**
 * Explicit catalog of sites and the host-selected Bun executable.
 * @see {@link parseSiteOperationsConfig} for the canonical usage example and runtime requirements.
 */
export interface SiteOperationsConfig { 
    /**
   * Absolute trusted Bun executable path; local site execution requires this registration.
   */
  bunPath?: string; 
    /**
   * Explicit list of at most 100 uniquely identified site registrations.
   */
  sites: LocalSiteProfile[] }
/**
 * Validate the registered local-site catalog and return an independent copy.
 * @param input - Unknown configuration with at most 100 unique site profiles and an optional absolute Bun executable path.
 * @returns A structured clone of the validated site catalog.
 * @throws If profiles, ports, script names, environment bindings or API endpoints violate the catalog contract.
 * @remarks Validation does not inspect registered filesystem paths, start a site or authenticate a remote endpoint.
 * @example
 * import { parseSiteOperationsConfig } from '@alneas/eaos-cli/site'
 * const config = parseSiteOperationsConfig({ sites: [] })
 */
export function parseSiteOperationsConfig(input: unknown): SiteOperationsConfig {
 const c = input as SiteOperationsConfig
 if (!c || Object.keys(c).some(k => !['bunPath','sites'].includes(k)) || !Array.isArray(c.sites) || c.sites.length > 100 || c.bunPath !== undefined && (typeof c.bunPath !== 'string' || !isAbsolute(c.bunPath))) throw Error('siteOperations requires registered sites and an absolute bunPath')
 const ids = new Set<string>()
 for (const s of c.sites) {
  if (!s || Object.keys(s).some(k => !['id','name','cmsSiteId','directory','port','buildScript','previewScript','envKeys','api','publication'].includes(k)) || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || ids.has(s.id) || typeof s.name !== 'string' || !s.name.trim() || typeof s.cmsSiteId !== 'string' || !s.cmsSiteId.trim() || s.directory !== undefined && (typeof s.directory !== 'string' || !isAbsolute(s.directory))) throw Error('Invalid registered site')
  if(s.publication!==undefined)parseSitePublicationPolicy(s.publication)
  ids.add(s.id)
  if (s.port !== undefined && (!Number.isInteger(s.port) || s.port < 1024 || s.port > 65533)) throw Error('Invalid local preview port')
  for (const script of [s.buildScript, s.previewScript]) if (script !== undefined && (typeof script !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(script))) throw Error('Invalid registered script')
  if (s.envKeys !== undefined && (!Array.isArray(s.envKeys) || s.envKeys.some(k => typeof k !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(k) || ['EAOS_CMS_SNAPSHOT_FILE','EAOS_CMS_SITE_ID','EAOS_CMS_DRAFT_PREVIEW'].includes(k)))) throw Error('Invalid environment binding')
  if (s.api) {
   if (Object.keys(s.api).some(k => !['baseUrl','tokenEnv'].includes(k)) || typeof s.api.baseUrl !== 'string' || typeof s.api.tokenEnv !== 'string') throw Error('Invalid site control endpoint')
   const u = new URL(s.api.baseUrl)
   if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)) || u.username || u.password || u.search || u.hash || !/^[A-Z_][A-Z0-9_]*$/.test(s.api.tokenEnv)) throw Error('Invalid site control endpoint')
  }
 }
 return structuredClone(c)
}
/**
 * Read siteOperations from the selected application JSON file.
 * @param root - Application directory used for path resolution.
 * @param config - Config path resolved against root; defaults to eaos.platform.json.
 * @returns The validated site configuration and the configuration file parent directory.
 * @throws Rejects missing/invalid JSON or invalid siteOperations.
 * @remarks Uses ordinary path.resolve; callers must select trusted paths because this loader does not enforce workspace containment.
 * @example
 * import { loadSiteOperations } from '@alneas/eaos-cli/site'
 * export function readSites(root: string) { return loadSiteOperations(root) }
 */
export async function loadSiteOperations(root: string, config = 'eaos.platform.json') {
 const file = resolve(root, config), raw = JSON.parse(await readFile(file, 'utf8'))
 return { config: parseSiteOperationsConfig(raw.siteOperations), root: dirname(file) }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function profile(config: SiteOperationsConfig, id: string) {
 const s = config.sites.find(v => v.id === id)
 if (!s) throw Error('Unknown registered site')
 return s
}
/**
 * Resolve registered local site/Bun paths and verify the named package scripts are declared.
 * @param config - Validated site catalog with a Bun path and local directory.
 * @param id - Exact registered site identifier.
 * @returns Real directory/executable paths, selected build/preview scripts and the package manifest hash.
 * @throws Rejects unknown/missing local bindings, absent package scripts or filesystem/JSON errors.
 * @remarks Resolves the executable path but does not check its file type or execution permissions. It does not execute scripts or verify their safety; their contents are trusted project code.
 * @example
 * import { checkLocalSite } from '@alneas/eaos-cli/site'
 * export function inspectSite(config: Parameters<typeof checkLocalSite>[0], id: string) { return checkLocalSite(config, id) }
 */
export async function checkLocalSite(config: SiteOperationsConfig, id: string) {
 const s = profile(config, id)
 if (!s.directory || !config.bunPath) throw Error('Local directory and bunPath are not registered')
 const directory = await realpath(s.directory), executable = await realpath(config.bunPath)
 const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
 const buildScript = s.buildScript ?? 'build', previewScript = s.previewScript ?? 'dev'
 for (const script of [buildScript, previewScript]) if (typeof pkg.scripts?.[script] !== 'string') throw Error('Registered site script is missing')
 return { site: s, directory, executable, buildScript, previewScript, packageHash: hash(JSON.stringify(pkg)) }
}
/**
 * Cancellation, snapshot and duration controls for one registered local site run.
 * @see {@link runLocalSite} for the canonical usage example and runtime requirements.
 */
export interface LocalSiteOptions { 
    /**
   * Optional snapshot file; must match the registered site and contain a valid revision. Draft snapshots require unexpired preview mode.
   */
  snapshot?: string; 
    /**
   * Run deadline in seconds, from 1 to 7200; defaults to 600 for build and 1800 for preview.
   */
  durationSeconds?: number; 
    /**
   * Optional cancellation signal; abort terminates the owned process group without undoing arbitrary script side effects.
   */
  signal?: AbortSignal; 
    /**
   * Optional synchronous notification invoked once with the loopback preview URL after upstream readiness and proxy binding.
   */
  onReady?: (url: string) => void }
async function environment(s: LocalSiteProfile, options: LocalSiteOptions, preview: boolean) {
 const env: NodeJS.ProcessEnv = {}
 for (const key of new Set(['PATH','HOME','TMPDIR','LANG','SYSTEMROOT',...(s.envKeys ?? [])])) if (process.env[key] !== undefined) env[key] = process.env[key]
 env.EAOS_CMS_SITE_ID = s.cmsSiteId
 let snapshotHash: string | undefined, expiresAt: string | undefined, snapshotBytes: string | undefined
 if (options.snapshot) {
  const file = await realpath(options.snapshot), raw = await readFile(file, 'utf8')
  if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw Error('Snapshot exceeds 8 MiB')
  const dto = JSON.parse(raw)
  if (dto.siteId !== s.cmsSiteId || !Number.isSafeInteger(dto.revision) || dto.revision < 1 || !Array.isArray(dto.posts) || !Array.isArray(dto.assets)) throw Error('Snapshot site/revision differs')
  if ('preview' in dto) {
   if (!preview || !dto.preview || dto.preview.kind !== 'draft' || !Number.isFinite(Date.parse(dto.preview.expiresAt)) || Date.parse(dto.preview.expiresAt) <= Date.now()) throw Error('Draft snapshot is only valid in an unexpired preview')
   expiresAt = dto.preview.expiresAt
  }
  snapshotBytes = raw
  snapshotHash = hash(raw)
 }
 return { env, snapshotHash, expiresAt, snapshotBytes }
}
async function freePort(port: number) {
 await new Promise<void>((ok, fail) => { const server = netServer(); server.once('error', fail); server.listen(port, '127.0.0.1', () => server.close(e => e ? fail(e) : ok())) })
}
/**
 * Immutable outcome and artifact references from a bounded registered site run.
 * @see {@link runLocalSite} for the canonical usage example and runtime requirements.
 */
export interface SiteRunReceipt { 
    /**
   * Unique run UUID used for the private log/receipt directory.
   */
  id: string; 
    /**
   * Registered site key selected for this run.
   */
  siteId: string; 
    /**
   * Whether the registered build or preview script was selected.
   */
  kind: 'build' | 'preview'; 
    /**
   * succeeded for completed build, stopped for a ready preview ended by its deadline/cancellation, otherwise failed.
   */
  outcome: 'succeeded' | 'failed' | 'stopped'; 
    /**
   * UTC ISO timestamp captured when execution begins.
   */
  startedAt: string; 
    /**
   * UTC ISO timestamp captured after process cleanup.
   */
  finishedAt: string; 
    /**
   * SHA-256 of serialized package metadata used to select scripts.
   */
  packageHash: string; 
    /**
   * Optional SHA-256 of the exact staged snapshot bytes.
   */
  snapshotHash?: string; 
    /**
   * Loopback URL included only after the preview becomes ready.
   */
  previewUrl?: string; 
    /**
   * Path to the retained redacted run log; no log content is embedded in this receipt.
   */
  logFile: string }
/**
 * Run a registered site build or bounded loopback preview with logs and an immutable run receipt.
 * @param config - Validated catalog with explicit local Bun/directory bindings.
 * @param id - Registered site identifier.
 * @param kind - build runs its build script; preview starts an expiring local proxy.
 * @param receiptRoot - Directory beneath which .eaos/site-runs stores logs and receipts.
 * @param options - Optional snapshot, AbortSignal, readiness callback and durationSeconds (1–7200); default duration is 600 for build and 1800 for preview.
 * @returns The succeeded build or stopped preview receipt, including hashes and log path.
 * @throws Rejects invalid bindings/snapshots/duration, unavailable ports, failed scripts, output limits or receipt writes; failure logs remain inspectable.
 * @remarks Executes trusted project scripts, not sandboxed code. Aborting/expiry terminates its process group and cleans temporary snapshots; arbitrary script effects are not undone. Captured logs replace exact forwarded environment values only when the variable name contains TOKEN, SECRET, PASSWORD, or KEY; this is not comprehensive credential redaction.
 * @example
 * import { runLocalSite } from '@alneas/eaos-cli/site'
 * export function previewRegistered(config: Parameters<typeof runLocalSite>[0], id: string, receiptRoot: string, signal: AbortSignal) { return runLocalSite(config, id, 'preview', receiptRoot, { signal, durationSeconds: 60 }) }
 */
export async function runLocalSite(config: SiteOperationsConfig, id: string, kind: 'build' | 'preview', receiptRoot: string, options: LocalSiteOptions = {}): Promise<SiteRunReceipt> {
 const local = await checkLocalSite(config, id), vars = await environment(local.site, options, kind === 'preview')
 const duration = options.durationSeconds ?? (kind === 'preview' ? 1800 : 600)
 if (!Number.isInteger(duration) || duration < 1 || duration > 7200) throw Error('Duration must be 1–7200 seconds')
 if (options.signal?.aborted) throw Error('Site operation cancelled')
 const port = local.site.port ?? 4321
 if (kind === 'preview') { await freePort(port); await freePort(port + 1) }
 const runId = randomUUID(), startedAt = new Date().toISOString(), folder = resolve(receiptRoot, '.eaos/site-runs', id, runId)
 await mkdir(folder, { recursive: true, mode: 0o700 })
 const snapshotFile = resolve(folder, 'snapshot.json')
 if (vars.snapshotBytes !== undefined) { await writeFile(snapshotFile, vars.snapshotBytes, { mode: 0o600, flag: 'wx' }); vars.env.EAOS_CMS_SNAPSHOT_FILE = snapshotFile; vars.env.EAOS_CMS_DRAFT_PREVIEW = vars.expiresAt ? 'true' : 'false' }
 let log = '', failure: Error | undefined, ready = false, stopped = false, finished = false
 const args = ['run', kind === 'build' ? local.buildScript : local.previewScript, ...(kind === 'preview' ? ['--host','127.0.0.1','--port',String(port + 1)] : [])]
 // Script content is trusted project code, not an OS sandbox. The CLI itself never runs a shell.
 const child = spawn(local.executable, args, { cwd: local.directory, env: vars.env, stdio: ['ignore','pipe','pipe'], detached: process.platform !== 'win32' })
 let killTimer: ReturnType<typeof setTimeout> | undefined
 const terminate = (signal: NodeJS.Signals) => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal) } catch { /* already stopped */ } }
 const kill = () => { terminate('SIGTERM'); killTimer ??= setTimeout(() => terminate('SIGKILL'), 1500) }
 const abort = () => { stopped = true; kill() }
 options.signal?.addEventListener('abort', abort, { once: true })
 const deadline = Math.min(Date.now() + duration * 1000, vars.expiresAt ? Date.parse(vars.expiresAt) : Infinity)
 const timer = setTimeout(() => { stopped = true; kill() }, Math.max(1, deadline - Date.now()))
 const capture = (data: Buffer) => { log += data.toString(); if (Buffer.byteLength(log) > 2 * 1024 * 1024) { log = log.slice(0, 1024 * 1024); failure = Error('Site output limit exceeded'); kill() } }
 child.stdout.on('data', capture); child.stderr.on('data', capture)
 let proxy: ReturnType<typeof createServer> | undefined, probing = false
 const probe = kind === 'preview' ? setInterval(async () => {
  if (ready || probing || failure || stopped || finished) return
  probing = true
  try {
   const r = await fetch(`http://127.0.0.1:${port + 1}/`, { redirect: 'manual', signal: AbortSignal.timeout(500) })
   await r.body?.cancel()
   if (r.status >= 200 && r.status < 400 && !stopped && !finished) {
    proxy = createServer((req, res) => {
     const origin = `http://127.0.0.1:${port}`
     if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin && req.headers.origin !== origin || Date.now() >= deadline) { res.writeHead(403); res.end(); return }
     const upstream = httpRequest({ hostname: '127.0.0.1', port: port + 1, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port + 1}` } }, reply => {
      res.writeHead(reply.statusCode ?? 502, { ...reply.headers, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' }); reply.pipe(res)
     })
     upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() }); req.pipe(upstream)
    })
    proxy.on('error', () => { failure = Error('Preview proxy unavailable'); kill() })
    await new Promise<void>((ok, fail) => { proxy!.once('error', fail); proxy!.listen(port, '127.0.0.1', ok) })
    if (finished || stopped) { proxy.closeAllConnections(); proxy.close(); return }
    ready = true; options.onReady?.(`http://127.0.0.1:${port}`)
   }
  } catch { /* await registered preview process readiness */ } finally { probing = false }
 }, 100) : undefined
 let code: number | null
 try { code = await new Promise<number | null>((ok, fail) => { child.once('error', () => fail(Error('Registered site program could not start'))); child.once('close', ok) }) }
 catch (error) { failure = error as Error; code = null }
 finally { finished = true; clearTimeout(timer); if (probe) clearInterval(probe); proxy?.closeAllConnections(); proxy?.close(); options.signal?.removeEventListener('abort', abort); terminate('SIGKILL'); if (killTimer) clearTimeout(killTimer); await rm(snapshotFile, { force: true }) }
 for (const [key, value] of Object.entries(vars.env)) if (/TOKEN|SECRET|PASSWORD|KEY/.test(key) && value) log = log.split(value).join('[redacted]')
 const logFile = resolve(folder, `${runId}.log`)
 await writeFile(logFile, log + (failure ? '\n' + failure.message + '\n' : ''), { mode: 0o600, flag: 'wx' })
 const outcome = failure || kind === 'build' && (code !== 0 || stopped) || kind === 'preview' && (!ready || !stopped) ? 'failed' : kind === 'preview' ? 'stopped' : 'succeeded'
 const receipt: SiteRunReceipt = { id: runId, siteId: id, kind, outcome, startedAt, finishedAt: new Date().toISOString(), packageHash: local.packageHash, ...(vars.snapshotHash ? { snapshotHash: vars.snapshotHash } : {}), ...(ready ? { previewUrl: `http://127.0.0.1:${port}` } : {}), logFile }
 await writeFile(resolve(folder, `${runId}.json`), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
 if (outcome === 'failed') throw Error(`Site operation failed; log: ${logFile}`)
 return receipt
}
/**
 * Call an allowlisted site-control route using the registered endpoint and environment-bound token.
 * @param config - Validated site catalog with the remote API binding.
 * @param id - Registered site identifier; site-specific request paths must select this same ID.
 * @param path - Allowed /sites or site request/run path, never an arbitrary remote URL.
 * @param input - Optional JSON request body; omitted input uses GET, otherwise POST.
 * @returns The parsed JSON response from the registered control endpoint.
 * @throws Rejects missing auth bindings, forbidden paths, redirects/network timeout (30 seconds), non-2xx responses, responses over 1 MiB or invalid JSON.
 * @remarks POST may change host state; remote authorization and command semantics remain owned by the control service. No automatic retry is performed.
 * @example
 * import { callSiteControl } from '@alneas/eaos-cli/site'
 * export function listSites(config: Parameters<typeof callSiteControl>[0], id: string) { return callSiteControl(config, id, '/sites') }
 */
export async function callSiteControl(config: SiteOperationsConfig, id: string, path: string, input?: unknown) {
 const s = profile(config, id)
 if (!s.api || !process.env[s.api.tokenEnv]) throw Error('Site control endpoint and authentication binding are required')
 if (!/^\/(?:sites|sites\/[a-zA-Z0-9_-]+\/(?:requests|(?:runs|requests)\/[a-zA-Z0-9_-]+))$/.test(path)) throw Error('Unknown site control operation')
 if (path !== '/sites' && path.split('/')[2] !== id) throw Error('Site control scope differs')
 const response = await fetch(s.api.baseUrl.replace(/\/$/, '') + path, { method: input === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${process.env[s.api.tokenEnv]}`, 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
 if (!response.ok) throw Error(`Site control request failed (${response.status})`)
 const raw = await response.text()
 if (Buffer.byteLength(raw) > 1024 * 1024) throw Error('Site control response exceeds limit')
 return JSON.parse(raw)
}
