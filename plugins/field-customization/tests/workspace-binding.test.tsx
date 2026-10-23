import {connection,mount,submit,requiredForm,interact} from '../../tests/workspace-browser'
import {expect,test} from 'bun:test'
import {createWorkspacePages} from '../src/workspace-binding'

test('connected field editor uses explicit resources and preserves revision on PUT',async()=>{
 const calls:{path:string;method:string;body:unknown}[]=[]
 const host=connection('field-customization',async(input,init)=>{calls.push({path:String(input),method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):undefined});return Response.json({id:'records/demo',revision:5,schema:{type:'object',properties:{name:{type:'string',title:'Name'}}},fields:{}})})
 expect(()=>createWorkspacePages(host.environment,{resources:[]})).toThrow()
 const Page=createWorkspacePages(host.environment,{resources:[{id:'records/demo',label:'Demo'}]})[0].component
 const view=await mount(Page)
 try{
  expect(calls[0].path).toBe('/api/plugins/field-customization/resources/records%2Fdemo')
  await submit(requiredForm(view.container.querySelector('form')))
  expect(calls.find(call=>call.method==='PUT')?.body).toMatchObject({revision:5,fields:{name:{display_label:'Name'}}})
  const selector=view.container.querySelector<HTMLSelectElement>('select[aria-label="対象リソース"]')
  if(!selector)throw Error('Missing explicit resource selector')
  await interact(()=>{const option=document.createElement('option');option.value='untrusted';selector.appendChild(option);selector.value='untrusted';selector.dispatchEvent(new Event('change',{bubbles:true}))})
  expect(calls.some(call=>call.path.includes('untrusted'))).toBe(false)
 }finally{await view.close()}
})
