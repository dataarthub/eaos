import test from 'node:test';
import assert from 'node:assert/strict';
import {policyUnits,validateCatalog} from './policy-catalog.mjs';
const policy='# Policy\n\n## Boundaries\n\nPublic must not import private source.\n\n- Keep raw logs private.\n\n## Tools\n\n| Purpose | Tool | Contract |\n| --- | --- | --- |\n| Lint | Biome | Read-only lint must fail on defects. |\n';
const catalog=()=>({schemaVersion:1,clauses:policyUnits(policy).map(u=>({id:u.id,sourceHash:u.hash,level:'required',verification:{mode:'manual',reason:'No observed behavioral proof yet'}}))});
test('coverage includes every paragraph, list item and tool contract, not only headings',()=>{assert.equal(policyUnits(policy).length,3);assert.doesNotThrow(()=>validateCatalog(catalog(),policy));});
test('a new or changed policy clause invalidates coverage until explicitly reviewed',()=>{assert.throws(()=>validateCatalog(catalog(),policy+'\nA new mandatory condition.\n'),/coverage/);assert.throws(()=>validateCatalog(catalog(),policy.replace('raw logs','all operational receipts')),/coverage/);});
test('duplicate IDs and unverified requirements without a reason cannot masquerade as coverage',()=>{const c=catalog();c.clauses.push(c.clauses[0]);assert.throws(()=>validateCatalog(c,policy),/Duplicate/);const b=catalog();delete b.clauses[0].verification.reason;assert.throws(()=>validateCatalog(b,policy),/reason/);});
test('line wrapping alone does not invalidate a reviewed clause',()=>{assert.deepEqual(policyUnits(policy).map(u=>u.hash),policyUnits(policy.replace('Public must not import private source.','Public must not import\nprivate source.')).map(u=>u.hash));});
