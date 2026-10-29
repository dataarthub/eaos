import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {existsSync} from 'node:fs'
import {mkdtemp, mkdir, readFile, writeFile, rm, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve, isAbsolute, sep} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {randomUUID} from 'node:crypto'
import {runGuarded} from './guarded-process.mjs'
import {sourceHash} from './source-state.mjs'

const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2).filter(arg=>arg!=='--guarded-child')
assert(args.length===0||args.length===2&&args[0]==='--consumer'&&isAbsolute(args[1]),'Use test:ai-drafts:browser [--consumer /absolute/isolated-consumer]')
const consumer=args.length?await realpath(args[1]):null,receipt=join(root,'.verification/ai-draft-browser'+(consumer?'-artifacts':'')+'.json')
const bindings=[]
if(consumer){
 const lock=JSON.parse(await readFile(join(consumer,'package-lock.json'),'utf8'))
 for(const name of ['@alneas/eaos-core','@alneas/eaos-server','@alneas/eaos-react','@alneas/eaos-cli','@alneas/eaos-plugins','@alneas/appkit-core','@alneas/appkit-react','react','react-dom']){
  const entry=lock.packages?.['node_modules/'+name],installed=JSON.parse(await readFile(join(consumer,'node_modules',name,'package.json'),'utf8'))
  assert(entry?.integrity&&entry.resolved,'Installed artifact must have lock integrity: '+name)
  assert.equal(installed.name,name);assert.equal(installed.version,entry.version)
  let sha256
  if(entry.resolved.startsWith('file:')){const bytes=await readFile(resolve(consumer,entry.resolved.slice(5)));assert.equal(entry.integrity,'sha512-'+createHash('sha512').update(bytes).digest('base64'));sha256=createHash('sha256').update(bytes).digest('hex')}
  else assert(entry.resolved.startsWith('https://registry.npmjs.org/'),'Only public registry or explicit candidate archives allowed')
  bindings.push({name,version:entry.version,integrity:entry.integrity,resolved:entry.resolved,sha256,source:sha256?'explicit-candidate-archive':'public-registry'})
 }
}
const resolvedImports=new Map()
async function installedImport(spec){
 if(!resolvedImports.has(spec))resolvedImports.set(spec,(async()=>{
  const url=execFileSync(process.execPath,['--input-type=module','-e','console.log(import.meta.resolve('+JSON.stringify(spec)+'))'],{cwd:consumer,encoding:'utf8'}).trim()
  assert(url.startsWith('file:'),'Browser dependency must resolve to an installed file: '+spec)
  const path=await realpath(fileURLToPath(url));assert(path.startsWith(join(consumer,'node_modules')+sep),'Consumer import escaped installed dependencies: '+spec);return path
 })())
 return resolvedImports.get(spec)
}
const budget={memoryLimitMiB:3072,timeoutMs:180000,concurrency:1}
if(!process.argv.includes('--guarded-child')) {
 await mkdir(join(root,'.verification'),{recursive:true})
 const initial={runId:randomUUID(),sourceHash:await sourceHash(root),status:'running',startedAt:new Date().toISOString(),storage:'in-memory workflow fixture; no database durability guarantees',mode:consumer?'installed-artifact-consumer':'built-source',artifactBindings:bindings,cases:[],plannedCases:['1280/light','1280/dark','390/light','390/dark'],budget}
 await writeFile(receipt,JSON.stringify(initial,null,2)+'\n')
 const guard=await runGuarded(process.execPath,[import.meta.filename,'--guarded-child',...args],{cwd:root,...budget,env:{...process.env,EAOS_AI_BROWSER_RUN:initial.runId}})
 const child=JSON.parse(await readFile(receipt,'utf8'))
 const unchanged=(await sourceHash(root))===initial.sourceHash
 const result={...child,unexecutedCases:child.plannedCases.filter(label=>!child.cases.some(item=>`${item.viewport.width}/${item.mode}`===label)),status:guard.ok&&child.status==='passed'&&unchanged?'passed':'failed',guard:{...guard,...budget},completedAt:new Date().toISOString()}
 if(!guard.ok)result.error=guard.reason??`Child exited ${guard.code}`
 if(!unchanged)result.error='Source changed during AI browser verification'
 await writeFile(receipt,JSON.stringify(result,null,2)+'\n')
 console.log(`AI draft browser: ${result.status}; peak ${guard.peakMiB}/${budget.memoryLimitMiB} MiB; ${result.cases.length}/4 cases`)
 if(result.status!=='passed')process.exitCode=1
} else {
 if(!process.env.EAOS_AI_BROWSER_RUN)throw Error('Run through the guarded parent entrypoint')
 const {build}=await import('esbuild'),{chromium,expect}=await import('@playwright/test'),{default:AxeBuilder}=await import('@axe-core/playwright')
 const {createRoutes}=await import(consumer?await installedImport('@alneas/eaos-plugins/approval'):'../plugins/dist/approval/src/index.js')
 const {approvalBindingMatches}=await import(consumer?await installedImport('@alneas/eaos-core'):'../packages/core/dist/index.js')
 const out=await mkdtemp(join(tmpdir(),'eaos-ai-draft-browser-'))
 let server,browser
 const report=JSON.parse(await readFile(receipt,'utf8'))
 const principal={tenantId:'fixture',userId:'author',roles:['member']},reviewer={tenantId:'fixture',userId:'reviewer',roles:['reviewer']}
 // Owned workflow fixtures exercise real service decisions; these Maps make no DB/transaction guarantees.
 function fixture() {
  const approvals=new Map(),proposals=new Map(),completed=new Map(),records=[]
  let lastSubmission,writes=0,ordinaryAttempts=0
  const key=(tenant,id)=>`${tenant}:${id}`
  const store={async create(tenant,row){approvals.set(key(tenant,row.id),structuredClone(row))},async read(tenant,id){return structuredClone(approvals.get(key(tenant,id))??null)},async list(tenant,limit){return [...approvals].filter(([id])=>id.startsWith(tenant+':')).slice(0,limit).map(([,row])=>structuredClone(row))},async replace(tenant,row,expected){if(approvals.get(key(tenant,row.id))?.revision!==expected)return false;approvals.set(key(tenant,row.id),structuredClone(row));return true}}
  const approvalOptions={store,authorize:async p=>p.tenantId==='fixture',resolveTemplate:async()=>({id:'review',stages:[{id:'review',label:'Review',roles:['reviewer']}]}),verifyBinding:async(_p,binding)=>{const saved=proposals.get(binding.bindingHash);return Boolean(saved&&approvalBindingMatches(binding,saved.binding))}}
  const snapshot=data=>({tenantId:'fixture',recordId:'notes',revision:0,data})
  const reviewedDrafts={templateId:'review',resolveContract:async(p,submission)=>{assert.equal(p.userId,'author');assert.equal(submission.scope,'notes');assert.equal(submission.operation,'create_note');return {operation:'create_note',version:'1',permission:'notes.create',sideEffect:'write',riskLevel:'high',approvalLevel:'L2_LEAD',inputSchema:{type:'object',required:['title','commandId'],properties:{title:{type:'string'},commandId:{type:'string'}},additionalProperties:false}}},saveProposal:async(_p,proposal,binding)=>{proposals.set(binding.bindingHash,{proposal:structuredClone(proposal),binding:structuredClone(binding)})},execute:async(p,operation,input,approvalId)=>{assert.equal(p.tenantId,'fixture');assert.equal(p.userId,'author');assert.equal(operation,'create_note');assert.equal(typeof input.title,'string');assert.ok(input.title.trim());assert.equal(typeof input.commandId,'string');assert.deepEqual(Object.keys(input).sort(),['commandId','title']);if(!completed.has(approvalId)){const saved={tenantId:p.tenantId,id:randomUUID(),revision:1,title:input.title};records.push(saved);writes++;completed.set(approvalId,snapshot(saved))}return structuredClone(completed.get(approvalId))}}
  // Production plugin routing owns principal admission, exact request keys, approval and save dispatch.
  const app=createRoutes({...approvalOptions,reviewedDrafts},async context=>context.req.path.endsWith('/decisions')?reviewer:principal)
  const dispatch=async(path,input)=>{const response=await app.request(path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{status:response.status});return result}
  return {snapshot:()=>snapshot({rows:structuredClone(records)}),async review(submission){lastSubmission=structuredClone(submission);const result=await dispatch('/drafts/review',submission);if(result.status==='pending')lastSubmission.approvalRequestId=result.approvalRequestId;return result},async decide(action){assert.ok(lastSubmission?.approvalRequestId);const row=await dispatch('/requests/'+lastSubmission.approvalRequestId);return dispatch('/requests/'+row.id+'/decisions',{revision:row.revision,action})},stats:()=>({writes,ordinaryAttempts,records,lastSubmission,approvalCount:approvals.size}),ordinary(){ordinaryAttempts++;throw Object.assign(Error('Ordinary writes unavailable in reviewed-draft fixture'),{status:403})}}
 }
 let host=fixture()
 try {
  const built=await build({metafile:true,absWorkingDir:root,entryPoints:['scripts/fixtures/ai-draft-browser.tsx'],bundle:true,platform:'browser',format:'esm',outdir:out,...(consumer?{plugins:[{name:'installed-consumer-only',setup(builder){builder.onResolve({filter:/^[^./]/},async({path,importer})=>importer&&(await realpath(importer)).startsWith(consumer+sep)?undefined:{path:await installedImport(path)})}}]}:{nodePaths:[join(root,'packages/react/node_modules')],alias:{'@alneas/eaos-react/record-workspace':join(root,'packages/react/dist/record-workspace.js')}}),define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
  if(consumer)for(const [input,metadata] of Object.entries(built.metafile.inputs)){if(input.startsWith('(disabled):')){assert.equal(metadata.bytes,0,'Disabled browser stub must have no source bytes');continue}const path=await realpath(resolve(root,input));assert(path===join(root,'scripts/fixtures/ai-draft-browser.tsx')||path.startsWith(join(consumer,'node_modules')+sep),'Browser build escaped installed artifact consumer: '+input)}
  server=createServer(async(req,res)=>{
   try {
    const path=new URL(req.url,'http://fixture').pathname
    if(path==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ja"><head><title>AI draft browser regression</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>/* Appkit supplies tokens/utilities; the host supplies the native-control inheritance baseline before utility rules. */@layer theme,base,components,utilities;@layer base{button,input,select,textarea{font:inherit;color:inherit;background-color:transparent}}</style><link rel="stylesheet" href="/ai-draft-browser.css"></head><body style="margin:0;background:var(--background);color:var(--foreground)"><main id="root"></main><script type="module" src="/ai-draft-browser.js"></script></body></html>');return}
    if(['/ai-draft-browser.js','/ai-draft-browser.css'].includes(path)){res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(out,path.slice(1))));return}
    let input
    if(req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Error('Fixture body too large')}input=body?JSON.parse(body):{}}
    let result
    if(path==='/load'&&req.method==='GET')result=host.snapshot()
    else if(path==='/stats'&&req.method==='GET')result=host.stats()
    else if(path==='/reset'&&req.method==='POST'){host=fixture();result={ok:true}}
    else if(path==='/review'&&req.method==='POST')result=await host.review(input)
    else if(path==='/approve'&&req.method==='POST')result=await host.decide('approve')
    else if(path==='/reject'&&req.method==='POST')result=await host.decide('reject')
    else if(path==='/ordinary'&&req.method==='POST')result=host.ordinary()
    else{res.statusCode=404;result={error:'Unknown fixture endpoint'}}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(result))
   } catch(error){res.statusCode=error.status??500;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:error.message}))}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${server.address().port}`
  const configured=process.env.EAOS_BROWSER_EXECUTABLE??process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  const installed=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(path=>existsSync(path))
  const executablePath=configured??(existsSync(chromium.executablePath())?undefined:installed)
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})})
  report.browser={name:'Chromium',version:browser.version(),executablePath:executablePath??chromium.executablePath()}
  for(const viewport of [{width:1280,height:900},{width:390,height:844}])for(const mode of ['light','dark']) {
   const context=await browser.newContext({viewport,colorScheme:mode}),page=await context.newPage(),errors=[]
   page.setDefaultTimeout(12000)
   page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});page.on('response',response=>{if(response.status()>=500)errors.push(`HTTP ${response.status()} ${response.url()}`)})
   await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():(errors.push('External request '+route.request().url()),route.abort()))
   const label=`${viewport.width}/${mode}`,audits=[]
   const audit=async(stage)=>{const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();audits.push({stage,violations:result.violations.map(({id,nodes})=>({id,targets:nodes.map(n=>n.target),details:nodes.map(n=>n.failureSummary)})),incomplete:result.incomplete.map(({id,nodes})=>({id,targets:nodes.map(n=>n.target),details:nodes.map(n=>({html:n.html,summary:n.failureSummary,checks:[...n.any,...n.all,...n.none]}))}))});assert.deepEqual(audits.at(-1).violations,[],`${label}/${stage} accessibility`);assert.deepEqual(audits.at(-1).incomplete,[],`${label}/${stage} unresolved accessibility review`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}/${stage} page overflows viewport`)}
   try {
    console.log('AI draft browser case '+label)
    assert.equal((await page.request.post(origin+'/reset')).status(),200)
    await page.goto(origin+`/?mode=${mode}`)
    await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible()
    await page.waitForFunction(mode=>document.documentElement.classList.contains(mode),mode)
    assert.ok(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--background').trim()),'Real Appkit CSS tokens required')
    await page.getByRole('button',{name:'画面に反映して確認',exact:true}).click()
    const form=page.getByRole('region',{name:'操作フォーム'}),title=form.getByRole('textbox',{name:/^Title/})
    await expect(title).toHaveValue('AI suggested title')
    await title.fill('Operator reviewed title')
    await audit('review')
    await form.locator('button[type="submit"]').click()
    await expect(page.getByRole('status').filter({hasText:'承認待ち'})).toBeVisible()
    let stats=await (await page.request.get(origin+'/stats')).json()
    assert.equal(stats.writes,0);assert.equal(stats.ordinaryAttempts,0);assert.equal(stats.approvalCount,1)
    assert.ok(stats.lastSubmission.approvalRequestId)
    assert.equal((await page.request.post(origin+'/approve')).status(),200)
    await title.press('Control+Enter')
    await expect(page.getByRole('status').filter({hasText:'保存しました'})).toBeVisible()
    await expect(form).toHaveCount(0);await expect(page.getByRole('region',{name:'AI下書き提案'})).toHaveCount(0)
    stats=await (await page.request.get(origin+'/stats')).json()
    assert.equal(stats.writes,1);assert.equal(stats.records[0].title,'Operator reviewed title');assert.equal(stats.ordinaryAttempts,0)
    const retry=await page.request.post(origin+'/review',{data:stats.lastSubmission});assert.equal(retry.status(),200);assert.equal((await retry.json()).status,'applied')
    assert.equal((await (await page.request.get(origin+'/stats')).json()).writes,1)
    await audit('saved');assert.deepEqual(errors,[],label+' browser errors')
    report.cases.push({viewport,mode,status:'passed',writes:1,ordinaryAttempts:0,audits})
   } catch(error){report.cases.push({viewport,mode,status:'failed',error:error.message,audits});throw error}
   finally {await context.close()}
  }
  report.status='passed'
 } catch(error){report.status='failed';report.error=error.stack;throw error}
 finally {if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(out,{recursive:true,force:true});await writeFile(receipt,JSON.stringify(report,null,2)+'\n')}
}
