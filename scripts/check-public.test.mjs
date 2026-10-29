import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateChangeset} from './check-public.mjs'
const owners=[{name:'@alneas/eaos-core'}]
test('accepts a meaningful maintainer-only no-release record',()=>{
 assert.doesNotThrow(()=>validateChangeset('---\n---\n\nNo release: refresh CI verification evidence without changing distributed APIs or package versions.\n',owners))
})
test('empty targets require explicit meaningful no-release reasoning',()=>{
 for(const body of ['','No release.','This is unrelated text with enough characters to avoid an incidental length check.'])assert.throws(()=>validateChangeset('---\n---\n\n'+body,owners))
})
test('release records retain owner and semantic increment validation',()=>{
 assert.doesNotThrow(()=>validateChangeset('---\n"@alneas/eaos-core": patch\n---\n\nAdopt the published dependency fix and refresh the application lockfile.\n',owners))
 for(const header of ['"unknown": patch','"@alneas/eaos-core": invalid'])assert.throws(()=>validateChangeset('---\n'+header+'\n---\n\nMeaningful consumer release notes remain mandatory for every owner.\n',owners))
})
