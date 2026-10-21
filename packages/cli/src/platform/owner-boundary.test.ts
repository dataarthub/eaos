import {test,expect} from 'bun:test'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {generatePlatform} from './index'
test('installed inventory owners cannot select parent paths or arbitrary files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-public-owner-'))
 try{
  await writeFile(join(root,'package.json'),'{"name":"owner-boundary","private":true}')
  for(const owner of ['.','..','@scope/..','@scope/name/../../secret']){
   await writeFile(join(root,'eaos.platform.json'),JSON.stringify({platform:{appName:'owner-test',baseDomain:'example.test',environment:'development'},packages:[],deployment:{images:{backend:'example/api:1',frontend:'example/web:1'},placements:{destinations:[{id:'api',placement:'host',service:'backend',revision:'1'}],plugins:[{owner,pluginId:'notes',components:{api:['api']}}]}}}))
   await expect(generatePlatform(root)).rejects.toThrow('installed npm package')
  }
 }finally{await rm(root,{recursive:true,force:true})}
})
