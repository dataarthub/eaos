/**
 * Host-supplied registry identity and Pulumi path used while rendering the current Kamal resolver template.
 * @see {@link renderKamalSecretsScript} for the canonical usage example and runtime requirements.
 */
export interface KamalSecretsTemplateOptions {
      /**
   * Explicit registry username, taking precedence over the composed namespace/domain/username.
   */
  defaultRegistryUser?: string
      /**
   * Identity domain used when composing a username; defaults to Default.
   */
  identityDomain?: string
      /**
   * Optional OCI namespace used with username to compose the registry user.
   */
  tenancyNamespace?: string
      /**
   * Optional user name/email used with tenancyNamespace to compose the registry user.
   */
  username?: string
      /**
   * Pulumi stack output name for the registry token; defaults to ocirAuthToken. This selects an output, not an OCI Vault secret ID.
   */
  authTokenSecretName?: string
      /**
   * Pulumi working directory passed as one subprocess argument; defaults to pulumi, matching the generated OCI preset.
   */
  pulumiDir?: string
}

/**
 * Render a Kamal 2 secrets template that resolves host bindings without embedding credential values.
 * @param options - Registry identity and Pulumi directory settings; see KamalSecretsTemplateOptions for defaults.
 * @returns Dotenv template text for .kamal/secrets; rendering performs no credential lookup or filesystem writes.
 * @throws If options contain non-string values, control characters or an invalid token-output name; diagnostics omit supplied values.
 * @remarks Requires Kamal 2.12+ and Node.js 22+ when consumed. Nonempty host environment values take precedence: KAMAL_REGISTRY_USERNAME, KAMAL_REGISTRY_PASSWORD (then OCI_AUTH_TOKEN), ADB_CONNECT_STRING and mandatory ADB_PASSWORD. Resolved values must be nonblank single-line strings without NUL, CR or LF. Registry username can fall back to the supplied identity; token can fall back to the selected Pulumi output, and connection can fall back to bindings.databaseConnection. Pulumi reads are bounded to 30 seconds and 1 MiB each; no update is run. Missing/invalid bindings and failed lookups stop Kamal through its inline secrets extractor. Dollar signs and shell-looking secret content remain data. Database passwords are never guessed or exported from Pulumi by this template. Do not log the resolved secrets or commit them as plaintext.
 * @example
 * import { renderKamalSecretsScript } from '@alneas/eaos-cli/platform'
 * const text = renderKamalSecretsScript({ pulumiDir: 'pulumi' })
 */
export function renderKamalSecretsScript(options: KamalSecretsTemplateOptions = {}): string {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Kamal secrets: invalid options')
  for (const value of [options.defaultRegistryUser, options.identityDomain, options.tenancyNamespace, options.username, options.authTokenSecretName, options.pulumiDir]) {
    if (value !== undefined && (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value))) throw new Error('Kamal secrets: options must be strings without control characters')
  }
  const domain = options.identityDomain ?? 'Default'
  let defaultUser = options.defaultRegistryUser ?? ''

  if (!defaultUser && options.tenancyNamespace && options.username) {
    defaultUser = `${options.tenancyNamespace}/${domain}/${options.username}`
  }

  const pulumiDir = options.pulumiDir ?? 'pulumi'
  const tokenOutput = options.authTokenSecretName ?? 'ocirAuthToken'
  if (!pulumiDir.trim() || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(tokenOutput)) throw new Error('Kamal secrets: invalid Pulumi directory or token-output name')
  // Encode configuration as data so neither the shell nor dotenv interprets its contents.
  const settings = Buffer.from(JSON.stringify({ user: defaultUser, pulumiDir, tokenOutput })).toString('base64')
  // No literal dollars, backslashes, hashes or single quotes in the command body:
  // dotenv performs substitutions before invoking the shell and again on its output.
  const program = [
    'try {',
    `const config = JSON.parse(Buffer.from("${settings}", "base64").toString("utf8"));`,
    'const {execFileSync} = require("node:child_process");',
    // A space in the empty call keeps Kamal's balanced-command regexp from treating () as unmatched.
    'const required = value => { if (typeof value !== "string" || !value.trim( ) || [0,10,13].some(code => value.includes(String.fromCharCode(code)))) throw new Error("Invalid binding"); return value; };',
    'const output = (key, json = false) => { let value = execFileSync("pulumi", ["--cwd", config.pulumiDir, "stack", "output", key, ...(json ? ["--json"] : []), "--show-secrets"], {encoding:"utf8", stdio:["ignore","pipe","ignore"], timeout:30000, maxBuffer:1048576}); if (value.endsWith(String.fromCharCode(10))) value = value.slice(0,-1); if (value.endsWith(String.fromCharCode(13))) value = value.slice(0,-1); return value; };',
    'const values = { ADB_PASSWORD:required(process.env.ADB_PASSWORD), KAMAL_REGISTRY_USERNAME:required(process.env.KAMAL_REGISTRY_USERNAME || config.user), KAMAL_REGISTRY_PASSWORD:required(process.env.KAMAL_REGISTRY_PASSWORD || process.env.OCI_AUTH_TOKEN || output(config.tokenOutput)), ADB_CONNECT_STRING:required(process.env.ADB_CONNECT_STRING || JSON.parse(output("bindings", true)).databaseConnection) };',
    'const dollar = String.fromCharCode(36), slash = String.fromCharCode(92), quote = String.fromCharCode(39);',
    // One escaping layer protects the JSON bundle; the other protects each extracted value.
    'const protect = value => value.split("").map((character,index) => character === dollar && value[index+1] !== String.fromCharCode(40) ? slash+character : character).join("");',
    'const protectedValues = Object.fromEntries(Object.entries(values).map(([key,value]) => [key,protect(value)]));',
    // Keep the intermediate JSON ASCII so Ruby can parse it even under a minimal locale.
    'const json = JSON.stringify(protectedValues).split("").map(character => character.charCodeAt(0) < 128 ? character : slash+"u"+character.charCodeAt(0).toString(16).padStart(4,"0")).join("");',
    'const shellQuoted = quote + json.replaceAll(quote, quote+String.fromCharCode(34)+quote+String.fromCharCode(34)+quote) + quote;',
    'process.stdout.write(protect(shellQuoted));',
    '} catch { process.stderr.write("Kamal secrets: required host binding or Pulumi output unavailable" + String.fromCharCode(10)); process.stdout.write("{}"); process.exitCode = 1; }',
  ].join(' ')

  return `# Kamal 2 secrets resolver (Generated by @alneas/eaos-cli)
# Requires Kamal 2.12+ and Node.js 22+. Keep resolved values out of logs and source control.
# The bundle is shell-quoted JSON consumed by Kamal, never evaluated as a shell command.

EAOS_KAMAL_SECRETS=$(node -e '${program}')
KAMAL_REGISTRY_USERNAME=$(kamal secrets extract KAMAL_REGISTRY_USERNAME $EAOS_KAMAL_SECRETS)
KAMAL_REGISTRY_PASSWORD=$(kamal secrets extract KAMAL_REGISTRY_PASSWORD $EAOS_KAMAL_SECRETS)
ADB_CONNECT_STRING=$(kamal secrets extract ADB_CONNECT_STRING $EAOS_KAMAL_SECRETS)
ADB_PASSWORD=$(kamal secrets extract ADB_PASSWORD $EAOS_KAMAL_SECRETS)
`
}
