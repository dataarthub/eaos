import { appkitVersions } from './appkit-versions.mjs'
import assert from 'node:assert/strict'
import { mkdtemp,readFile,writeFile,mkdir,rm,realpath } from 'node:fs/promises'
import { tmpdir,release as osRelease } from 'node:os'
import { join,resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync,spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from '@playwright/test'
import { contrastRatio } from './contrast.mjs'
import { sourceHash } from './source-state.mjs'
if(!process.env.EAOS_VERIFICATION_RUN)throw Error('Use bun run test:consumer for guarded verification')
const root=resolve(import.meta.dirname,'..'),bundle=resolve(process.argv[2]??'')
const manifest=JSON.parse(await readFile(join(bundle,'bundle.json'),'utf8'))
assert.equal(manifest.sourceHash,await sourceHash(root),'Candidate source changed')
const consumer=await mkdtemp(join(tmpdir(),'eaos-public-consumer-'))
let server,browser
try {
  const dependencies={hono:'4.13.13','@types/react-dom':'19.3.0','@tanstack/react-query':'5.104.5',tailwindcss:'4.3.1',react:'19.3.1','react-dom':'19.3.1',...appkitVersions,typescript:'6.0.3','@types/react':'19.3.0','@types/node':'22.20.5'}
  for(const item of manifest.archives) {
    assert.ok(item.archive===item.archive.split(/[\\/]/).at(-1)&&!item.archive.includes('..'))
    const archive=join(bundle,item.archive),bytes=await readFile(archive)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,'Archive changed')
    dependencies[item.name]='file:'+archive
  }
  await writeFile(join(consumer,'package.json'),JSON.stringify({name:'eaos-archive-consumer',private:true,type:'module',dependencies}))
  const install=spawnSync('npm',['install','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache',join(root,'.verification/npm-cache')],{cwd:consumer,encoding:'utf8',maxBuffer:16*1024*1024})
  await mkdir(join(root,'.verification/logs'),{recursive:true})
  await writeFile(join(root,'.verification/logs/consumer-install.log'),(install.stdout??'')+(install.stderr??''))
  assert.equal(install.status,0,'Registry-only consumer install failed; see ignored consumer-install.log')
  const entries=['@alneas/eaos-core','@alneas/eaos-server/storage','@alneas/eaos-react/client','@alneas/eaos-cli/baseline','@alneas/eaos-plugins/approval/runtime','@alneas/eaos-plugins/field-customization/runtime','@alneas/eaos-plugins/admin/runtime','@alneas/eaos-core/ai/document-parser','@alneas/eaos-core/ai/smart-ingestion','@alneas/eaos-core/ai/evidence-traceability','@alneas/eaos-core/ai/inline-completion','@alneas/eaos-core/ai/proposal-ui','@alneas/eaos-core/plugin-sdk/journal-draft','@alneas/eaos-core/plugin-sdk/immutable-ledger','@alneas/eaos-core/plugin-sdk/hybrid-document']
  await writeFile(join(consumer,'smoke.mjs'),`import assert from 'node:assert/strict';import {realpath} from 'node:fs/promises';for(const spec of ${JSON.stringify(entries)}){const path=await realpath(new URL(import.meta.resolve(spec)));assert(path.startsWith(import.meta.dirname+'/node_modules/'),spec);await import(spec)}console.log('${entries.length} archive entrypoints resolve and load inside consumer')`)
  execFileSync(process.execPath,['smoke.mjs'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})
  assert.equal(manifest.archives.length,5,'Four foundations and one plugin collection required')
  await writeFile(join(consumer,'cli-versions.mjs'),`import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {cliVersion,frameworkVersion} from '@alneas/eaos-cli/version';import {generatePlugin} from '@alneas/eaos-cli/plugin-tools';assert.equal(cliVersion,${JSON.stringify(manifest.archives.find(p=>p.name==='@alneas/eaos-cli').version)});assert.equal(frameworkVersion,${JSON.stringify(manifest.archives.find(p=>p.name==='@alneas/eaos-core').version)});await generatePlugin(import.meta.dirname,{name:'release-version-check'});const generated=JSON.parse(await readFile(new URL('./plugins/release-version-check/package.json',import.meta.url),'utf8'));assert.equal(generated.peerDependencies['@alneas/eaos-core'],frameworkVersion);console.log('Independent CLI/Core versions in packed generator passed')`)
  execFileSync(process.execPath,['cli-versions.mjs'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})

  for(const id of ['approval','field-customization','admin']) {
    const directory=join(consumer,'node_modules/@alneas/eaos-plugins/dist',id)
    const inventory=JSON.parse(await readFile(join(directory,'deployment.json'),'utf8'))
    assert.equal(inventory.owner,'@alneas/eaos-plugins/'+id)
    assert.equal(inventory.version,manifest.archives.find(p=>p.name==='@alneas/eaos-plugins').version)
    assert.deepEqual(inventory.lifecycleBundle,[id])
    const metadata=await import(new URL(join(directory,'manifest.js'),'file:').href)
    assert.equal(metadata.manifest.version,inventory.version,'Feature manifest matches the reviewed collection release')
    for(const relative of [metadata.manifest.docs.userGuidePath,metadata.manifest.docs.maintainerGuidePath,...(metadata.manifest.agentCapabilities?.skills??[]).map(skill=>skill.documentPath)]) {
      assert.ok(inventory.assets.some(asset=>asset.path===relative),'Manifest document must survive isolated module staging: '+relative)
    }
    for(const asset of inventory.assets) {
      const bytes=await readFile(join(directory,asset.path))
      assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,'Packed plugin inventory hash: '+asset.path)
    }
    const graph=await build({absWorkingDir:consumer,entryPoints:[join(directory,'src/runtime.js')],bundle:true,packages:'external',platform:'node',format:'esm',write:false,metafile:true,logLevel:'silent'})
    for(const path of Object.keys(graph.metafile.inputs)) {
      assert.ok(path.includes('/dist/'+id+'/'),'Runtime must remain inside the selected plugin output: '+path)
      assert.ok(!/journal-workspace|user-help|\/react\./.test(path),'Runtime must not load the browser entry: '+path)
    }
    for(const output of Object.values(graph.metafile.outputs))for(const dependency of output.imports) {
      assert.ok(!/^(?:react(?:\/|$)|react-dom(?:\/|$)|@alneas\/(?:eaos-react|appkit-react)(?:\/|$))/.test(dependency.path),'Server runtime must not import browser peers: '+dependency.path)
    }
  }
  await writeFile(join(consumer,'selection.mjs'),`
import assert from 'node:assert/strict'
import {readFile,writeFile,access} from 'node:fs/promises'
import {resolveProjectManifest,stagePlatformPackages} from '@alneas/eaos-cli/platform'
const root=import.meta.dirname
const manifest={preset:'oci-adb',platform:{appName:'example',baseDomain:'example.test'},plugins:['@alneas/eaos-plugins/approval','@alneas/eaos-plugins/admin']}
await writeFile(root+'/eaos.platform.json',JSON.stringify(manifest))
const selected=await resolveProjectManifest(root,manifest)
assert.deepEqual(selected.npmArtifacts.map(a=>a.id),manifest.plugins)
await stagePlatformPackages(root,root+'/staged')
await access(root+'/staged/node_modules/@alneas/eaos-plugins/dist/approval/skills/approval-policy/SKILL.md')
await assert.rejects(access(root+'/staged/node_modules/@alneas/eaos-plugins/dist/field-customization/src/runtime.js'))
await writeFile(root+'/staged/probe.mjs',\`import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createExtension} from '@alneas/eaos-plugins/approval/runtime';assert.equal(typeof createExtension,'function');assert.ok(import.meta.resolve('@alneas/eaos-plugins/admin/client/web/journal').includes('/dist/admin/'));assert.ok(createRequire(import.meta.url).resolve('@alneas/eaos-plugins/admin/eaos.clients.json').includes('/dist/admin/'));await assert.rejects(import('@alneas/eaos-plugins/field-customization/runtime'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});\`)
await import(root+'/staged/probe.mjs')
console.log('Packed CLI stages only requested collection modules with public exports and guide/skill assets')
`)
  execFileSync(process.execPath,['selection.mjs'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})
  await writeFile(join(consumer,'types.ts'),`import {definePlugin} from '@alneas/eaos-core';\nimport type {StorageAdapter} from '@alneas/eaos-server/storage';\nimport type {DataAccessAdapter} from '@alneas/appkit-core/data/types';\nimport {WorkspaceHeader} from '@alneas/eaos-react/workspace-layout';\nimport {prepareAiDraftSubmission} from '@alneas/eaos-core/ai/proposal-ui';\nimport {generateJournalDraftFromDocument} from '@alneas/eaos-core/plugin-sdk/journal-draft';\nimport {validateHybridDocument} from '@alneas/eaos-core/plugin-sdk/hybrid-document';\nimport type {IngestionModelAdapter} from '@alneas/eaos-core/ai/smart-ingestion';\nimport {createReviewedDraftHandler,type ApprovalPluginOptions} from '@alneas/eaos-plugins/approval';\nimport type {RecordWorkspaceProps} from '@alneas/eaos-react/record-workspace';\nconst submission=prepareAiDraftSubmission({mode:'create',scope:'notes',values:{title:'Reviewed'}},{scope:'notes',operation:'create',targetId:'command-1'});\nconst review:NonNullable<RecordWorkspaceProps['reviewAiDraft']>=async request=>({status:'pending',approvalRequestId:request.proposal.id});\nconst model:IngestionModelAdapter={extractIntent:async()=>({domain:'custom-domain',targetMode:'create',summary:'Draft',confidence:'high',extractedFields:{title:'Draft'}})};\nexport {definePlugin,WorkspaceHeader,prepareAiDraftSubmission,generateJournalDraftFromDocument,validateHybridDocument,createReviewedDraftHandler,submission,review,model}; export type {StorageAdapter,DataAccessAdapter,ApprovalPluginOptions};\n`)
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','types.ts'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})
  await writeFile(join(consumer,'standard-host.ts'),await readFile(join(root,'scripts/fixtures/standard-host-consumer.ts'),'utf8'))
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--types','node','standard-host.ts'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})
  execFileSync(process.execPath,['standard-host.ts'],{cwd:consumer,stdio:'inherit'})
  await writeFile(join(consumer,'workspace-binding.ts'),await readFile(join(root,'scripts/fixtures/workspace-binding-consumer.ts'),'utf8'))
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--types','node','workspace-binding.ts'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})
  execFileSync(process.execPath,['workspace-binding.ts'],{cwd:consumer,stdio:'inherit'})
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--types','node','generated/bindings.ts'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})

  const readmeExamples=[]
  const readmes=[{name:'monorepo',text:await readFile(join(root,'README.md'),'utf8')}]
  for(const archive of manifest.archives)for(const filename of ['README.md','README.ja.md']) {
    try{readmes.push({name:archive.name+'/'+filename,text:await readFile(join(consumer,'node_modules',archive.name,filename),'utf8')})}
    catch(error){if(error.code!=='ENOENT')throw error}
  }
  for(const id of ['approval','field-customization','admin']) {
    const filename=id+'/README.md'
    readmes.push({name:'@alneas/eaos-plugins/'+filename,text:await readFile(join(consumer,'node_modules/@alneas/eaos-plugins',filename),'utf8')})
  }
  for(const readme of readmes)for(const match of readme.text.matchAll(/^```(typescript|tsx|ts)\n([\s\S]*?)^```/gm)) {
    const filename=`readme-example-${readmeExamples.length}.${match[1]==='tsx'?'tsx':'ts'}`
    await writeFile(join(consumer,filename),match[2])
    readmeExamples.push({readme:readme.name,filename})
  }
  assert.ok(readmeExamples.length>=8,'All owning README examples required')
  // This is the exact host CSS declaration documented in the React README;
  // esbuild below must still resolve and emit the real exported stylesheet.
  await writeFile(join(consumer,'appkit-styles.d.ts'),"declare module '@alneas/appkit-react/styles';\ndeclare module '*.css';\n")
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--skipLibCheck','--strict','--jsx','react-jsx','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','appkit-styles.d.ts',...readmeExamples.map(x=>x.filename)],{cwd:consumer,stdio:'pipe',encoding:'utf8'})
  console.log(`${readmeExamples.length} README examples type-check in the isolated installed-artifact consumer`)
  await writeFile(join(consumer,'browser.tsx'),`import React from 'react';import {createRoot} from 'react-dom/client';import {ThemeProvider} from '@alneas/appkit-react/tools/core';import {SidebarProvider} from '@alneas/appkit-react/tools/sidebar';import '@alneas/appkit-react/styles';import {WorkspaceHeader} from '@alneas/eaos-react/workspace-layout';const config=new URLSearchParams(location.search);createRoot(document.getElementById('root')!).render(<ThemeProvider defaultTheme={config.get("mode") as "light"|"dark"} defaultColorTheme={config.get("palette")!}><SidebarProvider><WorkspaceHeader title="EAOS archive consumer" currentLanguage="en" onLanguageChange={()=>{document.documentElement.dataset.language='ja'}}/></SidebarProvider><section aria-label="Theme contrast samples">{['background','primary','secondary','accent','muted','destructive','card','popover'].map(token=><p key={token} style={{backgroundColor:'var(--'+token+')',color:'var(--'+(token==='background'?'foreground':token+'-foreground')+')'}}>{token} foreground and background</p>)}</section></ThemeProvider>);`)
  await writeFile(join(consumer,'application.tsx'),await readFile(join(root,'scripts/fixtures/workspace-application-consumer.tsx'),'utf8'))
  await writeFile(join(consumer,'application-base.css'),await readFile(join(root,'scripts/fixtures/workspace-application-consumer.css'),'utf8'))
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--strict','--skipLibCheck','--jsx','react-jsx','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','appkit-styles.d.ts','application.tsx'],{cwd:consumer,stdio:'pipe',encoding:'utf8'})
  const out=join(consumer,'web');await mkdir(out)
  await build({absWorkingDir:consumer,entryPoints:['browser.tsx','application.tsx'],bundle:true,platform:'browser',format:'esm',outdir:out,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'})
  server=createServer(async(req,res)=>{
    try {
      if(['/', '/application'].includes(req.url?.split('?')[0])){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="ja"><head><title>EAOS archive consumer</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/'+(req.url.startsWith('/application')?'application':'browser')+'.css"></head><body style="margin:0"><main><div id="root"></div></main><script type="module" src="/'+(req.url.startsWith('/application')?'application':'browser')+'.js"></script></body></html>');return}
      const file=['/browser.js','/browser.css','/application.js','/application.css'].includes(req.url)?req.url.slice(1):null
      if(!file){res.statusCode=404;res.end();return}
      res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(out,file)))
    }catch{res.statusCode=500;res.end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin='http://127.0.0.1:'+server.address().port
  browser=await chromium.launch({headless:true})
  const cases=[]
  const palettes=['default','blue','green','rose','orange','future']
  for(const viewport of [{width:1280,height:800},{width:390,height:844}])for(const mode of ['light','dark'])for(const palette of palettes) {
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[]
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())})
    page.on('response',response=>{if(response.status()>=500)errors.push('HTTP '+response.status())})
    await page.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();errors.push('Unhandled external request: '+route.request().url());return route.abort()})
    const label=`${viewport.width}/${mode}/${palette}`,audits=[]
    console.log('Browser case '+label)
    await page.goto(origin+`/?mode=${mode}&palette=${palette}`)
    await page.waitForFunction(({mode,palette})=>document.documentElement.classList.contains(mode)&&(palette==='default'||document.documentElement.classList.contains('theme-'+palette)),{mode,palette})
    const colors=await page.evaluate(()=>{
      const root=getComputedStyle(document.documentElement)
      return {background:root.getPropertyValue('--background').trim(),foreground:root.getPropertyValue('--foreground').trim(),primary:root.getPropertyValue('--primary').trim()}
    })
    assert.ok(colors.background&&colors.foreground&&colors.primary,'Real Appkit tokens required')
    const base=cases.find(item=>item.viewport.width===viewport.width&&item.mode===mode&&item.palette==='default')
    if(palette==='future'&&mode==='light')assert.equal(colors.primary,base.colors.primary,label+' dark-only future palette must retain the documented light fallback')
    else if(palette!=='default')assert.notEqual(colors.primary,base.colors.primary,label+' palette must alter computed primary')
    if(palette==='default'&&mode==='dark')assert.notEqual(colors.background,cases.find(item=>item.viewport.width===viewport.width&&item.mode==='light'&&item.palette==='default').colors.background,label+' mode must alter computed background')
    const audit=async()=>{
      const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()
      assert.ok(result.incomplete.every(rule=>['aria-hidden-focus','color-contrast'].includes(rule.id)),label+' unexpected accessibility review item')
      // A scroll edge can partly clip a paragraph. Resolve that axe review item
      // from actual computed colors, without disabling the rule or changing styles.
      for(const rule of result.incomplete.filter(rule=>rule.id==='color-contrast'))for(const node of rule.nodes) {
        assert.equal(node.target.length,1,'Unsupported contrast review selector')
        for(const check of [...node.any,...node.all,...node.none]) {
          assert.equal(check.data?.messageKey,'elmPartiallyObscured','Unresolved contrast cause requires review')
          for(const related of check.relatedNodes) {
            assert.equal(related.target.length,1,'Unsupported contrast background selector')
            assert.ok(await page.evaluate(({ancestor,target})=>{
              const parent=document.querySelector(ancestor),child=document.querySelector(target)
              return parent?.contains(child)&&['auto','scroll','hidden','clip'].includes(getComputedStyle(parent).overflowY)
            },{ancestor:related.target[0],target:node.target[0]}),'Only ancestor scroll clipping can use computed contrast review')
          }
        }
        const color=await page.locator(node.target[0]).evaluate(el=>{
          const canvas=document.createElement('canvas');canvas.width=canvas.height=1
          const context=canvas.getContext('2d',{willReadFrequently:true})
          const rgba=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);const pixel=[...context.getImageData(0,0,1,1).data];return [...pixel.slice(0,3),pixel[3]/255]}
          const backgrounds=[]
          for(let ancestor=el;ancestor;ancestor=ancestor.parentElement){
            const style=getComputedStyle(ancestor)
            if(style.backgroundImage!=='none'||Number(style.opacity)!==1||style.filter!=='none'||style.mixBlendMode!=='normal')throw Error('Unsupported contrast layer requires explicit review')
            backgrounds.unshift(rgba(style.backgroundColor))
          }
          const style=getComputedStyle(el)
          return {foreground:rgba(style.color),backgrounds,fontSize:parseFloat(style.fontSize),fontWeight:Number(style.fontWeight)}
        })
        const required=color.fontSize>=24||(color.fontSize>=18.6667&&color.fontWeight>=700)?3:4.5
        assert.ok(contrastRatio(color.foreground,color.backgrounds)>=required,label+' computed alpha-composited contrast: '+node.target[0])
      }
      audits.push({incomplete:result.incomplete.map(rule=>({id:rule.id,targets:rule.nodes.map(n=>n.target)})),contrastReviewed:result.incomplete.filter(rule=>rule.id==='color-contrast').reduce((count,rule)=>count+rule.nodes.length,0)})
      assert.deepEqual(result.violations.map(({id,nodes})=>({id,targets:nodes.map(n=>n.target)})),[],label+' accessibility')
    }
    await audit()
    await page.getByText('EAOS archive consumer',{exact:true}).filter({visible:true}).waitFor()
    await page.getByTitle('日本語に切り替え').click()
    assert.equal(await page.locator('html').getAttribute('data-language'),'ja')
    await page.getByRole('button',{name:'ワークスペースのヘルプ',exact:true}).click()
    await page.getByRole('dialog').waitFor()
    // Popup visibility precedes Base UI's initial focus and opening animation.
    await page.waitForFunction(()=>document.activeElement?.closest('[role="dialog"]'))
    await page.getByRole('dialog').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished))})
    const guide=page.getByRole('article',{name:'利用ガイド'})
    const focusTrace=[]
    for(let tabs=0;tabs<10&&!await guide.evaluate(el=>el===document.activeElement);tabs++){
      focusTrace.push(await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.slice(0,80)})))
      await page.keyboard.press('Tab')
    }
    assert.ok(await guide.evaluate(el=>el===document.activeElement),label+' help must be keyboard reachable: '+JSON.stringify(focusTrace))
    const beforeScroll=await guide.evaluate(el=>el.scrollTop)
    await page.keyboard.press('End')
    await page.waitForFunction(()=>document.querySelector('article').scrollTop>0)
    assert.ok(await guide.evaluate(el=>el.scrollTop)>beforeScroll,label+' keyboard scroll')
    await page.keyboard.press('Home')
    await page.waitForFunction(()=>document.querySelector('article').scrollTop===0)
    // Resolve axe's modal-focus review item using real keyboard traversal.
    for(let tabs=0;tabs<12;tabs++){
      await page.keyboard.press('Tab')
      await page.waitForFunction(()=>document.activeElement?.closest('[role="dialog"]'))
    }
    await audit()
    assert.equal(await page.locator('button button').count(),0)
    for(const control of await page.locator('button:visible').all()) {
      const box=await control.boundingBox()
      assert.ok(box&&box.width>=24&&box.height>=24,label+' minimum 24px control target')
      assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1,label+' control viewport containment')
    }
    const dialog=await page.getByRole('dialog').boundingBox()
    assert.ok(dialog&&dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=viewport.width+1&&dialog.y+dialog.height<=viewport.height+1,label+' dialog containment')
    assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),label+' dialog text clipping')
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow')
    assert.deepEqual(errors,[],'Browser errors')
    let signedIn=true
    await page.route('**/fixture/session',route=>route.fulfill({json:signedIn?{id:'reader',email:'reader@example.test',name:'Reader'}:null}))
    await page.route('**/fixture/context',route=>route.fulfill({json:{tenantId:'workspace',userId:'reader',tenantName:'Archive workspace',enabledModules:['reports'],pluginAccess:{reports:{allowed:true}},plugins:[{id:'reports',name:'Reports',navigation:{web:{children:[{path:'/reports',label:'Reports page'}]}}}]}}))
    await page.route('**/fixture/logout',route=>{signedIn=false;return route.fulfill({json:{}})})
    await page.goto(origin+`/application?mode=${mode}&palette=${palette}`)
    await page.getByRole('heading',{name:'Report editor',exact:true}).waitFor()
    await page.getByRole('textbox',{name:'Draft',exact:true}).fill('Preserved draft')
    await page.evaluate(()=>window.dispatchEvent(new Event('fixture-session')))
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await page.getByRole('heading',{name:'Report editor',exact:true}).waitFor()
    assert.equal(await page.getByRole('textbox',{name:'Draft',exact:true}).inputValue(),'Preserved draft')
    await audit()
    await page.getByRole('button',{name:'ワークスペースのヘルプ',exact:true}).click()
    await page.getByRole('dialog').waitFor()
    await page.waitForFunction(()=>document.activeElement?.closest('[role="dialog"]'))
    await page.getByRole('dialog').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished))})
    await audit();await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({state:'hidden'})
    if(viewport.width<768){await page.getByRole('button',{name:'Toggle Sidebar',exact:true}).click()}
    await page.getByRole('button',{name:'Reports page',exact:true}).first().click()
    assert.ok(await page.getByRole('textbox',{name:'Draft',exact:true}).isVisible())
    if(viewport.width<768){await page.getByRole('button',{name:'Toggle Sidebar',exact:true}).click()}
    await page.getByRole('button',{name:'ログアウト',exact:true}).click()
    await page.getByRole('button',{name:'Googleでサインイン',exact:true}).waitFor()
    assert.equal(await page.locator('input[type=email],input[type=password]').count(),0)
    assert.equal(await page.locator('input[aria-label="Draft"]').count(),0)
    await audit()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Application horizontal overflow')
    assert.deepEqual(errors,[],'Application browser errors')
    cases.push({viewport,mode,palette,colors,audits,states:['header','help-open','application-ready','application-help','application-logout']})
    await context.close()
  }
  const result={runId:process.env.EAOS_VERIFICATION_RUN,sourceHash:manifest.sourceHash,archives:manifest.archives.map(({name,version,sha256})=>({name,version,sha256})),node:process.version,entries:entries.length,typescript:'NodeNext',readmeExamples:readmeExamples.map(x=>x.readme),browser:{name:'Chromium',version:browser.version(),revision:chromium.executablePath().match(/(?:chromium|chromium_headless_shell)-(\d+)/)?.[1]??null,platform:process.platform,arch:process.arch,osRelease:osRelease(),cases},verifiedAt:new Date().toISOString()}
  await writeFile(join(bundle,'consumer-result.json'),JSON.stringify(result,null,2)+'\n')
  console.log('Registry-only isolated archive consumer passed: Node imports, declarations, README examples, browser bundle and desktop/mobile interactions')
} finally {
  await browser?.close()
  if(server)await new Promise(resolve=>server.close(resolve))
  await rm(consumer,{recursive:true,force:true})
}
