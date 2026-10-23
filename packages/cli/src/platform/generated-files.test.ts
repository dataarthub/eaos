import {expect,test} from 'bun:test'
import {mkdtemp,mkdir,readFile,readdir,rename,rm,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {writeGeneratedFiles} from './generated-files'

test('check_missing_directory_makes_no_files and unsafe paths fail without writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-generated-'))
 try{
  await expect(writeGeneratedFiles(root,[{path:'missing/a.ts',text:'one'}],true)).rejects.toThrow('Stale')
  expect(await readdir(root)).toEqual([])
  await symlink(tmpdir(),join(root,'escape'))
  for(const path of ['../escape.ts','escape/a.ts','.eaos/feature-register.lock'])await expect(writeGeneratedFiles(root,[{path,text:'one'}])).rejects.toThrow()
 }finally{await rm(root,{recursive:true,force:true})}
})
test('replacement_failure_restores_full_set and concurrent_loser_never_rolls_back_winner',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-generated-'))
 try{
  const files=[{path:'a.ts',text:'one'},{path:'b.ts',text:'two'}]
  await writeGeneratedFiles(root,files)
  const before=await Promise.all(files.map(file=>readFile(join(root,file.path),'utf8')))
  let calls=0
  await expect(writeGeneratedFiles(root,files.map(file=>({...file,text:'changed'})),false,{rename:async(from,to)=>{if(++calls===2)throw Error('injected');await rename(from,to)}})).rejects.toThrow('injected')
  expect(await Promise.all(files.map(file=>readFile(join(root,file.path),'utf8')))).toEqual(before)
  await writeFile(join(root,'.eaos/feature-register.lock'),'winner',{flag:'wx'})
  await expect(writeGeneratedFiles(root,files)).rejects.toThrow()
  expect(await readFile(join(root,'.eaos/feature-register.lock'),'utf8')).toBe('winner')
  expect(await Promise.all(files.map(file=>readFile(join(root,file.path),'utf8')))).toEqual(before)
  expect((await readdir(root)).filter(name=>name.includes('.new-'))).toEqual([])
 }finally{await rm(root,{recursive:true,force:true})}
})
test('unmanaged and edited outputs are rejected before any replacement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-generated-'))
 try{
  await writeFile(join(root,'a.ts'),'handwritten')
  await expect(writeGeneratedFiles(root,[{path:'a.ts',text:'new'},{path:'b.ts',text:'new'}])).rejects.toThrow('edited')
  expect(await readFile(join(root,'a.ts'),'utf8')).toBe('handwritten')
  await expect(readFile(join(root,'b.ts'))).rejects.toThrow()
 }finally{await rm(root,{recursive:true,force:true})}
})
