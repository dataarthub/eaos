import {expect,test} from 'bun:test'
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildHostRuntime} from './build'
test('Host runtime build uses literal argument paths and an immutable release without provisioning',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos build '))
 try{
  await mkdir(join(root,'src'));await writeFile(join(root,'src/entry.ts'),'export const release=EAOS_BUILD_RELEASE;export const value=HOST_SETTING')
  const callbacks:string[]=[]
  await buildHostRuntime(root,{entry:'src/entry.ts',outdir:'output space',release:'candidate-1',define:{HOST_SETTING:JSON.stringify('literal; $(false)')},resources:[async context=>{callbacks.push(context.outdir);await writeFile(join(context.outdir,'resource.json'),'{}')}]})
  const source=await readFile(join(root,'output space/entry.js'),'utf8');expect(source).toContain('candidate-1');expect(source).toContain('literal; $(false)');expect(callbacks).toEqual([join(root,'output space')])
  let invoked=false
  for(const release of ['latest','../escape','version;false',''])await expect(buildHostRuntime(root,{entry:'src/entry.ts',outdir:'denied',release,resources:[async()=>{invoked=true}]})).rejects.toThrow('release')
  expect(invoked).toBe(false)
  await expect(buildHostRuntime(root,{entry:'../outside.ts',outdir:'denied',release:'v1'})).rejects.toThrow()
  await expect(buildHostRuntime(root,{entry:'src/entry.ts',outdir:'dist',release:'v1',resources:[async()=>{throw Error('Resource checksum mismatch')}]})).rejects.toThrow('Resource checksum mismatch')
 }finally{await rm(root,{recursive:true,force:true})}
})

test('multiple Host entrypoints retain the flat runtime filenames expected by generated images',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-flat-build-'))
 try{
  await mkdir(join(root,'src'));await mkdir(join(root,'scripts'))
  await writeFile(join(root,'src/server.ts'),'export const server=true');await writeFile(join(root,'scripts/setup.ts'),'export const setup=true')
  await buildHostRuntime(root,{entry:['src/server.ts','scripts/setup.ts'],outdir:'dist',release:'candidate-1'})
  expect(await readFile(join(root,'dist/server.js'),'utf8')).toContain('server')
  expect(await readFile(join(root,'dist/setup.js'),'utf8')).toContain('setup')
 }finally{await rm(root,{recursive:true,force:true})}
})
