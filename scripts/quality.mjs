import { mkdir,writeFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { packages } from './check-public.mjs'
import {failedCheckNames} from './quality-diagnostics.mjs'
import { sourceHash,candidateCommit } from './source-state.mjs'
if(!process.env.EAOS_VERIFICATION_RUN)throw Error('Use bun run check for guarded verification')
const root=resolve(import.meta.dirname,'..')
const before=await sourceHash(root)
const selection=process.argv[2]==='--selected'?JSON.parse(process.argv[3]):null
const checks=['check:public','lint','test:tooling','build','test','docs:check','secrets:check']
await mkdir(join(root,'.verification/logs'),{recursive:true})
const bun=spawnSync('bun',['--version'],{encoding:'utf8'})
if(bun.stdout.trim()!=='1.4.3')throw Error('Use the declared Bun 1.4.3 toolchain')
const sourceProof=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_EVENT_NAME==='release'
  ?await (await import('./workflow-supply/public/quality.mjs')).releaseProof(root):null
const reusedChecks=sourceProof?['lint','test:tooling','test','docs:check']:[]
for(const name of checks) {
  if(reusedChecks.includes(name)){console.log(`Reusing official Source quality ${name}: run ${sourceProof.run.id}, attempt ${sourceProof.run.run_attempt}`);continue}

  console.log(`Verifying ${name}`)
  const commands=name==='test'&&selection?(await import('./workflow-supply/public/impact.mjs')).workspaceTestCommands(selection):[['bun','run',name]]
  let stdout='',stderr='',status=0
  for(const [command,...args]of commands){const child=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=8192'}});stdout+=child.stdout??'';stderr+=child.stderr??'';if(child.error||child.status!==0){status=child.status??1;break}}
  const run={stdout,stderr,status}
  const log=join(root,'.verification/logs',name.replaceAll(':','-')+'.log')
  await writeFile(log,(run.stdout??'')+(run.stderr??''))
  if(run.status!==0) {
    const names=failedCheckNames((run.stdout??'')+'\n'+(run.stderr??''))
    if(names.length)console.error('Failed checks:\n'+names.map(value=>'- '+value).join('\n'))
    throw Error(`${name} failed; inspect .verification/logs/${name.replaceAll(':','-')}.log`)
  }
}
if(await sourceHash(root)!==before)throw Error('Source changed during verification; rerun after edits finish')
const outputs={}
for(const pkg of await packages())outputs[pkg.name]=await sourceHash(join(root,pkg.directory,'dist'),new Set())
await writeFile(join(root,'.verification/quality.json'),JSON.stringify({schemaVersion:1,runId:process.env.EAOS_VERIFICATION_RUN,sourceHash:before,outputs,commit:candidateCommit(root),node:process.version,bun:bun.stdout.trim(),checks,packageSelection:selection,executedChecks:checks.filter(name=>!reusedChecks.includes(name)),reusedChecks,sourceEvidence:sourceProof?{run:sourceProof.run.id,attempt:sourceProof.run.run_attempt,commit:sourceProof.run.head_sha}:null,completedAt:new Date().toISOString()},null,2)+'\n')
if(selection)console.log(JSON.stringify({executedPackageTests:selection.test,omittedPackageTests:selection.omitted}))
console.log('Local quality checks passed; .verification/quality.json binds source and toolchain. Raw logs stay private.')
