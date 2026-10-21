// Subsequent releases only. First registration and account-side trust are maintainer prerequisites.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registry,requiredTags} from './bundle.mjs';
import {assertCompletionContext} from './evidence.mjs';
import {releaseTarget} from './context.mjs';
function parseVersion(value){
 assert.equal(typeof value,'string','Invalid SemVer');
 const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
 assert(match,'Invalid SemVer');const pre=match[4]?.split('.')??[];
 assert(pre.every(part=>!/^\d+$/.test(part)||part==='0'||!part.startsWith('0')),'Invalid numeric prerelease');
 return {numbers:match.slice(1,4).map(BigInt),pre};
}
export function compareVersions(left,right){
 const a=parseVersion(left),b=parseVersion(right);
 for(let i=0;i<3;i++)if(a.numbers[i]!==b.numbers[i])return a.numbers[i]>b.numbers[i]?1:-1;
 if(!a.pre.length||!b.pre.length)return a.pre.length===b.pre.length?0:a.pre.length?-1:1;
 for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++){
  if(a.pre[i]===undefined)return -1;if(b.pre[i]===undefined)return 1;
  const x=a.pre[i],y=b.pre[i];if(x===y)continue;
  const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);
  if(nx&&ny)return BigInt(x)>BigInt(y)?1:-1;
  if(nx!==ny)return nx?-1:1;return x>y?1:-1;
 }
 return 0;
}
export function planTarget(artifact,state){
 parseVersion(artifact.version);
 assert(state?.name===artifact.name&&state.versions&&Object.keys(state.versions).length,'Package must already be publicly registered; first registration or inaccessible state blocks OIDC release');
 assert(state['dist-tags']&&typeof state['dist-tags']==='object','Missing public channel state');
 const tags=requiredTags(artifact.version);
 for(const tag of tags){const current=state['dist-tags'][tag];if(current!==undefined)assert(compareVersions(current,artifact.version)<=0,'Newer npm channel blocks release: '+tag);}
 const existing=state.versions[artifact.version];
 if(existing)assert.equal(existing.dist?.integrity,artifact.integrity,'Existing version integrity differs from reviewed archive');
 return {publish:!existing,tags:tags.filter(tag=>state['dist-tags'][tag]!==artifact.version)};
}
export function assertWriteEnvironment(env,phase='complete'){
 assert.equal(env.GITHUB_ACTIONS,'true','Publication requires GitHub Actions');
 assert.equal(env.GITHUB_REPOSITORY,'dataarthub/eaos','Unexpected publishing repository');
 assert(['stage','complete'].includes(phase),'Invalid release phase');
 assert.equal(env.GITHUB_EVENT_NAME,phase==='stage'?'release':'workflow_dispatch','Release event stages; manual dispatch only completes');
 if(phase==='stage'){const target=releaseTarget((env.GITHUB_REF??'').replace(/^refs\/tags\//,''));assert.equal(env.GITHUB_REF,'refs/tags/'+target.tag);assert.equal(env.GITHUB_WORKFLOW_REF,'dataarthub/eaos/.github/workflows/publish.yml@refs/tags/'+target.tag);}else assertCompletionContext(env);
 assert(env.GITHUB_WORKFLOW_REF?.startsWith('dataarthub/eaos/.github/workflows/publish.yml@'),'Unexpected publishing workflow');
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/,'Missing Actions commit');
 assert(['true','false'].includes(env.RELEASE_REPOSITORY_PRIVATE),'Missing or invalid repository visibility');
 assert(env.ACTIONS_ID_TOKEN_REQUEST_URL&&env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,'Actions OIDC unavailable');
 assert(!env.NODE_AUTH_TOKEN&&!env.NPM_TOKEN&&!env.NPM_CONFIG_TOKEN&&!env.npm_config_token,'Static npm credentials are forbidden');
}
function selectedTargets(manifest) {
 assert(Array.isArray(manifest.targets)&&manifest.targets.length,'Missing reviewed target selection');
 assert(new Set(manifest.targets).size===manifest.targets.length,'Duplicate selected targets');
 return manifest.targets.map(name=>{assert(['core','server','react','cli','plugins'].map(k=>'@alneas/eaos-'+k).includes(name),'Unapproved publication target');const artifact=manifest.artifacts.find(a=>a.name===name);assert(artifact,'Selected target missing archive');return artifact;});
}
export async function executeStage(manifest,{readState,verifyArtifact,write,checkPrerequisite}) {
 const targets=selectedTargets(manifest);
 // Preflight every target and dependent registry prerequisite before the first submission.
 for(const artifact of targets){const plan=planTarget(artifact,await readState(artifact.name));if(plan.publish)await checkPrerequisite(artifact);if(!plan.publish)await verifyArtifact(artifact);}
 for(const artifact of targets){
  let plan=planTarget(artifact,await readState(artifact.name));
  if(plan.publish){
   await checkPrerequisite(artifact);
   plan=planTarget(artifact,await readState(artifact.name));
   if(plan.publish)await write('stage',artifact,'staged');
  }else await verifyArtifact(artifact);
 }
}
export async function executeRelease(manifest,{readState,verifyArtifact,write,checkPrerequisite}) {
 const targets=selectedTargets(manifest);
 // Approval and exact public bytes for ALL targets precede any consumer-channel mutation.
 for(const artifact of targets){
  assert(!planTarget(artifact,await readState(artifact.name)).publish,'Awaiting npm approval/public propagation; completion cannot publish');
  await checkPrerequisite(artifact);
  await verifyArtifact(artifact);
 }
 for(const artifact of targets){
  for(const tag of requiredTags(artifact.version)){
   await checkPrerequisite(artifact);
   const fresh=planTarget(artifact,await readState(artifact.name));
   assert(!fresh.publish,'Approved version disappeared');
   if(fresh.tags.includes(tag))await write('tag',artifact,tag);
  }
  const final=planTarget(artifact,await readState(artifact.name));
  assert(!final.publish&&final.tags.length===0,'Release channels remain incomplete');
 }
}
export function npmWriteArgs(action,artifact,tag,directory,repositoryPrivate){
 if(action==='stage'){
  assert(['true','false'].includes(repositoryPrivate),'Missing or invalid repository visibility');
  return ['stage','publish',join(directory,artifact.archive),'--ignore-scripts',repositoryPrivate==='true'?'--provenance=false':'--provenance','--workspaces=false','--access','public','--tag','staged','--registry='+registry];
 }
 assert.equal(action,'tag','Direct npm publication is forbidden');
 assert(requiredTags(artifact.version).includes(tag),'Unapproved consumer channel');
 return ['dist-tag','add',artifact.name+'@'+artifact.version,tag,'--registry='+registry];
}
export async function waitForApproval(manifest,readState,{now=()=>performance.now(),sleep=delay=>new Promise(resolve=>setTimeout(resolve,delay)),timeout=60_000,interval=10_000}={}){
 const targets=selectedTargets(manifest),deadline=now()+timeout;
 while(now()<deadline){
  let ready=true;
  for(const artifact of targets){
   const remaining=deadline-now();if(remaining<=0)throw Error('Awaiting npm approval/public propagation');
   const plan=planTarget(artifact,await readState(artifact.name,remaining));
   if(plan.publish)ready=false;
  }
  if(ready)return;
  const remaining=deadline-now();if(remaining>0)await sleep(Math.min(interval,remaining));
 }
 throw Error('Awaiting npm approval/public propagation');
}
export function failureState(error){
 const message=String(error?.message??'');
 if(message.includes('Awaiting npm approval'))return 'approval-pending';
 if(message.includes('Newer npm channel'))return 'superseded';
 if(/integrity differs|integrity mismatch|archive differs|SHA-256 mismatch|SHA-512 mismatch/i.test(message))return 'content-mismatch';
 if(/expired/i.test(message))return 'evidence-expired';
 if(message.includes('npm operation failed'))return 'npm-operation-ambiguous';
 return 'evidence-or-prerequisite-blocked';
}
export async function publicJson(path,timeout=30_000){
 const response=await fetch(registry+'/'+path,{redirect:'error',headers:{accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(timeout,30_000))))});
 assert(response.ok,'Public npm metadata unavailable; absence/access must be investigated before release');
 return response.json();
}
export function withNpmConfig(callback,environment=process.env){
 const directory=mkdtempSync(join(tmpdir(),'eaos-release-npm-'));
 const user=join(directory,'user.npmrc'),global=join(directory,'global.npmrc');
 try{
  writeFileSync(user,'',{mode:0o600});writeFileSync(global,'',{mode:0o600});
  return callback({...environment,NPM_CONFIG_USERCONFIG:user,NPM_CONFIG_GLOBALCONFIG:global,NPM_CONFIG_LOGLEVEL:'silent',NPM_CONFIG_LOGS_MAX:'0',NODE_AUTH_TOKEN:'',NPM_TOKEN:''});
 }finally{rmSync(directory,{recursive:true,force:true});}
}
export function npm(args){
 try{return withNpmConfig(env=>execFileSync('npm',args,{encoding:'utf8',stdio:'pipe',env}));}
 catch{throw Error('npm operation failed; stop writes and inspect public registry state read-only before retrying (credential output suppressed)');}
}
