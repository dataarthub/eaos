/**
 * Host-owned nonsecret publication mode and approval/trigger requirements; secret fields name bindings rather than contain secrets.
 * 
 * 
 * Host-owned policy; secrets and executable commands are never configuration values.
 * @see parseSitePublicationPolicy for canonical integration usage.
 */
export type SitePublicationPolicy = {
  /**
   * Whether host workflow must obtain approval before publication; parsing does not grant approval.
   */
  requireApproval:boolean;
  /**
   * Operator initiation or CMS-published event; manual mode permits only operator.
   */
  trigger:'operator'|'cms-published'} & (
 | {
  /**
   * Publication integration discriminator selecting its required nonsecret fields.
   */
  mode:'pages-git';
  /**
   * Cloudflare account identifier, exactly 32 lowercase hexadecimal characters; not an access token.
   */
  accountId:string;
  /**
   * Registered Pages project slug, at most 63 lowercase letters/digits/hyphens.
   */
  project:string;
  /**
   * Reviewed Git branch reference without traversal or trailing slash.
   */
  branch:string;
  /**
   * Uppercase host secret-binding name for the deploy hook; never the hook value.
   */
  deployHookSecret:string}
 | {
  /**
   * Publication integration discriminator selecting its required nonsecret fields.
   */
  mode:'github-actions';
  /**
   * Reviewed GitHub owner/repository reference.
   */
  repository:string;
  /**
   * Reviewed workflow basename ending .yml or .yaml.
   */
  workflow:string;
  /**
   * Reviewed Git ref without traversal or trailing slash.
   */
  ref:string;
  /**
   * Uppercase host secret-binding name for the provider token; never the token value.
   */
  tokenSecret:string}
 | {
  /**
   * Publication integration discriminator selecting its required nonsecret fields.
   */
  mode:'artifact';
  /**
   * Registered artifact publication adapter ID, up to 100 letters/digits/underscore/hyphen characters.
   */
  provider:string;
  /**
   * Registered nonsecret artifact publication target ID.
   */
  target:string}
 | {
  /**
   * Publication integration discriminator selecting its required nonsecret fields.
   */
  mode:'manual'}
)
/**
 * Supported publication integration: Pages Git, GitHub Actions, artifact adapter or manual operator flow.
 * 
 * @see parseSitePublicationPolicy for canonical integration usage.
 */
export type SitePublicationMode = SitePublicationPolicy['mode']
/**
 * Validates and clones a nonsecret host publication policy for one supported publication mode.
 * @param value - Untrusted plain policy declaration with explicit mode, approval flag and trigger plus mode-specific references.
 * @returns A structured clone narrowed to SitePublicationPolicy.
 * @throws Error for unknown/extra fields, malformed provider references, invalid secret-reference names or unsupported trigger/mode combinations.
 * 
 * @remarks
 * Secret fields contain uppercase environment/binding names, never actual secret values. Manual publication requires operator trigger. Parsing does not execute publication, grant approval or contact a provider.
 * 
 * @example
 * ```typescript
 * import { parseSitePublicationPolicy } from '@alneas/eaos-server/platform/site-publication';
 * const policy = parseSitePublicationPolicy({ mode: 'manual', requireApproval: true, trigger: 'operator' });
 * ```
 */
export function parseSitePublicationPolicy(value:unknown):SitePublicationPolicy {
 const p=value as SitePublicationPolicy
 const fields:Record<SitePublicationMode,string[]>={'pages-git':['accountId','project','branch','deployHookSecret'],'github-actions':['repository','workflow','ref','tokenSecret'],artifact:['provider','target'],manual:[]}
 if(!p||typeof p!=='object'||Array.isArray(p)||![Object.prototype,null].includes(Object.getPrototypeOf(p))||!Object.hasOwn(fields,p.mode)||typeof p.requireApproval!=='boolean'||!['operator','cms-published'].includes(p.trigger)||Object.keys(p).some(k=>!['mode','requireApproval','trigger',...fields[p.mode]].includes(k)))throw Error('Invalid site publication policy')
 const ref=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/.test(v)&&!v.includes('..')&&!v.endsWith('/')
 const secret=(v:unknown)=>typeof v==='string'&&/^[A-Z_][A-Z0-9_]{0,99}$/.test(v)
 if(p.mode==='pages-git'&&(typeof p.accountId!=='string'||typeof p.project!=='string'||!/^[a-f0-9]{32}$/.test(p.accountId)||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(p.project)||!ref(p.branch)||!secret(p.deployHookSecret)))throw Error('Invalid Pages publication registration')
 if(p.mode==='github-actions'&&(typeof p.repository!=='string'||typeof p.workflow!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.repository)||!/^[A-Za-z0-9_-]+\.ya?ml$/.test(p.workflow)||!ref(p.ref)||!secret(p.tokenSecret)))throw Error('Invalid Actions publication registration')
 if(p.mode==='artifact'&&![p.provider,p.target].every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v)))throw Error('Invalid artifact publication registration')
 if(p.mode==='manual'&&p.trigger!=='operator')throw Error('Manual publication requires operator initiation')
 return structuredClone(p)
}
