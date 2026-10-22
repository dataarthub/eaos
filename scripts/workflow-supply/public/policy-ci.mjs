import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync,appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkProject,verifyProject} from './conformance.mjs';
import {runTask,executionIdentity} from './quality.mjs';
import {load} from './supply.mjs';
import {probeCommit} from './policy-commit-probe.mjs';
import {policyReport} from './policy-report.mjs';
const root=process.cwd(),directory=join(root,'.verification');mkdirSync(directory,{recursive:true});
const save=value=>writeFileSync(join(directory,'policy-ci.json'),JSON.stringify(value,null,2)+'\n');
try{
 const configuration=checkProject(root);assert.equal(configuration.failures.length,0,'Critical conformance configuration failed');
 if(process.env.POLICY_DIAGNOSTIC_MODE==='negative'){
  const proof=probeCommit(root,{negative:true});save({mode:'negative',runtime:process.version,proof,authoritative:false});console.log(JSON.stringify(proof));process.exitCode=proof.commandStatus===0?0:1;
 }else{
  assert(!process.env.POLICY_DIAGNOSTIC_MODE||process.env.POLICY_DIAGNOSTIC_MODE==='conformance','Unknown diagnostic mode');
  const {project}=load(root),owned=project.conformance?.selectionTests;assert(Array.isArray(owned)&&owned.length,'Owning package-selection tests must be explicit');
  for(const file of owned)assert(/^scripts\/[\w./-]+\.test\.mjs$/.test(file)&&!file.split('/').includes('..'),'Invalid owning probe');
  const shared=readdirSync(join(root,'scripts/workflow-supply/public')).filter(f=>f.endsWith('.test.mjs')).map(f=>'scripts/workflow-supply/public/'+f);
  const regression=spawnSync(process.execPath,['--test',...shared,...owned],{cwd:root,stdio:'inherit',timeout:300000});assert.equal(regression.status,0,'Shared/owning conformance regressions failed');
  const identity=executionIdentity(root),task={id:'policy-ci-commit',command:[process.execPath,'scripts/workflow-supply/public/policy-commit-probe.mjs']};let commitProof;
  const execute=argv=>{const r=spawnSync(argv[0],argv.slice(1),{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024**2});assert.equal(r.status,0,'Owning commit probe failed');commitProof=JSON.parse(r.stdout);};
  const cold=await runTask(root,task,{identity,run:execute}),warm=await runTask(root,task,{identity,run:execute});assert.equal(warm.outcome,'reused','Identical successful probe was not reused');
  const prose=await verifyProject(root,{changedPaths:['docs/policy-diagnostic-prose.md']});assert.equal(prose.probes.length,0,'Prose selected unrelated probes');
  const audit=policyReport(root,{commitProof});save({mode:'conformance',runtime:process.version,configuration,cold,warm,prose:{probes:prose.probes,omitted:prose.omitted},audit,authoritative:false,omitted:['product builds and tests','browser suites','database services','registry operations']});
  const summary=`Policy diagnostics ${process.version}: configuration verified; shared and owning selector regressions passed; task ${cold.outcome} then ${warm.outcome}; prose probes 0. Full policy remains unverified. No authoritative source evidence produced.\n`;console.log(summary);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
 }
}catch{save({mode:process.env.POLICY_DIAGNOSTIC_MODE??'conformance',runtime:process.version,status:'failed',authoritative:false});console.error('Required policy diagnostics failed; inspect the preceding redacted regression output');process.exitCode=1;}
