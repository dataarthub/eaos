import {test,expect} from 'bun:test'
import {frontmatter,securityErrors,documentPath,resolveDocumentLink,hasJapaneseProse} from './documentation'
test('documentation gates reject local paths, actual tenant/provider values and credentials',()=>{
 for(const value of ['/Volumes/disk/private.md','file:///secret.md','/Users/operator/secret','ocid1.database.oc1.example','tenant kankyo','ghp_'+'x'.repeat(30)])expect(securityErrors(value).length).toBeGreaterThan(0)
 expect(securityErrors('Use tenantId from verified identity; examples use example.com.')).toEqual([])
})
test('unregistered private, absolute and traversal sources cannot enter public ingestion',async()=>{
 for(const path of ['../private/guide.md','/tmp/guide.md','packages/core/../../private/guide.md','artifacts/receipt.md','packages/core/docs/link.txt'])await expect(documentPath(path)).rejects.toThrow()
 const doc={title:'Core',slug:'core/index',source:'packages/core/README.md',visibility:'public' as const,archetype:'explanation' as const},map=new Map([[doc.source,doc]])
 expect(resolveDocumentLink('docs/architecture.md','../packages/core/README.md#scope',map)).toEqual({doc,fragment:'scope'})
 expect(()=>resolveDocumentLink('docs/architecture.md','../../private/guide.md',map)).toThrow('Unregistered')
 expect(()=>resolveDocumentLink('docs/architecture.md','/internal/guide/',map)).toThrow('relative')
})
test('frontmatter requires semantic fields rather than a title-only wrapper',()=>{
 expect(()=>frontmatter('---\ntitle: "Missing metadata"\n---\n')).toThrow('description')
})
test('English canonical prose preserves exact runtime literals without admitting Japanese narrative',()=>{
 expect(hasJapaneseProse('Default: `"ワークスペースへログイン"`.')).toBe(false)
 expect(hasJapaneseProse('Example:\n```typescript\nconst label = "日本語"\n```')).toBe(false)
 expect(hasJapaneseProse('この説明は英語正本ではない。')).toBe(true)
 expect(securityErrors('`/Volumes/disk/private.md`')).toContain('local filesystem path')
})

// Exercise the published recipe itself; no real secret manager or deployment runs.
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function withSecretRecipe(run: (invoke: (provider: string, overrides?: Record<string, string>) => Promise<{exitCode: number, output: string, deployed: any}>) => Promise<void>) {
 const root = await mkdtemp(join(tmpdir(), 'eaos-secret-recipe-'))
 const keys = ['KAMAL_REGISTRY_USERNAME', 'KAMAL_REGISTRY_PASSWORD', 'ADB_CONNECT_STRING', 'ADB_PASSWORD']
 try {
  const guide = await readFile(new URL('../packages/cli/docs/oci-release.md', import.meta.url), 'utf8')
  const recipe = guide.match(/```javascript\n([\s\S]*?)```/)?.[1]
  expect(recipe).toBeDefined()
  await writeFile(join(root, 'recipe.mjs'), recipe!)
  const node = Bun.which('node')!
  const fake = async (name: string, body: string) => { const path = join(root, name); await writeFile(path, `#!${node}\n${body}`); await chmod(path, 0o700) }
  await fake('kamal', `require('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({args:process.argv.slice(2),values:Object.fromEntries(${JSON.stringify(keys)}.map(k=>[k,process.env[k]])),token:process.env.BWS_ACCESS_TOKEN}));`)
  await fake('oci', `const args=process.argv.slice(2); const id=args[args.indexOf('--secret-id')+1]; if(process.env.MODE==='denied'){console.error('synthetic-provider-secret');process.exit(1)}; const value=process.env.FIXTURE; const content=process.env.MODE==='malformed'?'!invalid!':Buffer.from(value).toString('base64'); process.stdout.write(JSON.stringify({data:{'secret-bundle-content':{'content-type':'BASE64',content}}})); require('node:fs').appendFileSync(process.env.OCI_CALLS,JSON.stringify(args)+'\\n');`)
  await run(async (provider, overrides = {}) => {
   const capture = join(root, 'capture.json'); await rm(capture, { force: true })
   const env:Record<string,string> = { PATH:root, CAPTURE:capture, OCI_CALLS:join(root,'calls.jsonl'), FIXTURE:'synthetic $() `text` 日本語 \\ " value', BWS_ACCESS_TOKEN:'synthetic-bootstrap' }
   for(const key of keys) { env[key]='synthetic-env-value'; env[`OCI_SECRET_OCID_${key}`]=`synthetic-${key}` }
   const result = Bun.spawnSync([node,join(root,'recipe.mjs'),provider,'deploy'], {env:{...env,...overrides},stdout:'pipe',stderr:'pipe'})
   const deployed = await readFile(capture,'utf8').then(JSON.parse).catch(()=>null)
   if(provider==='oci-vault' && result.exitCode===0) {
    const calls=(await readFile(env.OCI_CALLS,'utf8')).trim().split('\n').map(v=>JSON.parse(v))
    expect(calls.slice(-4).map(a=>a[a.indexOf('--secret-id')+1])).toEqual(keys.map(k=>env[`OCI_SECRET_OCID_${k}`]))
    expect(calls.every(a=>a.includes('instance_principal')&&a.includes('CURRENT'))).toBe(true)
   }
   return {exitCode:result.exitCode,output:result.stdout.toString()+result.stderr.toString(),deployed}
  })
 } finally { await rm(root,{recursive:true,force:true}) }
}
test('optional secret recipe accepts injected values without invoking a manager and drops bootstrap token',async()=>{
 await withSecretRecipe(async invoke=>{
  const result=await invoke('env',{ADB_PASSWORD:'synthetic $() `text` 日本語 \\ " value'})
  expect(result.exitCode).toBe(0);expect(result.output).toBe('');expect(result.deployed.args).toEqual(['deploy'])
  expect(result.deployed.values.ADB_PASSWORD).toBe('synthetic $() `text` 日本語 \\ " value');expect(result.deployed.token).toBeUndefined()
 })
})
test('optional OCI recipe reads selected bundles and preserves exact secret characters',async()=>{
 await withSecretRecipe(async invoke=>{
  const result=await invoke('oci-vault');expect(result.exitCode).toBe(0);expect(result.output).toBe('')
  expect(Object.values(result.deployed.values)).toEqual(Array(4).fill('synthetic $() `text` 日本語 \\ " value'))
  expect(result.deployed.token).toBeUndefined()
 })
})
test('optional secret recipe refuses missing values, invalid providers and failed bundles without deployment or leakage',async()=>{
 await withSecretRecipe(async invoke=>{
  for(const [provider,overrides] of [['env',{ADB_PASSWORD:''}],['env',{ADB_PASSWORD:'invalid\nvalue'}],['unexpected',{}],['oci-vault',{MODE:'denied'}],['oci-vault',{MODE:'malformed'}],['oci-vault',{FIXTURE:'invalid\nvalue'}],['oci-vault',{OCI_SECRET_OCID_ADB_PASSWORD:''}]] as [string,Record<string,string>][]) {
   const result=await invoke(provider,overrides);expect(result.exitCode).toBe(1);expect(result.deployed).toBeNull()
   expect(result.output).toContain('Kamal was not started');expect(result.output).not.toContain('synthetic-provider-secret');expect(result.output).not.toContain('invalid\nvalue')
  }
 })
})
test('collection documentation stays public with stable feature routes',async()=>{
 for(const source of ['plugins/README.md','plugins/docs/architecture.md','plugins/approval/docs/guide.md'])expect(await documentPath(source)).toEndWith(source)
 for(const source of ['plugins/../private/guide.md','plugins/docs/../../private/guide.md','plugins/src/receipt.md'])await expect(documentPath(source)).rejects.toThrow()
 const manifest=JSON.parse(await readFile(new URL('../docs.manifest.json',import.meta.url),'utf8'))
 for(const id of ['approval','field-customization','admin']){
  expect(manifest.documents.find((doc:any)=>doc.source===`plugins/${id}/docs/index.md`)?.slug).toBe(`plugins/${id}/index`)
  expect(manifest.documents.find((doc:any)=>doc.source===`plugins/${id}/docs/api.md`)?.slug).toBe(`plugins/${id}/api`)
 }
 expect(manifest.documents.find((doc:any)=>doc.source==='plugins/docs/index.md')?.slug).toBe('plugins/index')
 expect(manifest.documents.find((doc:any)=>doc.source==='plugins/docs/api.md')?.slug).toBe('plugins/api')
})
