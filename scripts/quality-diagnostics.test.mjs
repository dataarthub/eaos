import assert from 'node:assert/strict'
import {test} from 'node:test'
import {failedCheckNames} from './quality-diagnostics.mjs'
test('Bun and Node failure names are visible without assertion values or raw output',()=>{
 const log='src/audit.test.ts:\nExpected: "fixture-sensitive-value"\nReceived: "other-value"\n(fail) audit survives restart [2.14ms]\n✖ release bundle remains portable (10ms)\n    at private diagnostic details\n'
 assert.deepEqual(failedCheckNames(log),['audit survives restart','release bundle remains portable'])
 assert.deepEqual(failedCheckNames('(pass) valid check [1ms]\n0 fail\n'),[])
})
test('summaries remove terminal controls, deduplicate and bound failure output',()=>{
 const names=failedCheckNames('\u001b[31m(fail) repeated [1ms]\u001b[0m\n(fail) repeated [2ms]\n'+Array.from({length:20},(_,i)=>'(fail) '+i+'x'.repeat(500)).join('\n'))
 assert.equal(names[0],'repeated')
 assert.equal(names.length,10)
 assert.ok(names.every(name=>name.length<=300))
})

test('runner failures expose fixed categories without assertion values',()=>{
 assert.deepEqual(failedCheckNames('AssertionError [ERR_ASSERTION]: Every selected test file must execute tests\n+ sensitive-path\n- missing-path'),['Source runner: Every selected test file must execute tests'])
 assert.deepEqual(failedCheckNames('Error: sensitive-provider-value'),[])
})
