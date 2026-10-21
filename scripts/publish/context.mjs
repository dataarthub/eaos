// Stable package Releases select reviewed sources; manual dispatch is completion-only.
import assert from 'node:assert/strict';
import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function releaseTarget(tag) {
 const match=/^eaos-(core|server|react|cli|plugins)-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag??'');
 assert(match&&match[0]===tag,'Expected eaos-{core,server,react,cli,plugins}-vX.Y.Z');
 const kind=match[1];return {kind,name:'@alneas/eaos-'+kind,version:match[2],tag};
}
export function validateReleaseEvent({event,commit,tagCommit,onMain,manifests}) {
 assert(event?.action==='published'&&event.repository?.full_name==='dataarthub/eaos','Only an owning published Release may stage');
 assert(event.release?.draft===false&&event.release?.prerelease===false,'Release must be stable and published');
 assert(Number.isSafeInteger(event.release.id)&&event.release.id>0,'Missing Release identity');
 const target=releaseTarget(event.release.tag_name);
 assert(/^[a-f0-9]{40}$/.test(commit??'')&&commit===tagCommit&&onMain===true,'Release tag must resolve to the reviewed commit on main');
 const meta=manifests[target.kind];
 assert(meta?.name===target.name&&meta.version===target.version,'Release tag and package version differ');
 assert(meta.repository?.url==='git+https://github.com/dataarthub/eaos.git'&&meta.publishConfig?.access==='public'&&meta.publishConfig?.registry==='https://registry.npmjs.org','Unexpected package destination');
 return {...target,commit,releaseId:event.release.id};
}
export function releaseContext({root=resolve(import.meta.dirname,'../..'),env=process.env}={}) {
 assert(env.GITHUB_ACTIONS==='true'&&env.GITHUB_EVENT_NAME==='release'&&env.GITHUB_REPOSITORY==='dataarthub/eaos','Staging requires the owning Release event');
 assert.equal(env.GITHUB_RUN_ATTEMPT,'1','Release reruns cannot rebuild or restage; inspect the original attempt before recovery');
 const event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')),target=releaseTarget(event.release?.tag_name);
 assert.equal(env.GITHUB_REF,'refs/tags/'+target.tag);
 assert.equal(env.GITHUB_WORKFLOW_REF,'dataarthub/eaos/.github/workflows/publish.yml@refs/tags/'+target.tag);
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:10_000}).trim();
 const commit=git(['rev-parse','HEAD']);assert.equal(commit,env.GITHUB_SHA,'Checked-out source differs from Release event');
 return validateReleaseEvent({event,commit,tagCommit:git(['rev-parse','--verify','refs/tags/'+target.tag+'^{commit}']),onMain:spawnSync('git',['merge-base','--is-ancestor',commit,'refs/remotes/origin/main'],{cwd:root}).status===0,manifests:Object.fromEntries(['core','server','react','cli','plugins'].map(kind=>[kind,JSON.parse(readFileSync(resolve(root,kind==='plugins'?'plugins':'packages/'+kind,'package.json'),'utf8'))]))});
}
export function assertReleaseSelection(manifest,selection) {
 const target=releaseTarget(selection.tag??selection.release?.tag);
 const id=selection.releaseId??selection.release?.id;
 assert.deepEqual(manifest.release,{id,tag:target.tag},'Bundle belongs to another Release');
 assert.equal(manifest.commit,selection.commit);assert.deepEqual(manifest.targets,[target.name],'Release selects only its package');
 assert.equal(manifest.artifacts.find(a=>a.name===target.name)?.version,target.version,'Release tag differs from selected archive');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const target=releaseContext();assert(process.env.GITHUB_OUTPUT);appendFileSync(process.env.GITHUB_OUTPUT,`kind=${target.kind}\n`);
}
