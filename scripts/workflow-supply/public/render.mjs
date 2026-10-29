import assert from 'node:assert/strict';
export const roles={source:{file:'ci.yml',name:'Source quality'},quality:{file:'package-quality.yml',name:'Shared package quality'},publish:{file:'publish.yml',name:'Publish npm packages'},complete:{file:'complete-approved.yml',name:'Complete approved npm release'},record:{file:'record-npm-deployments.yml',name:'Record npm deployments'}};
// YAML's JSON-compatible scalar syntax avoids expression and multiline quoting ambiguities.
export function yaml(value,depth=0){
 const pad=' '.repeat(depth),scalar=v=>v===null?'null':typeof v==='string'?JSON.stringify(v):String(v);
 if(Array.isArray(value))return value.length?value.map(v=>v&&typeof v==='object'?pad+'-\n'+yaml(v,depth+2):pad+'- '+scalar(v)+'\n').join(''):pad+'[]\n';
 if(value&&typeof value==='object')return Object.entries(value).map(([k,v])=>{
  const key=/^[A-Za-z_][\w-]*$/.test(k)?k:JSON.stringify(k);
  if(v&&typeof v==='object'&&Object.keys(v).length)return pad+key+':\n'+yaml(v,depth+2);
  if(v&&typeof v==='object')return pad+key+': '+(Array.isArray(v)?'[]':'{}')+'\n';
  if(typeof v==='string'&&v.includes('\n'))return pad+key+': |\n'+v.trimEnd().split('\n').map(l=>' '.repeat(depth+2)+l+'\n').join('');
  return pad+key+': '+scalar(v)+'\n';
 }).join('');
 return pad+scalar(value)+'\n';
}
const expr=s=>'${{ '+s+' }}';
const main="success() && github.event_name == 'push' && github.ref == 'refs/heads/main'";
const sourceArtifactName='source-evidence-node${{ matrix.node }}-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}';
const recordable=main+" || success() && github.event_name == 'pull_request' && github.event.pull_request.draft == false && github.event.pull_request.base.ref == 'main' && github.event.pull_request.head.repo.full_name == github.repository";
function guardJobs(jobs,{source=false}={}){
 for(const [id,job] of Object.entries(jobs)){
  const saves=[];
  assert(job&&Array.isArray(job.steps)&&job.steps.length,'Each project job needs concrete steps');
  if(source){assert(!job.steps.some(s=>s.uses?.startsWith('actions/upload-artifact@')&&s.with?.name===sourceArtifactName),'Project upload collides with managed source evidence');assert(!Object.values(job.permissions??{}).includes('write'),'Source jobs cannot write');assert(!job.if,'Required source runtime jobs cannot be skipped');}
  if(source){assert(job['continue-on-error']===undefined||job['continue-on-error']===false,'Required source runtime failure cannot be ignored');const matrix=job.strategy?.matrix;assert(!matrix?.exclude?.length&&!matrix?.include?.length,'Required source runtime matrix cannot alter declared coverage with include/exclude');for(const step of job.steps)assert(step['continue-on-error']===undefined||step['continue-on-error']===false,'Required source step failure cannot be ignored');}
  for(const s of job.steps){
   if(s.uses?.startsWith('actions/checkout@')){s.uses='actions/checkout@v6';s.with={...s.with,'persist-credentials':false,...(source?{'fetch-depth':0}:{})};}
   if(s.uses?.startsWith('actions/setup-node@')){s.uses='actions/setup-node@v6';s.with={...s.with,'package-manager-cache':false};}
   if(s.uses?.startsWith('actions/cache@')){
    // A combined restore/save action cannot express the main-only success writer contract.
    s.uses=s.uses.replace('actions/cache@','actions/cache/restore@');
    if(!s.id)s.id='shared-cache-'+job.steps.indexOf(s);
    saves.push({name:'Shared: Save successful download/task cache',if:expr(main+" && steps."+s.id+".outputs.cache-hit != 'true'"),uses:'actions/cache/save@v4',with:{path:s.with.path,key:expr('steps.'+s.id+'.outputs.cache-primary-key')}});
   }
   if(s.uses?.startsWith('actions/cache/save@'))s.if=expr(main+(s.if?' && ('+s.if.replace(/^\$\{\{\s*|\s*\}\}$/g,'')+')':''));
   const label=s.uses?'Shared':'Project';s.name=(s.name??s.uses??'Run declared project check').replace(/^(Shared|Project):\s*/, '');s.name=label+': '+s.name;
  }
  job.steps.push(...saves);
  if(source){
   job.name='Verify packages (Node ${{ matrix.node }})';
   job.steps.push({name:'Shared: Record authoritative source evidence',if:expr(recordable),env:{PUBLIC_SOURCE_NODE:'${{ matrix.node }}'},run:'node scripts/workflow-supply/public/quality.mjs record'}, {name:'Shared: Preserve source evidence',if:expr(recordable),uses:'actions/upload-artifact@v7',with:{name:sourceArtifactName,path:'.cache/public-quality/source.json','include-hidden-files':true,'if-no-files-found':'error','retention-days':14}});
   const first=job.steps.findIndex(s=>s.uses?.startsWith('actions/checkout@'));
   assert(first>=0,'Source quality must check out source');
   // The project controls toolchain setup; verify the bundle before its first command.
   const before=job.steps.findIndex((s,i)=>i>first&&s.run);
   job.steps.splice(before<0?first+1:before,0,{name:'Shared: Verify generated workflow supply',run:'node scripts/workflow-supply/public/conformance.mjs check --project-root . --configuration-only'});
  }
  job['timeout-minutes']??=35;
 }
}
function guardRelease(jobs,repository,recovery){
 assert.deepEqual(Object.keys(jobs).sort(),['complete','resolve','stage','verify'],'Uncatalogued npm writer jobs are forbidden');
 for(const id of ['verify','stage','resolve','complete'])assert(jobs[id],'Missing npm phase '+id);
 assert(!Object.values(jobs.verify.permissions??{}).includes('write'),'Release verification must be unprivileged');
 const original=jobs.verify.if;assert(original&&/tag_name/.test(original),'Project release target guard is required');
 jobs.verify.if=`github.event_name == 'release' && github.repository == '${repository}' && github.event.release.draft == false && github.event.release.prerelease == false && (${original})`;
 jobs.resolve.if=`github.event_name == 'workflow_dispatch' && github.repository == '${repository}' && github.ref == 'refs/heads/main'`;
 if(recovery){
  assert(Array.isArray(recovery.candidates)&&recovery.candidates.length>0&&recovery.candidates.length<=10&&new Set(recovery.candidates).size===recovery.candidates.length&&recovery.candidates.every(c=>/^[a-z][a-z0-9.-]{0,63}$/.test(c)),'Invalid recovery candidates');
  jobs.verify.if=`(${jobs.verify.if}) || (github.event_name == 'workflow_dispatch' && github.repository == '${repository}' && github.ref == 'refs/heads/main' && inputs.recover_release != '' && inputs.staged_run == '')`;
  jobs.resolve.if+=` && inputs.recover_release == '' && inputs.staged_run != ''`;
 }

 for(const id of ['stage','complete']){
  const job=jobs[id];assert.equal(job.needs,id==='stage'?'verify':'resolve','Npm phases must retain verification/resolve dependencies');
  assert.equal(job.permissions?.['id-token'],'write','Registry writer needs scoped OIDC');
  assert(job.steps.some(s=>s.uses?.startsWith('actions/download-artifact@')&&s.with?.['artifact-ids']&&s.with?.['digest-mismatch']==='error'),'Npm phase requires immutable artifact ID/digest');
  if(id==='complete')assert(job.steps.some(s=>s.uses?.startsWith('actions/download-artifact@')&&s.with?.['run-id']),'Completion requires original producer run');
  for(const s of job.steps)assert(!/\b(?:bun (?:run|install|build)|npm (?:publish|stage publish|ci|pack))\b/.test(s.run??''),'Registry jobs cannot build, test or directly publish');
 }
 assert(jobs.verify.steps.some(s=>s.uses?.startsWith('actions/upload-artifact@')&&s.with?.['if-no-files-found']==='error'),'Verified archives must be preserved');
 guardJobs(jobs);
}
export function render(adapter,project){
 const a=adapter,p=structuredClone(project);assert(p.source?.jobs?.verify&&p.publish?.jobs,'Missing owned source/publish fragments');
 guardJobs(p.source.jobs,{source:true});guardRelease(p.publish.jobs,a.repository,p.publish.recovery);
 const result=new Map(),add=(role,body)=>result.set('.github/workflows/'+roles[role].file,yaml({name:roles[role].name,...body}));
 const permissions={contents:'read',actions:'read'};
 const full="(github.event_name != 'pull_request' || github.event.pull_request.draft == false) && (github.event_name != 'workflow_dispatch' || inputs.verification_mode == '' || inputs.verification_mode == 'full')";
 const dispatch={...p.source.dispatch,inputs:{...p.source.dispatch?.inputs,verification_mode:{description:'Full project verification or bounded policy diagnostics (never official source evidence)',type:'choice',required:true,default:'full',options:['full','conformance','negative']}}};
 const install=p.source.jobs.verify.steps.find(step=>/^bun install /.test(step.run??''))?.run??'bun install --frozen-lockfile --ignore-scripts';
 const diagnostics={name:'Verify policy (Node ${{ matrix.node }})',if:expr("github.event_name == 'workflow_dispatch' && (inputs.verification_mode == 'conformance' || inputs.verification_mode == 'negative')"),'runs-on':'ubuntu-latest','timeout-minutes':15,permissions,strategy:{'fail-fast':false,matrix:{node:[24,26]}},steps:[
  {name:'Shared: Check out selected public commit',uses:'actions/checkout@v6',with:{'fetch-depth':0,'persist-credentials':false}},
  {name:'Shared: Set up conformance runtime',uses:'actions/setup-node@v6',with:{'node-version':'${{ matrix.node }}','package-manager-cache':false}},
  {name:'Shared: Set up pinned Bun',uses:'oven-sh/setup-bun@v2',with:{'bun-version':a.runtime.bunVersion}},
  {name:'Shared: Verify pinned supply before installation',run:'node scripts/workflow-supply/public/conformance.mjs check --project-root . --configuration-only'},
  {name:'Project: Restore declared dependencies',run:install},
  {name:'Project: Prepare pinned policy tools',run:'bun run '+(p.conformance?.toolSetup??'secrets:setup')},
  {name:'Shared: Required policy gate',id:'required-policy-gate',env:{POLICY_DIAGNOSTIC_MODE:'${{ inputs.verification_mode }}'},run:'node scripts/workflow-supply/public/policy-ci.mjs'},
  {name:'Shared: Downstream success sentinel',id:'downstream-sentinel',run:'node -e "console.log(\'Required gate passed; downstream reached\')"'},
  {name:'Shared: Preserve bounded policy diagnostics',if:'${{ always() }}',uses:'actions/upload-artifact@v7',with:{name:'policy-diagnostics-node${{ matrix.node }}-${{ github.run_id }}-${{ github.run_attempt }}',path:'.verification/policy-ci.json','include-hidden-files':true,'if-no-files-found':'warn','retention-days':14}}
 ]};
 add('source',{'run-name':expr("github.event_name == 'workflow_dispatch' && inputs.verification_mode != 'full' && format('Policy {0} ({1})', inputs.verification_mode, github.ref_name) || 'Source quality'"),on:{push:{branches:['main']},pull_request:{types:['opened','synchronize','reopened','ready_for_review']},merge_group:{types:['checks_requested']},workflow_dispatch:dispatch},permissions,concurrency:{group:expr("github.event_name == 'workflow_dispatch' && (inputs.verification_mode == 'conformance' || inputs.verification_mode == 'negative') && format('policy-diagnostics-{0}-{1}', inputs.verification_mode, github.ref) || format('source-quality-{0}', github.event.pull_request.number || github.ref)"),'cancel-in-progress':true},jobs:{verify:{if:expr(full),uses:'./.github/workflows/package-quality.yml',...(p.source.dispatch?{with:{packed_consumer:expr('inputs.packed_consumer == true')}}:{})},conformance:diagnostics}});
 add('quality',{on:{workflow_call:{...(p.source.dispatch?{inputs:{packed_consumer:{type:'boolean',default:false}}}:{})}},permissions,jobs:p.source.jobs});
 add('publish',{...(p.publish['run-name']?{'run-name':p.publish['run-name']}:{}),on:{release:{types:['published']},workflow_dispatch:{inputs:{staged_run:{description:'Original successful staging run ID after human npm approval',required:!p.publish.recovery,type:'string'},...(p.publish.recovery?{recover_release:{description:'Reviewed fixed candidate whose original run stopped before archive creation or staging',type:'choice',required:false,default:'',options:['',...p.publish.recovery.candidates]}}:{})}}},permissions:{contents:'read'},...(p.publish.env?{env:p.publish.env}:{}),concurrency:{group:a.repository.split('/')[1]+'-npm-release','cancel-in-progress':false},jobs:p.publish.jobs});
 if(p.complete){guardJobs(p.complete.jobs);for(const job of Object.values(p.complete.jobs)){
  assert(!job.permissions?.['id-token'],'Approval observer cannot request OIDC');
  for(const s of job.steps){assert(!/npm (?:publish|stage|install)|bun (?:run|install)/.test(s.run??''),'Observer must only observe/dispatch');if(s.uses?.startsWith('actions/checkout@'))s.with={...s.with,ref:'main'};}
 }
 add('complete',{on:{workflow_run:{workflows:['Publish npm packages'],types:['completed']}},permissions:{contents:'read'},concurrency:{group:'npm-approval-${{ github.event.workflow_run.id }}','cancel-in-progress':false},jobs:p.complete.jobs});}
 if(p.record){assert.deepEqual(Object.keys(p.record.on),['workflow_dispatch'],'Deployment recovery is manual only');guardJobs(p.record.jobs);add('record',{...p.record,on:p.record.on});}
 return result;
}
