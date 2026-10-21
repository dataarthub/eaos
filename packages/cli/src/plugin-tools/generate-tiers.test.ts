import {expect,test} from 'bun:test'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {generatePlugin} from './commands/generate-plugin'
import {inspectPlugin} from './inspect'
test('generator emits four distributable tier identities and fail-closed paid/tenant policy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-tiers-'))
 try{
  for(const tier of ['public','standard','pro','corporate']){
   await generatePlugin(root,{name:tier,...tier==='public'?{}:{tier},...tier==='corporate'?{allowedTenants:'tenant-a'}:{}})
   const pkg=JSON.parse(await readFile(join(root,'plugins',tier,'package.json'),'utf8'))
   expect(pkg.name).toBe(tier==='public'?'@alneas/eaos-plugin-public':tier==='standard'?'@dataarthub/plugin-standard':tier==='pro'?'@dataarthub/pro-pro':'corporate')
   expect(pkg.private??false).toBe(tier==='corporate')
   expect(await readFile(join(root,'plugins',tier,'manifest.ts'),'utf8')).toContain('entitlement: '+JSON.stringify(tier==='pro'?{tier,addonId:'addon-pro',metering:{unit:'request',defaultMonthlyQuota:0}}:tier==='corporate'?{tier,allowedTenants:['tenant-a']}:{tier}))
   expect(inspectPlugin(root,tier).issues.filter(i=>i.code==='source.unresolved')).toEqual([])
  }
  for(const options of [{tier:'corporate'},{tier:'pro',monthlyQuota:'-1'},{tier:'standard',addonId:'ignored'},{tier:'unknown'}])await expect(generatePlugin(root,{name:'invalid',...options})).rejects.toThrow()
 }finally{await rm(root,{recursive:true,force:true})}
})
