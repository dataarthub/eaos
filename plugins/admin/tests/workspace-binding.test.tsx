import {connection,mount,interact} from '../../tests/workspace-browser'
import {expect,test} from 'bun:test'
import {createWorkspacePages} from '../src/workspace-binding'

test('connected journal executes owner catalog and selected resource event command',async()=>{
 const operations:string[]=[]
 const host=connection('admin',async(input)=>{const operation=String(input).split('/').pop()??'';operations.push(operation);return Response.json(operation==='admin_journal_catalog'?{tenantId:'tenant-a',resources:[{id:'records',label:'Records'}]}:{tenantId:'tenant-a',resourceId:'records',events:[],nextSequence:null})})
 const view=await mount(createWorkspacePages(host.environment)[0].component)
 try{
  expect(operations).toContain('admin_journal_catalog')
  const select=view.container.querySelector<HTMLSelectElement>('select');if(!select)throw Error('Missing resource selection')
  await interact(()=>{select.value='records';select.dispatchEvent(new Event('change',{bubbles:true}))});expect(operations).toContain('admin_journal_events')
 }finally{await view.close()}
})
