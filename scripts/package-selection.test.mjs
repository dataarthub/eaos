import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {packageImpact,workspaceTestCommands} from './workflow-supply/public/impact.mjs';
const root=resolve(import.meta.dirname,'..'),config={packages:['packages/core','packages/server','packages/react','packages/cli','plugins']};
test('server edits include CLI and plugin consumers without unrelated core or React tests',()=>{const selection=packageImpact(root,config,{trusted:true,changes:['packages/server/src/tenant.ts']});assert.deepEqual(selection.test,['packages/server','packages/cli','plugins']);assert.deepEqual(workspaceTestCommands(selection).map(c=>c[3]),selection.test);});
test('Core edits cover server dependents, including transitively dependent plugin tests',()=>{const selection=packageImpact(root,config,{trusted:true,changes:['packages/core/src/index.ts']});for(const p of ['packages/core','packages/server','packages/cli','plugins'])assert(selection.test.includes(p));});
test('React edits retain peer consumers and omit unrelated server tests',()=>{const selection=packageImpact(root,config,{trusted:true,changes:['packages/react/src/index.ts']});assert(selection.test.includes('packages/react'));assert(selection.test.includes('plugins'));assert(!selection.test.includes('packages/server'));});
test('lockfile, export metadata, build config and absent evidence retain all tests',()=>{for(const file of ['bun.lock','packages/react/package.json','packages/server/tsup.config.ts','scripts/verified-run.mjs','scripts/quality-tools.mjs','scripts/guarded-process.test.mjs'])assert.deepEqual(packageImpact(root,config,{trusted:true,changes:[file]}).test,config.packages);assert.deepEqual(packageImpact(root,config,{trusted:false,changes:['packages/react/src/index.ts']}).test,config.packages);});

import {readFileSync} from 'node:fs';
test('selected source remains guarded while explicit quality remains full',()=>{const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));assert.equal(pkg.scripts['check:selected'],'node scripts/verified-run.mjs quality --selected');assert.equal(pkg.scripts.check,'node scripts/verified-run.mjs quality');});


test('Outbox contract regressions reach the guarded source gate through their owning test scripts',()=>{
 const selection=packageImpact(root,config,{trusted:true,changes:['packages/core/tests/outbox.test.ts','packages/server/src/plugin-data/outbox.test.ts']});
 for(const owner of ['packages/core','packages/server']){
  assert(selection.test.includes(owner));
  assert.match(JSON.parse(readFileSync(new URL('../'+owner+'/package.json',import.meta.url))).scripts.test,/scripts\/run-source-tests\.mjs$/);
 }
});
