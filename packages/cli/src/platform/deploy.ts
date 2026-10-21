import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Reviewed image version, transport and host credentials for a real image deployment.
 * @see {@link deployPlatformImage} for the canonical usage example and runtime requirements.
 */
export interface PlatformImageDeployOptions {
  
    /**
   * Explicit reviewed Kamal configuration filename.
   */
  configFile: string
  
    /**
   * Immutable selected image version; latest and invalid version tokens are rejected.
   */
  version: string
  
    /**
   * Kamal by default; openssh selects the constrained single-host transport.
   */
  transport?: 'kamal' | 'openssh'
  
    /**
   * Trusted command working directory; defaults to process.cwd().
   */
  cwd?: string
  
    /**
   * Subprocess environment; defaults to process.env and may contain real secret bindings.
   */
  env?: NodeJS.ProcessEnv
  
    /**
   * Optional trusted registry server/username/password consumed only by the OpenSSH transport; Kamal uses its own configuration/environment. Never serialize these credentials in a receipt.
   */
  registry?: {
    /** Registry hostname that must exactly match the reviewed Kamal image registry before OpenSSH login. */
  server: string;
    /** Nonempty host registry username passed to Docker login over the OpenSSH transport. */
  username: string;
    /** Nonempty registry secret passed through SSH stdin to docker login --password-stdin; not used by the Kamal transport. */
  password: string }
}
const rubyPlan = `require 'kamal'
require 'json'
c = Kamal::Configuration.create_from(config_file: Pathname.new(ARGV.fetch(0)), version: ARGV.fetch(1))
r = c.primary_role
raise 'Exactly one reviewed host is required' unless r.hosts.length == 1
h = r.hosts.first
raise 'OpenSSH transport does not implement kamal-proxy; use Kamal transport' if r.running_proxy? && ARGV[2] == 'openssh'
raise 'Use Vault host bindings for runtime secrets' if ARGV[2] == 'openssh' && !r.secrets_io(h).read.strip.empty?
raise 'Inline SSH keys/proxies are unsupported; use explicit OpenSSH config' if ARGV[2] == 'openssh' && (c.ssh.key_data || c.ssh.proxy)
serialize = ->(args) { SSHKit::Command.new(*args.flatten.compact).to_command }
l = Kamal::Commands::Lock.new(c)
puts JSON.generate({host:h.to_s, service:c.service, image:c.absolute_image, env_path:r.secrets_path, registry:c.registry.server,
 fixed_port:!r.running_proxy? && !!r.send(:docker_options)['publish'], ssh:c.ssh.ssh_config,
 command:serialize.call(Kamal::Commands::App.new(c,role:r,host:h).run(hostname:"#{h}-platform")),
 lock_ensure:serialize.call([:mkdir,'-p',c.run_directory]),
 lock_acquire:serialize.call(l.acquire('Platform OpenSSH deployment',ARGV.fetch(1))),lock_release:serialize.call(l.release)})`
/**
 * Deploy a reviewed prebuilt image using Kamal or constrained single-host OpenSSH transport.
 * @param options - Explicit configFile and immutable version; optional transport, cwd, environment and registry credentials.
 * @returns Resolves without a value when the selected deployment commands succeed.
 * @throws Rejects invalid versions/configuration, unsupported OpenSSH features, subprocess failures or failed rollback commands.
 * @remarks Executes real Ruby/Kamal/SSH/Docker operations. Fixed-port replacement may stop the prior version and attempt rollback on failure; inspect actual host state before retrying. Does not build/push images, apply DB migrations or activate tenants. Credentials must come from trusted host bindings.
 * @example
 * import { deployPlatformImage } from '@alneas/eaos-cli/platform'
 * export function deployReviewed(options: Parameters<typeof deployPlatformImage>[0]) { return deployPlatformImage(options) }
 */
export async function deployPlatformImage(options: PlatformImageDeployOptions): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  if (!options.configFile || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.version) || options.version === 'latest') throw new Error('Explicit config and immutable version required')
  const env = options.env ?? process.env
  function run(command: string, args: string[], input?: string, capture = false): string {
    const result = spawnSync(command, args, { cwd, env, input, encoding:'utf8', stdio:capture ? ['pipe','pipe','pipe'] : input ? ['pipe','inherit','inherit'] : 'inherit' })
    if (result.error || result.status) throw new Error('Platform operation failed; credential-bearing output omitted')
    return result.stdout ?? ''
  }
  if (options.transport !== 'openssh') {
    // Generate the same plan for fixed-port lifecycle, but use Kamal's supported transport.
    // Proxy/multi-host deployments remain wholly managed by Kamal.
    let plan: any
    try { plan = JSON.parse(run('ruby',['-e',rubyPlan,options.configFile,options.version,options.transport ?? 'kamal'],undefined,true)) } catch { /* Kamal validates configurations unsupported by the OpenSSH fallback. */ }
    const args = ['--config-file',options.configFile,'--skip-hooks']
    let previous: string | undefined
    if (plan?.fixed_port) {
      previous = run('kamal',['app','version',...args,'--quiet'],undefined,true).trim()
      if (previous && !/^[A-Za-z0-9_.-]+$/.test(previous)) throw new Error('Review current fixed-port version before replacement; use OpenSSH transport for first install')
      if (previous) run('kamal',['app','stop',...args])
    }
    try { run('kamal',['deploy',...args,'--version',options.version,'--skip-push']) }
    catch (error) { if (previous) run('kamal',['rollback',previous,...args]); throw error }
    return
  }
  const plan = JSON.parse(run('ruby',['-e',rubyPlan,options.configFile,options.version,options.transport ?? 'kamal'],undefined,true))
  if (!/^[A-Za-z0-9_.-]+$/.test(plan.service) || !/^\.kamal\/apps\/[A-Za-z0-9_/-]+\/env\/roles\/[A-Za-z0-9_-]+\.env$/.test(plan.env_path) || !/^[A-Za-z0-9_.:-]+$/.test(plan.host)) throw new Error('Unexpected host or env path')
  const ssh = plan.ssh
  if (!ssh.user || !ssh.port || !Array.isArray(ssh.keys) || !ssh.keys.length || !Array.isArray(ssh.config) || ssh.config.length !== 1) throw new Error('Explicit SSH user, port, key and config required')
  const sshArgs = ['-F',ssh.config[0],'-l',ssh.user,'-p',String(ssh.port),...ssh.keys.flatMap((key:string)=>['-i',key]),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','ControlMaster=auto','-o','ControlPersist=600','-o',`ControlPath=/tmp/eaos-platform-ssh-%C`]
  const remote = (command:string,capture=false,input?:string) => run('ssh',[...sshArgs,plan.host,command],input,capture)
  remote(plan.lock_ensure); remote(plan.lock_acquire)
  try {
    // Registry credentials are received only in memory and passed over stdin.
    if (options.registry) {
      if (options.registry.server !== plan.registry || !options.registry.username || !options.registry.password) throw new Error('Registry binding mismatch')
      remote('docker login '+quote(options.registry.server)+' --username '+quote(options.registry.username)+' --password-stdin',true,options.registry.password)
    }
    remote(`docker pull ${quote(plan.image)}`)
    if (remote(`docker inspect --format '{{.Config.Labels.service}}' ${quote(plan.image)}`,true).trim() !== plan.service) throw new Error('Image service label mismatch')
    const previous = remote(`docker ps --filter label=service=${plan.service} --filter label=role=web --format '{{.Names}}'`,true).trim().split('\n').filter(Boolean)
    if (previous.length > 1 || previous.some(name=>!name.startsWith(plan.service+'-web-') || !/^[A-Za-z0-9_.-]+$/.test(name))) throw new Error('Unexpected current containers')
    const name = plan.service+'-web-'+options.version
    if (previous[0] === name) {
      if (remote(`docker inspect --format '{{.State.Health.Status}}' ${quote(name)}`,true).trim() !== 'healthy') throw new Error('Current version is not healthy')
      return
    }
    const existing = remote(`docker ps -a --filter name=${quote('^/'+name+'$')} --format '{{.Names}}'`,true).trim()
    if (existing) {
      if (existing !== name || remote(`docker inspect --format '{{.State.Running}} {{.Config.Labels.service}}' ${quote(name)}`,true).trim() !== 'false '+plan.service) throw new Error('Conflicting replacement container')
      remote(`docker rename ${quote(name)} ${quote(name+'-previous-'+Date.now())}`)
    }
    remote(`mkdir -p ${quote(plan.env_path.slice(0,plan.env_path.lastIndexOf('/')))} && install -m 0600 /dev/null ${quote(plan.env_path)}`)
    if (plan.fixed_port && previous[0]) remote(`docker stop ${quote(previous[0])}`)
    try {
      remote(plan.command)
      remote(`for attempt in $(seq 1 45); do status=$(docker inspect --format '{{.State.Health.Status}}' ${quote(name)}); [ "$status" = healthy ] && exit 0; [ "$status" = unhealthy ] && exit 1; sleep 2; done; exit 1`,true)
      if (!plan.fixed_port && previous[0]) remote(`docker stop ${quote(previous[0])}`)
    } catch (error) {
      try { remote(`docker stop ${quote(name)}`) } catch { /* Keep the original error and attempt old-version restoration. */ }
      if (plan.fixed_port && previous[0]) remote(`docker start ${quote(previous[0])}`)
      throw error
    }
  } finally { remote(plan.lock_release) }
}
function quote(value:string):string { return "'"+value.replaceAll("'", "'\\''")+"'" }
