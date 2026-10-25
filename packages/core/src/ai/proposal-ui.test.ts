import {test, expect} from 'bun:test'
import {verifyCurrentState} from '@alneas/appkit-core/ai/proposal'
import {convertAiDraftToProposal} from './proposal-ui'
import * as proposalUi from './proposal-ui'
import {canonicalJson} from '../serialization/json'

test('edit proposal retains the real baseline and operator-reviewed values', () => {
 const draft = {mode:'edit',scope:'notes',targetId:'one',baseRevision:2,summary:'Rename',values:{name:'Reviewed'}}
 const proposal = convertAiDraftToProposal(draft,{scope:'notes',targetId:'one',baseVersion:2,currentTitle:'Existing',currentValues:{name:'Old'}})
 expect(proposal.changes.find(change=>change.field==='data')).toMatchObject({field:'data',before:canonicalJson({name:'Old'}),after:canonicalJson({name:'Reviewed'}),reason:'AI draft proposal values'})
 expect(verifyCurrentState({title:'Existing',data:canonicalJson({name:'Old'})},2,proposal,{title:'accepted',data:'accepted'}).ok).toBe(true)
})

test('conversion rejects stale, foreign and unbound edits rather than replacing host scope', () => {
 const draft = {mode:'edit',scope:'notes',targetId:'one',baseRevision:2,values:{name:'New'}}
 for (const change of [{scope:'other'},{targetId:'two'},{baseVersion:3}]) {
  expect(()=>convertAiDraftToProposal(draft,{scope:'notes',targetId:'one',baseVersion:2,currentValues:{name:'Old'},...change})).toThrow()
 }
 expect(()=>convertAiDraftToProposal(draft,{scope:'notes',targetId:'one',baseVersion:2})).toThrow()
})

test('proposal rejects values that JSON would silently corrupt', () => {
 for (const value of [NaN,Infinity,undefined]) {
  expect(()=>convertAiDraftToProposal({mode:'create',values:{amount:value}},{scope:'notes',targetId:'new'})).toThrow()
 }
})

test('submission prepares an Appkit review envelope from the exact edited structured command', () => {
 const values={id:'one',revision:2,patch:{title:'Reviewed',lines:[{amount:100}]}}
 const submission=proposalUi.prepareAiDraftSubmission({mode:'edit',scope:'notes',targetId:'one',baseRevision:2,values},{scope:'notes',operation:'update',targetId:'one',baseVersion:2,currentValues:{title:'Old'},target:{type:'notes',id:'one',revision:2}})
 expect(submission).toMatchObject({scope:'notes',operation:'update',input:values,target:{type:'notes',id:'one',revision:2}})
 expect(JSON.parse(submission.proposal.changes.find(change=>change.field==='data')!.after as string)).toEqual(values)
 values.patch.title='Mutated later'
 expect((submission.input.patch as {title:string}).title).toBe('Reviewed')
})

test('submission cannot bind a prepared proposal to a different resource or source version',()=>{
 const draft={mode:'edit',scope:'notes',targetId:'one',baseRevision:2,values:{title:'New'}}
 for(const target of [{type:'other',id:'one',revision:2},{type:'notes',id:'other',revision:2},{type:'notes',id:'one',revision:3}]){
  expect(()=>proposalUi.prepareAiDraftSubmission(draft,{scope:'notes',operation:'update',targetId:'one',baseVersion:2,currentValues:{title:'Old'},target})).toThrow(/target|revision/i)
 }
})
