import * as React from 'react'
import {createRoot} from 'react-dom/client'
import {ThemeProvider} from '@alneas/appkit-react/tools/core'
import '@alneas/appkit-react/styles'
import {RecordWorkspace, RecordWorkspaceProvider, type RecordWorkspaceDefinition} from '@alneas/eaos-react/record-workspace'
import type {AiDraftSubmission} from '@alneas/eaos-core/ai/proposal-ui'

const schema={type:'object',properties:{title:{type:'string',title:'Title',minLength:1},commandId:{type:'string'}},required:['title','commandId']}
const definition:RecordWorkspaceDefinition={id:'notes',title:'Notes',listKey:'rows',operations:{list:'list',get:'get',create:'create',update:'update'},schemas:{list:{type:'object',properties:{}},create:schema,update:{properties:{patch:schema}}},columns:[{accessorKey:'title',header:'Title'}],commands:[{operation:'create_note',label:'Create note',schema}]}
async function request(path:string, input?:unknown) {
 const response=await fetch(path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})
 const result=await response.json()
 if(!response.ok)throw Error(result.error??'Fixture request failed')
 return result
}
const client={load:()=>request('/load'),execute:(operation:string,input:Record<string,unknown>)=>operation==='list'?request('/load'):request('/ordinary',{operation,input})}
const draft={mode:'create_note',scope:'notes',riskLevel:2 as const,summary:'Review proposed note',values:{title:'AI suggested title'}}
const mode=new URLSearchParams(location.search).get('mode')==='dark'?'dark':'light'
createRoot(document.getElementById('root')!).render(<ThemeProvider defaultTheme={mode}><RecordWorkspaceProvider tenantId="fixture" recordId="notes" sessionKey="fixture-session" client={client}><RecordWorkspace definition={definition} help={null} aiDraft={draft} reviewAiDraft={(submission:AiDraftSubmission)=>request('/review',submission)}/></RecordWorkspaceProvider></ThemeProvider>)
