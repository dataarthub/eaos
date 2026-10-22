import assert from 'node:assert/strict';
import {readFileSync,existsSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {runTask,executionIdentity} from './quality.mjs';
import {pathToFileURL} from 'node:url';
import {load,check} from './supply.mjs';
import {render} from './render.mjs';
export function checkProject(root){
 const {adapter:a,project:p}=load(root),pkg=JSON.parse(readFileSync(join(root,'package.json'))),scripts=pkg.scripts??{},failures=[];
 const require=(condition,id,message)=>{if(!condition)failures.push({id,message});};
 const catalog=JSON.parse(readFileSync(new URL('requirements.json',import.meta.url)));const supported=new Set(['roles','runtime','generated','entrypoints','behavior-wiring','selector-wiring','reuse-wiring','release','source-evidence','ownership']);for(const requirement of catalog.requirements)if(requirement.level==='required')require(supported.has(requirement.staticCheck),requirement.id,'Required outcome has no implemented checker');
 const drift=check(root);require(!drift.length,'actions.drift','Generated output differs: '+drift.join(', '));
 render(a,p); // Independently enforce shared guards on project-owned fragments.
 require(JSON.stringify(p.source.jobs.verify.strategy?.matrix?.node)===JSON.stringify(a.runtime.nodeVersions),'actions.runtime','Actual matrix differs from declared supported runtimes');
 require(p.source.jobs.verify.steps.some(s=>s.uses?.startsWith('actions/setup-node@')&&s.with?.['node-version']==='${{ matrix.node }}'),'actions.runtime','Actual Node setup is disconnected from the supported runtime matrix');
 require(p.source.jobs.verify.steps.some(s=>s.uses?.startsWith('oven-sh/setup-bun@')&&s.with?.['bun-version']===a.runtime.bunVersion),'actions.runtime','Source setup must use declared pinned Bun');
 for(const name of ['quality:commit','quality:push','quality:ci','workflow:generate','workflow:check','test:workflow','conformance:check','conformance:verify'])require(typeof scripts[name]==='string'&&scripts[name].length,'quality.entrypoints','Missing '+name);
 require(/workflow-supply\/public\/supply.mjs check/.test(scripts['workflow:check']??''),'actions.drift','Workflow check is disconnected from the pinned supplier');
 require(!/--write|git\s+(?:add|stash|reset)/.test(scripts['quality:commit']??''),'quality.entrypoints','Commit gate must be read-only');
 const sourceText=JSON.stringify(p.source.jobs.verify.steps);
 require(/bun run (?:quality:ci|verify:push)/.test(sourceText),'quality.entrypoints','CI does not reach the maintained local gate');
 require(/workflow-supply\/public\/quality.mjs/.test(scripts['quality:push']??'')||/scripts\/workflow-adapter.mjs source/.test(scripts['quality:push']??''),'quality.selection','Push gate does not use the maintained selector adapter');
 const behavior=p.conformance?.behaviorCommands;
 require(Array.isArray(behavior)&&behavior.length>0,'quality.failure','Project behavior probes are not connected');
 for(const command of behavior??[])require(Array.isArray(command)&&command[0]==='bun'&&command[1]==='run'&&Object.hasOwn(scripts,command[2]),'quality.failure','Missing maintained behavior probe');
 for(const phase of ['verify','stage','complete']){require(p.publish.jobs[phase].steps.some(s=>s.run==='node scripts/workflow-supply/public/quality.mjs require-source'),'release.source','Exact source evidence missing from '+phase);require(p.publish.jobs[phase].permissions?.actions==='read','release.source','Source artifact read permission missing from '+phase);}
 const guide=join(root,'docs/workflow-supply.md');require(existsSync(guide),'ownership.visibility','Owning CI guide missing');if(existsSync(guide)){const text=readFileSync(guide,'utf8');for(const heading of ['Shared workflow contract','Project-specific verification'])require(text.includes(heading),'ownership.visibility','Missing '+heading);}
 return {schemaVersion:1,repository:a.repository,configuration:failures.length?'failed':'verified',failures,behavior:'not-run',github:'unverified'};
}
export function changedInputs(root,{base}={}){
 try{const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'});if(!base){try{base=git(['merge-base','HEAD','refs/remotes/origin/main']).trim();}catch{base='HEAD';}}
 const changed=git(['diff','--name-only','--no-renames','-z',base,'--']).split('\0').filter(Boolean);changed.push(...git(['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean));return [...new Set(changed)];
 }catch{return null;}
}
export function selectedProbes(project,changed){
 const commands=project.conformance.behaviorCommands;
 if(changed===null)return {shared:true,commands,omitted:[],reason:'No usable comparison; conservative conformance probes'};
 const shared=changed.some(f=>/^(?:scripts\/(?:workflow-supply\/|workflow-project\/|workflow-adapter\.)|\.github\/|package.json$|bun.lock$)/.test(f));
 const selected=commands.filter(command=>shared||changed.some(f=>(project.conformance.probeInputs?.[command[2]]??[]).some(prefix=>f.startsWith(prefix))));
 return {shared,commands:selected,omitted:commands.filter(c=>!selected.includes(c)),reason:'Conformance probes selected from changed governance inputs'};
}
export async function verifyProject(root,{run=spawnSync,changedPaths,base}={}){
 const report=checkProject(root);assert.equal(report.failures.length,0,JSON.stringify(report.failures));const {project}=load(root);
 const selected=selectedProbes(project,changedPaths===undefined?changedInputs(root,{base}):changedPaths);
 const scripts=JSON.parse(readFileSync(join(root,'package.json'))).scripts;const sharedCovered=selected.commands.some(argv=>(scripts[argv[2]]??'').includes('bun run test:workflow'));
 const commands=[...(selected.shared&&!sharedCovered?[['bun','run','test:workflow']]:[]),...selected.commands],identity=executionIdentity(root),outcomes=[];
 for(const argv of commands){const id='conformance-'+argv[2].replaceAll(':','-');outcomes.push(await runTask(root,{id,command:argv},{identity,run:command=>{const result=run(command[0],command.slice(1),{cwd:root,stdio:'inherit'});if(result.error)throw result.error;assert.equal(result.status,0,'Conformance behavior probe failed: '+command.join(' '));}}));}
 return {...report,behavior:commands.length?'verified-local-fixtures':'not-required-for-selected-inputs',selection:selected.reason,outcomes,probes:commands.map(argv=>argv.join(' ')),omitted:selected.omitted.map(argv=>argv.join(' ')),github:'unverified'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const mode=process.argv[2],i=process.argv.indexOf('--project-root'),root=resolve(i<0?'.':process.argv[i+1]);assert(['check','verify'].includes(mode),'Use check or verify');const b=process.argv.indexOf('--base');const report=mode==='verify'?await verifyProject(root,{base:b<0?undefined:process.argv[b+1]}):checkProject(root);console.log(JSON.stringify(report,null,2));if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Shared policy conformance\n\nConfiguration: ${report.configuration}; behavior: ${report.behavior}; GitHub execution: ${report.github}.\n`);assert(!report.failures.length,'Shared policy conformance failed');}catch(error){console.error(error.message);process.exitCode=1;}}
