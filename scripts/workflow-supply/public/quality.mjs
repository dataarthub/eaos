import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,lstatSync,appendFileSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {load,check} from './supply.mjs';
import {packageImpact} from './impact.mjs';
import {github,sourceRun} from './evidence.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
// Tool-call/session metadata and launcher labels do not change the tested program.
const credentialName=key=>['GITHUB_TOKEN','GH_TOKEN','NODE_AUTH_TOKEN','NPM_TOKEN','NPM_AUTH_TOKEN','BUN_AUTH_TOKEN','DATABASE_URL'].includes(key);
const secretAliases=root=>{if(!existsSync(join(root,'.github/workflow-adapter.json')))return [];const p=load(root).project,names=p.quality?.credentialEnvironment??[];assert(Array.isArray(names)&&names.every(k=>typeof k==='string'&&/^[A-Z][A-Z0-9_]*$/.test(k)),'Invalid credential environment allowlist');return [...names,...Object.entries(p.source.jobs.verify.env??{}).filter(([,v])=>typeof v==='string'&&/\bsecrets\s*(?:\.|\[)/i.test(v)).map(([k])=>k)];};
const taskEnvironment=(env,excluded=[])=>digest(JSON.stringify(Object.entries(env).filter(([key])=>{
 if(credentialName(key)||excluded.includes(key))return false;
 if(key.startsWith('CODEX_')&&!['CODEX_SANDBOX','CODEX_SANDBOX_NETWORK_DISABLED'].includes(key))return false;
 return !/^(?:_|PWD|OLDPWD|SHLVL|PPID|TMPDIR|TMP|TEMP|BUN_RUNTIME_TRANSPILER_CACHE_PATH|TERM|COLORTERM|XPC_FLAGS|XPC_SERVICE_NAME)$/.test(key)&&!/^npm_lifecycle_/.test(key);
}).sort(([a],[b])=>a.localeCompare(b))));

const sourceEnvironment=(env,declared=[],excluded=[])=>{const names=new Set([...declared,'CI','NODE_OPTIONS','NODE_ENV','TZ','LANG','LC_ALL',...Object.keys(env).filter(k=>/^(?:EAOS|APPKIT|SITEKIT|VERIFICATION|PLAYWRIGHT|TURBO)_/.test(k)&&!/(?:TOKEN|SECRET|PASSWORD|API_KEY|CI_IMAGE)/.test(k))]);return [...names].filter(k=>!credentialName(k)&&!excluded.includes(k)).sort().map(k=>[k,env[k]??'']);};
const git=(root,args)=>execFileSync('git',args,{cwd:root,env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))),encoding:'utf8',maxBuffer:64*1024*1024});
export function executionIdentity(root,env=process.env,{bunVersion,environmentNames,credentialNames=secretAliases(root)}={}){const declared=environmentNames??(existsSync(join(root,'.github/workflow-adapter.json'))?Object.keys(load(root).project.source.jobs.verify.env??{}):[]);const bun=bunVersion??execFileSync('bun',['--version'],{encoding:'utf8'}).trim();return {node:process.version,nodeMajor:Number(process.versions.node.split('.')[0]),bun,os:process.platform,arch:process.arch,image:env.GITHUB_ACTIONS==='true'?`${env.ImageOS??''}:${env.ImageVersion??''}`:'local',environment:digest(JSON.stringify(sourceEnvironment(env,declared,credentialNames))),bundle:JSON.parse(readFileSync(join(root,'.github/workflow-supply.json'))).bundleSha256};}
function tree(path){if(!existsSync(path))return null;const s=lstatSync(path);assert(!s.isSymbolicLink(),'Symlink output cannot establish cache success');if(s.isDirectory())return readdirSync(path).sort().map(n=>[n,tree(join(path,n))]);assert(s.isFile());return {executable:Boolean(s.mode&0o111),sha256:digest(readFileSync(path))};}
export function inputHash(root){const names=[...new Set(git(root,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))].sort();return digest(JSON.stringify(names.map(n=>[n,tree(join(root,n))])));}
export function scopeFor(changes,{trusted=false}={}){if(!trusted||!changes.length)return 'full';const inputs=changes.filter(f=>!/^\.changeset\/[^/]+\.md$/.test(f));if(!inputs.length)return 'publication';const guide=f=>/^(?:docs\/.*\.(?:md|mdx)|(?:CONTRIBUTING|AGENTS|RELEASING)\.md)$/.test(f);if(inputs.every(guide))return 'docs';const publisher=f=>/^scripts\/publish\//.test(f)||/^scripts\/release-(?:publish|context|evidence|deployments)(?:\.test)?\.mjs$/.test(f);return inputs.every(f=>guide(f)||publisher(f))?'publication':'full';}
export async function runTask(root,task,{identity,run=(argv)=>{const r=spawnSync(argv[0],argv.slice(1),{cwd:root,stdio:'inherit'});if(r.error)throw r.error;assert.equal(r.status,0,'Project task failed: '+task.id);}}={}){
 assert(/^[a-z][\w-]*$/.test(task.id)&&Array.isArray(task.command)&&task.command.length,'Invalid project task');
 const lock=join(root,'.cache/public-quality/locks',task.id);mkdirSync(resolve(lock,'..'),{recursive:true});try{mkdirSync(lock);}catch(error){if(error.code==='EEXIST')throw Error('Task already running; inspect lock before removing: '+task.id);throw error;}
 try{
 const environment=taskEnvironment(process.env,secretAliases(root));
 const toolIdentity=task.command.some(value=>typeof value==='string'&&value.endsWith('/policy-commit-probe.mjs'))?await (await import('./staged-gate.mjs')).currentTools(root):undefined;
 const hash=inputHash(root),key=digest(JSON.stringify({hash,identity,task,environment,toolIdentity})),file=join(root,'.cache/public-quality/tasks',task.id+'.json');
 const outputs=()=>Object.fromEntries((task.outputs??[]).map(p=>{assert(!relative(root,resolve(root,p)).startsWith('..'));return [p,tree(join(root,p))];}));
 if(task.cache!==false&&existsSync(file)){let cached;try{cached=JSON.parse(readFileSync(file));}catch{cached={};}const actual=outputs();if(cached.status==='passed'&&cached.key===key&&Object.values(actual).every(v=>v!==null)&&JSON.stringify(cached.outputs)===JSON.stringify(actual))return {id:task.id,outcome:'reused',key};}
 // Clear a former success before starting, so failure cannot preserve a valid receipt.
 rmSync(file,{force:true});await run(task.command);assert.equal(inputHash(root),hash,'Source changed while task ran');const produced=outputs();assert(Object.values(produced).every(v=>v!==null),'Declared task outputs missing');mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,JSON.stringify({status:'passed',key,outputs:produced})+'\n');return {id:task.id,outcome:'executed',key};
 }finally{rmSync(lock,{recursive:true,force:true});}
}
export function recordLocal(root,{identity=executionIdentity(root),outputs=[]}={}){
 const snapshot=Object.fromEntries([...new Set(git(root,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))].sort().map(n=>[n,tree(join(root,n))]));
 const value={schemaVersion:1,status:'passed',environment:taskEnvironment(process.env,secretAliases(root)),sha:git(root,['rev-parse','HEAD']).trim(),identity,snapshot,outputs:Object.fromEntries(outputs.map(p=>[p,tree(join(root,p))]))};
 assert(Object.values(value.outputs).every(v=>v!==null),'Local evidence requires outputs');mkdirSync(join(root,'.cache/public-quality'),{recursive:true});writeFileSync(join(root,'.cache/public-quality/local.json'),JSON.stringify(value)+'\n');
}
function localSelection(root,identity,head){
 const file=join(root,'.cache/public-quality/local.json');if(!existsSync(file))return null;
 try{const v=JSON.parse(readFileSync(file));assert(v.schemaVersion===1&&v.status==='passed'&&/^[a-f0-9]{40}$/.test(v.sha));assert.deepEqual(v.identity,identity);assert.equal(v.environment,taskEnvironment(process.env,secretAliases(root)));assert(spawnSync('git',['merge-base','--is-ancestor',v.sha,head],{cwd:root}).status===0);
 for(const [p,hash]of Object.entries(v.outputs))assert.deepEqual(tree(join(root,p)),hash);
 const current=Object.fromEntries(git(root,['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean).map(n=>[n,tree(join(root,n))]));
 const changes=[...new Set([...Object.keys(current),...Object.keys(v.snapshot)])].filter(n=>JSON.stringify(current[n])!==JSON.stringify(v.snapshot[n]));
 return {schemaVersion:1,sha:head,baseline:v.sha,provenance:'local',changes:changes.map(file=>({file,status:!current[file]?'D':!v.snapshot[file]?'A':'M'})),scope:scopeFor(changes,{trusted:true}),reason:'Matching local successful snapshot (not official CI evidence)',identity};
 }catch{return null;}
}
function selectedPackages(root,plan){const {project}=load(root);if(project.quality?.impact)plan.packageImpact=packageImpact(root,project.quality.impact,{trusted:!!plan.baseline,changes:plan.changes??[]});plan.sourceInput=inputHash(root);return plan;}
export async function select(root,{env=process.env,api}={}){
 const {adapter}=load(root),identity=executionIdentity(root,env),head=git(root,['rev-parse','HEAD']).trim();if(env.GITHUB_ACTIONS!=='true'){const local=localSelection(root,identity,head);if(local)return selectedPackages(root,local);}let baseline=null,reason='No trusted compatible source evidence; conservative full verification';
 try{const client=api??github(adapter.repository,{token:env.GITHUB_TOKEN});baseline=await sourceRun({repository:adapter.repository,nodeVersions:adapter.runtime.nodeVersions,identity,head,currentRun:env.GITHUB_RUN_ID,isAncestor:value=>spawnSync('git',['merge-base','--is-ancestor',value,head],{cwd:root}).status===0,...client});}catch{ /* An unavailable API or invalid receipt never authorizes omission. */ }
 const changes=baseline?git(root,['diff','--name-only','--no-renames','-z',baseline.run.head_sha,'--']).split('\0').filter(Boolean):[];
 if(baseline){changes.push(...git(root,['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean));reason='Trusted passing main ancestor with matching execution identity';}
 return selectedPackages(root,{schemaVersion:1,sha:head,baseline:baseline?.run.head_sha??null,provenance:baseline?'main':'none',changes:changes.map(file=>({file})),scope:scopeFor(changes,{trusted:!!baseline}),reason,identity});
}
export async function requireSource(root,{imagePolicy='exact'}={}){const {adapter}=load(root);const head=process.env.PUBLISH_SOURCE_SHA??git(root,['rev-parse','HEAD']).trim();let originalAdapter;try{originalAdapter=JSON.parse(git(root,['show',head+':.github/workflow-adapter.json']));}catch(error){assert(process.env.GITHUB_EVENT_NAME==='workflow_dispatch'&&/^[1-9]\d*$/.test(process.env.STAGED_RUN??''),'Original source contract unavailable');const original=JSON.parse(readFileSync('.verification/resolved-release.json'));assert(original.commit===head&&String(original.runId)===process.env.STAGED_RUN,'Legacy completion requires freshly resolved original staging evidence');console.log('Legacy completion retains its original project evidence contract; no new source reuse claimed');return;}const originalProject=JSON.parse(git(root,['show',head+':'+originalAdapter.project]));const staticEnv=Object.fromEntries(Object.entries(originalProject.source.jobs.verify.env??{}).filter(([,v])=>typeof v==='string'&&!v.includes('${{')));const identity=executionIdentity(root,{...process.env,...staticEnv},{bunVersion:originalAdapter.runtime.bunVersion,environmentNames:Object.keys(originalProject.source.jobs.verify.env??{}),credentialNames:[...(originalProject.quality?.credentialEnvironment??[]),...Object.entries(originalProject.source.jobs.verify.env??{}).filter(([,v])=>typeof v==='string'&&/\bsecrets\s*(?:\.|\[)/i.test(v)).map(([k])=>k)]});identity.bundle=JSON.parse(git(root,['show',head+':.github/workflow-supply.json'])).bundleSha256;const proof=await sourceRun({repository:adapter.repository,nodeVersions:originalAdapter.runtime.nodeVersions,identity,head,exact:true,imagePolicy,...github(adapter.repository)});console.log('Exact-commit authoritative Source quality confirmed');return proof;}
export function sourceImagePolicy(mode,env=process.env){const policy=mode==='authenticate-source'?'authenticate':env.PUBLIC_SOURCE_IMAGE_POLICY??'exact';assert(['exact','authenticate'].includes(policy),'Invalid source image policy');return policy;}
export function recordContext(root,env,repository){
 const tree=git(root,['rev-parse','HEAD^{tree}']).trim();
 if(env.GITHUB_EVENT_NAME==='push'){assert.equal(env.GITHUB_REF,'refs/heads/main','Only main push records authoritative source evidence');return {tree};}
 assert.equal(env.GITHUB_EVENT_NAME,'pull_request','Only main or same-repository Ready PR records source evidence');
 const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')),pr=event.pull_request;
 assert(pr?.draft===false&&pr.base?.ref==='main'&&pr.base?.repo?.full_name===repository&&pr.head?.repo?.full_name===repository,'Only same-repository Ready PR records source evidence');
 assert(Number.isSafeInteger(event.number)&&event.number>0&&env.GITHUB_REF===`refs/pull/${event.number}/merge`,'Ready PR merge ref required');
 assert(/^[a-f0-9]{40}$/.test(pr.base.sha??'')&&/^[a-f0-9]{40}$/.test(pr.head.sha??''),'Ready PR exact base/head required');
 assert.deepEqual(git(root,['show','-s','--format=%P','HEAD']).trim().split(' '),[pr.base.sha,pr.head.sha],'Ready PR actual merge parents differ');
 const workflowSha=git(root,['rev-parse','HEAD']).trim();assert.equal(env.GITHUB_WORKFLOW_SHA,workflowSha,'Ready PR workflow must match actual checkout');return {tree,workflowSha,pr:{number:event.number,base:pr.base.sha,head:pr.head.sha,ready:true}};
}
async function main(){clearHookGitEnvironment();const root=process.cwd(),mode=process.argv[2],{adapter,project}=load(root);assert.deepEqual(check(root),[],'Workflow supply must be fresh');
 if(mode==='record'){rmSync('.cache/public-quality/source.json',{force:true});const context=recordContext(root,process.env,adapter.repository);assert.equal(process.env.GITHUB_REPOSITORY,adapter.repository);assert.equal(process.env.GITHUB_WORKFLOW_REF,adapter.repository+'/.github/workflows/ci.yml@'+process.env.GITHUB_REF);assert(process.env.ImageOS&&process.env.ImageVersion,'Known CI image required for authoritative evidence');const identity=executionIdentity(root),sha=git(root,['rev-parse','HEAD']).trim();assert.equal(sha,process.env.GITHUB_SHA);assert.equal(identity.nodeMajor,Number(process.env.PUBLIC_SOURCE_NODE),'Actual Node runtime differs from matrix');assert(adapter.runtime.nodeVersions.includes(identity.nodeMajor));assert.equal(identity.bun,adapter.runtime.bunVersion,'Actual Bun differs from declared runtime');assert.equal(git(root,['status','--porcelain']).trim(),'','Source verification changed committed inputs');const plan=JSON.parse(readFileSync('.cache/public-quality/plan.json'));assert.equal(plan.sha,sha);assert.deepEqual(plan.identity,identity);assert(Number.isSafeInteger(Number(process.env.GITHUB_RUN_ID))&&Number(process.env.GITHUB_RUN_ID)>0&&Number.isSafeInteger(Number(process.env.GITHUB_RUN_ATTEMPT))&&Number(process.env.GITHUB_RUN_ATTEMPT)>0);mkdirSync('.cache/public-quality',{recursive:true});writeFileSync('.cache/public-quality/source.json',JSON.stringify({schemaVersion:1,repository:adapter.repository,sha,run:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),identity,...context,status:'passed',selection:{scope:plan.scope,baseline:plan.baseline}})+'\n');return;}
 if(['require-source','authenticate-source'].includes(mode)){await requireSource(root,{imagePolicy:sourceImagePolicy(mode)});return;}
 const {checkProject}=await import('./conformance.mjs');assert.equal(checkProject(root).failures.length,0,'Project workflow conformance failed');
 const plan=await select(root);mkdirSync('.cache/public-quality',{recursive:true});writeFileSync('.cache/public-quality/plan.json',JSON.stringify(plan,null,2)+'\n');if(mode==='plan'){if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`scope=${plan.scope}\nbase=${plan.baseline??''}\n`);console.log(JSON.stringify(plan));return;}
 assert(['push','ci'].includes(mode),'Use plan, push, ci, record or require-source');
 const nodeMajor=Number(process.versions.node.split('.')[0]),primary=mode==='push'?nodeMajor:adapter.runtime.nodeVersions[0],quality=project.quality;assert(quality,'Project quality contract missing');
 const outcomes=[];if(process.env.GITHUB_ACTIONS!=='true')rmSync(join(root,'.cache/public-quality/local.json'),{force:true});for(const command of nodeMajor===primary?(quality.always??[]):[]){const r=spawnSync(command[0],command.slice(1),{cwd:root,stdio:'inherit'});assert.equal(r.status,0,'Mandatory safety check failed');}
 for(const task of quality.tasks){const applies=(!task.primaryOnly||nodeMajor===primary)&&(!task.secondaryOnly||nodeMajor!==primary)&&(!task.scopes||task.scopes.includes(plan.scope));if(!applies){outcomes.push({id:task.id,outcome:'out-of-scope'});continue;}outcomes.push(await runTask(root,{...task,selection:plan.packageImpact??null},{identity:plan.identity}));}
 if(process.env.GITHUB_ACTIONS!=='true')recordLocal(root,{identity:plan.identity,outputs:quality.tasks.filter(t=>(!t.primaryOnly||nodeMajor===primary)&&(!t.secondaryOnly||nodeMajor!==primary)).flatMap(t=>t.outputs??[])});
 const report=`### Shared workflow contract\n\n${plan.reason}. Scope: ${plan.scope}; baseline: ${plan.baseline??'none'}.\n\n### Project-specific verification\n\n`+outcomes.map(o=>`- ${o.id}: ${o.outcome}`).join('\n')+'\n';console.log(report);if(plan.packageImpact)console.log(JSON.stringify({packageTests:plan.packageImpact.test,omittedPackageTests:plan.packageImpact.omitted,reason:plan.packageImpact.reason}));if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,report);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});

export async function releaseProof(root,{env=process.env,verify=requireSource}={}){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='release')return null;
 const proof=await verify(root);assert(proof?.run?.head_sha&&proof.receipt?.status==='passed','Official exact-commit proof required for source reuse');return proof;
}

export function readSelectedPlan(root){
 const plan=JSON.parse(readFileSync(join(root,'.cache/public-quality/plan.json')));
 assert.equal(plan.sha,git(root,['rev-parse','HEAD']).trim(),'Selected commit changed');assert.equal(plan.sourceInput,inputHash(root),'Source changed after selection');assert.deepEqual(plan.identity,executionIdentity(root),'Selected runtime changed');
 const {project}=load(root);assert(project.quality?.impact,'Missing project graph contract');assert.deepEqual(plan.packageImpact,packageImpact(root,project.quality.impact,{trusted:!!plan.baseline,changes:plan.changes??[]}), 'Package selection changed');return plan;
}

export function clearHookGitEnvironment(env=process.env){for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];return env;}
