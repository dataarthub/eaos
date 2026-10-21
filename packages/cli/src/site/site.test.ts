import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { checkLocalSite, parseSiteOperationsConfig, runLocalSite } from './index'
async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),'eaos-local-site-')),site=join(dir,'site')
 await mkdir(site)
 await writeFile(join(site,'package.json'),JSON.stringify({scripts:{build:'bun build.ts',dev:'bun dev.ts',bad:'bun bad.ts'}}))
 await writeFile(join(site,'build.ts'),`import {readFileSync} from 'node:fs';console.log(process.env.SITE_TEST_SECRET);if(process.env.EAOS_CMS_SNAPSHOT_FILE)console.log(readFileSync(process.env.EAOS_CMS_SNAPSHOT_FILE,'utf8'));`)
 await writeFile(join(site,'bad.ts'),`process.exit(7)`)
 await writeFile(join(site,'dev.ts'),`const i=process.argv.indexOf('--port');Bun.serve({hostname:'127.0.0.1',port:Number(process.argv[i+1]),fetch:()=>new Response('preview')});`)
 const port=await new Promise<number>((ok,fail)=>{const s=createServer();s.once('error',fail);s.listen(0,'127.0.0.1',()=>{const port=(s.address() as {port:number}).port;s.close(()=>ok(port))})})
 const config=parseSiteOperationsConfig({bunPath:process.execPath,sites:[{id:'hotel',name:'Hotel',cmsSiteId:'cms-hotel',directory:site,port,envKeys:['SITE_TEST_SECRET']}]})
 return {dir,site,config}
}
test('registry rejects arbitrary script/path overrides and reserved snapshot env',()=>{
 expect(()=>parseSiteOperationsConfig({sites:[{id:'hotel',name:'H',cmsSiteId:'cms',directory:'../site'}]})).toThrow()
 expect(()=>parseSiteOperationsConfig({sites:[{id:'hotel',name:'H',cmsSiteId:'cms',buildScript:'build;echo bad'}]})).toThrow()
 expect(()=>parseSiteOperationsConfig({sites:[{id:'hotel',name:'H',cmsSiteId:'cms',envKeys:['EAOS_CMS_SNAPSHOT_FILE']}]})).toThrow()
 expect(()=>parseSiteOperationsConfig({sites:[],command:'bash'})).toThrow()
})
test('local build runs actual registered script, pins snapshot bytes, redacts secrets and records failures',async()=>{
 const f=await fixture(), old=process.env.SITE_TEST_SECRET;process.env.SITE_TEST_SECRET='private-fixture-token'
 try {
  expect((await checkLocalSite(f.config,'hotel')).buildScript).toBe('build')
  const snapshot=join(f.dir,'published.json');await writeFile(snapshot,JSON.stringify({siteId:'cms-hotel',revision:4,posts:[],assets:[]}))
  const r=await runLocalSite(f.config,'hotel','build',f.dir,{snapshot,durationSeconds:5})
  expect(r.outcome).toBe('succeeded');expect(r.snapshotHash).toHaveLength(64)
  expect(await readFile(r.logFile,'utf8')).toContain('[redacted]');expect(await readFile(r.logFile,'utf8')).not.toContain('private-fixture-token')
  expect(await readdir(join(r.logFile,'..'))).not.toContain('snapshot.json')
  f.config.sites[0].buildScript='bad'
  await expect(runLocalSite(f.config,'hotel','build',f.dir,{durationSeconds:5})).rejects.toThrow('Site operation failed; log:')
 } finally { if(old === undefined) delete process.env.SITE_TEST_SECRET;else process.env.SITE_TEST_SECRET=old;await rm(f.dir,{recursive:true,force:true}) }
})
test('private draft is refused for build and expired or foreign draft is refused for preview',async()=>{
 const f=await fixture(),snapshot=join(f.dir,'draft.json')
 try {
  const dto={siteId:'cms-hotel',revision:2,posts:[],assets:[],preview:{kind:'draft',expiresAt:new Date(Date.now()+30000).toISOString()}}
  await writeFile(snapshot,JSON.stringify(dto));await expect(runLocalSite(f.config,'hotel','build',f.dir,{snapshot})).rejects.toThrow('Draft snapshot')
  dto.preview.expiresAt=new Date(0).toISOString();await writeFile(snapshot,JSON.stringify(dto));await expect(runLocalSite(f.config,'hotel','preview',f.dir,{snapshot})).rejects.toThrow('Draft snapshot')
  dto.siteId='other';await writeFile(snapshot,JSON.stringify(dto));await expect(runLocalSite(f.config,'hotel','preview',f.dir,{snapshot})).rejects.toThrow('Snapshot site/revision differs')
 } finally {await rm(f.dir,{recursive:true,force:true})}
})
test('preview starts an actual loopback server, protects response and stops it on cancellation',async()=>{
 const f=await fixture(),abort=new AbortController();let ready!: (url:string)=>void
 const started=new Promise<string>(ok=>ready=ok)
 try {
  const run=runLocalSite(f.config,'hotel','preview',f.dir,{durationSeconds:10,signal:abort.signal,onReady:ready})
  const url=await started,r=await fetch(url)
  expect(await r.text()).toBe('preview');expect(r.headers.get('cache-control')).toBe('private, no-store');expect(r.headers.get('x-robots-tag')).toContain('noindex')
  expect((await fetch(url,{headers:{Origin:'https://foreign.example'}})).status).toBe(403)
  abort.abort();expect((await run).outcome).toBe('stopped')
  await expect(fetch(url)).rejects.toThrow()
 } finally {abort.abort();await rm(f.dir,{recursive:true,force:true})}
},15000)

test('validated private snapshots enable the site draft reader only for the pinned preview',async()=>{
 const f=await fixture(),snapshot=join(f.dir,'draft.json'),abort=new AbortController();let ready!: (url:string)=>void
 const started=new Promise<string>(ok=>ready=ok)
 try {
  await writeFile(join(f.config.sites[0].directory!,'dev.ts'),`const i=process.argv.indexOf('--port');Bun.serve({hostname:'127.0.0.1',port:Number(process.argv[i+1]),fetch:()=>new Response(process.env.EAOS_CMS_DRAFT_PREVIEW)});`)
  await writeFile(snapshot,JSON.stringify({siteId:'cms-hotel',revision:2,posts:[],assets:[],preview:{kind:'draft',expiresAt:new Date(Date.now()+30000).toISOString()}}))
  const run=runLocalSite(f.config,'hotel','preview',f.dir,{snapshot,durationSeconds:10,signal:abort.signal,onReady:ready})
  expect(await (await fetch(await started)).text()).toBe('true')
  abort.abort();expect((await run).outcome).toBe('stopped')
 }finally{abort.abort();await rm(f.dir,{recursive:true,force:true})}
},15000)

test('site registration validates publication policy while allowing remote sites without local directories',()=>{
 const site={id:'hotel',name:'Hotel',cmsSiteId:'cms-hotel',publication:{mode:'pages-git',accountId:'1'.repeat(32),project:'hotel',branch:'main',deployHookSecret:'HOTEL_HOOK',requireApproval:false,trigger:'cms-published'}}
 expect(parseSiteOperationsConfig({sites:[site]}).sites[0].publication?.mode).toBe('pages-git')
 expect(()=>parseSiteOperationsConfig({sites:[{...site,publication:{...site.publication,hookUrl:'https://secret'}}]})).toThrow()
})
