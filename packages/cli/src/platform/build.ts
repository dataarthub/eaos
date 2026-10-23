import {spawn} from 'node:child_process'
import {basename,resolve as absolute} from 'node:path'
import {safePath} from './files'

/** Explicit local build inputs; deployment and resource discovery remain Host-owned.
 * @see buildHostRuntime
 */
export interface HostRuntimeBuildOptions {
 /** Project-relative entry or entries, passed to the installed Bun build tool. */
 entry:string|readonly string[]
 /** Project-relative output directory. */
 outdir:string
 /** Immutable release label; latest and unsafe labels are rejected. */
 release:string
 /** Explicit build-time expressions keyed by identifier paths. */
 define?:Readonly<Record<string,string>>
 /** Dependencies deliberately retained as runtime imports by the Host. */
 external?:readonly string[]
 /** Explicit resource staging callbacks; a failure rejects the build result. */
 resources?:readonly ((context:{
  /** Trusted project root. */
  root:string
  /** Validated absolute build output directory. */
  outdir:string
 })=>Promise<void>)[]
}

/** Build a Host runtime locally with literal arguments and a pinned release label.
 * @param projectRoot - Trusted adopting project root.
 * @param options - Entries, output, release, replacements and explicit resource callbacks.
 * @returns Completion after successful compilation and all resource callbacks.
 * @throws Invalid release/path/define declarations, build failure or resource staging failure.
 * @remarks Runs the installed Bun CLI through an argument array without a shell. Opens no deployment, provisioning or migration process; failed output must not be published.
 * @example
 * import {buildHostRuntime} from '@alneas/eaos-cli/platform'
 * export const build=(root:string)=>buildHostRuntime(root,{entry:'src/server.ts',outdir:'dist',release:'candidate-1'})
 */
export async function buildHostRuntime(projectRoot:string,options:HostRuntimeBuildOptions):Promise<void>{
 const root=absolute(projectRoot)
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.release)||options.release==='latest')throw Error('Immutable Host release required')
 const entries=typeof options.entry==='string'?[options.entry]:[...options.entry]
 if(!entries.length)throw Error('Host build entry required')
 if(new Set(entries.map(entry=>basename(entry).replace(/\.[^.]+$/,'.js'))).size!==entries.length)throw Error('Host build entries require distinct output names')
 const paths=await Promise.all(entries.map(entry=>safePath(root,entry))),outdir=await safePath(root,options.outdir)
 const args=['build',...paths,'--target','bun','--outdir',outdir,'--entry-naming','[name].js','--define','EAOS_BUILD_RELEASE='+JSON.stringify(options.release)]
 for(const [key,value] of Object.entries(options.define??{})){
  if(!/^[$A-Za-z_][$A-Za-z0-9_]*(?:\.[$A-Za-z_][$A-Za-z0-9_]*)*$/.test(key)||key==='EAOS_BUILD_RELEASE'||typeof value!=='string')throw Error('Invalid Host build define')
  args.push('--define',key+'='+value)
 }
 for(const external of options.external??[]){if(!external||external.includes('\0'))throw Error('Invalid external dependency');args.push('--external',external)}
 await new Promise<void>((resolve,reject)=>{
  const child=spawn('bun',args,{cwd:root,stdio:'inherit',shell:false})
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Host runtime build failed')))
 })
 for(const stage of options.resources??[])await stage({root,outdir})
}
