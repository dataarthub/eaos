import {connection,mount,submit,requiredForm,interact} from '../../tests/workspace-browser'
import {expect,test} from 'bun:test'
import {createWorkspacePages} from '../src/workspace-binding'

test('connected approval maps submit, decisions and withdrawal with current revisions',async()=>{
 const calls:{path:string;method:string;body:unknown}[]=[]
 const host=connection('approval',async(input,init)=>{calls.push({path:String(input),method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):undefined});return Response.json(init?.method==='GET'?[{id:'request-1',revision:7,value:{templateId:'review',stages:[{id:'review',label:'Review'}],allowSelfApproval:false,currentStage:0,title:'Review',status:'pending',targetType:'document',targetId:'doc-1',requestedBy:'user-a',history:[]}}]:{})})
 const pages=createWorkspacePages(host.environment)
 expect(pages.map(page=>page.path)).toEqual(['/plugins/approval/workspace'])
 const view=await mount(pages[0].component)
 try{
  expect(calls[0].path).toBe('/api/plugins/approval/requests')
  const creation=requiredForm(view.container.querySelector('form'))
  for(const input of creation.querySelectorAll('input'))input.value='sample'
  await submit(creation);await view.settle()
  expect(calls.some(call=>call.method==='POST'&&call.path==='/api/plugins/approval/requests')).toBe(true)
  await submit(requiredForm(view.container.querySelector('article form')));await view.settle()
  expect(calls.find(call=>call.path.endsWith('/decisions'))?.body).toMatchObject({revision:7,action:'approve'})
  const withdraw=[...view.container.querySelectorAll('button')].find(button=>button.textContent==='申請を取り下げ')
  await interact(()=>withdraw?.click());await view.settle()
  expect(calls.find(call=>call.path.endsWith('/withdraw'))?.body).toEqual({revision:7})
 }finally{await view.close()}
})
test('connected approval surfaces conflicts and drops old identity results',async()=>{
 let rejectWrite=false,finish:(response:Response)=>void=()=>{},defer=false
 const host=connection('approval',async(_input,init)=>{if(defer)return new Promise(resolve=>{finish=resolve});return Response.json(init?.method==='GET'?[]:{},{status:rejectWrite?409:200})})
 const Page=createWorkspacePages(host.environment)[0].component,view=await mount(Page)
 try{
  rejectWrite=true;const form=requiredForm(view.container.querySelector('form'));for(const input of form.querySelectorAll('input'))input.value='sample';await submit(form);expect(view.container.querySelector('[role="alert"]')).not.toBeNull()
  rejectWrite=false;defer=true;host.replace({tenantId:'tenant-b',userId:'user-b',sessionKey:'b',roles:[],enabledPluginIds:['approval']});await view.render();await view.settle()
  host.replace(null);await view.render();finish(Response.json([{id:'old',revision:1,value:{title:'OLD PRIVATE',history:[]}}]));await view.settle();expect(view.container.textContent).not.toContain('OLD PRIVATE')
 }finally{await view.close()}
})
