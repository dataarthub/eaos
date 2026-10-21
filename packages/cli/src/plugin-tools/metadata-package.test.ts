import {test,expect} from 'bun:test'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {generatePlugin} from './commands/generate-plugin'
import {inspectPlugin} from './inspect'
test('static metadata follows installed SDK build chunks without evaluating plugin or unknown provider code',async()=>{
 const root=await mkdtemp(join(process.cwd(),'.metadata-probe-'))
 try{
  await generatePlugin(root,{name:'schema-probe'})
  const tools=join(root,'plugins/schema-probe/src/mcp/tools.ts')
  await writeFile(tools,"import {eligibilityRequirementsSchema} from '@alneas/eaos-core/plugin-sdk'\nexport const tools=[{name:'schema_probe_get_data',parameters:eligibilityRequirementsSchema,handler:async()=>{throw Error('Must never run')}}]\n")
  const inspection=inspectPlugin(root,'schema-probe')
  expect(inspection.issues.filter(v=>v.code==='source.unresolved'||v.code==='tools.unresolved')).toEqual([])
  expect(inspection.tools[0].inputSchema?.properties).toHaveProperty('courses')
  await writeFile(tools,"import {schema} from 'untrusted-metadata-provider'\nexport const tools=[{name:'schema_probe_get_data',parameters:schema,handler:async()=>({})}]\n")
  expect(inspectPlugin(root,'schema-probe').issues.some(v=>v.message==='External metadata imports require runtime review')).toBe(true)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('private facades statically inspect canonical Public manifests without executing installed code',async()=>{
 const root=await mkdtemp(join(process.cwd(),'.metadata-public-'))
 try{
  await generatePlugin(root,{name:'public-probe'})
  const source=join(root,'plugins/public-probe/manifest.ts'),manifest=(await Bun.file(source).text()).replace(/^import .+\n/gm,'').replace(', createRoutes,',',').replace('mcp: { tools }','mcp: { tools: [] }').replace(/^ agentCapabilities:.+\n/gm,'')
  await rm(join(root,'plugins/public-probe/src/mcp/tools.ts'))
  const target=join(root,'node_modules/@alneas/eaos-plugins')
  await mkdir(target,{recursive:true})
  await writeFile(join(target,'package.json'),JSON.stringify({name:'@alneas/eaos-plugins',exports:{'./approval/manifest':{import:'./manifest.js'}}}))
  await writeFile(join(target,'manifest.js'),"throw new Error('Inspection must not execute installed code')\n"+manifest)
  await writeFile(source,"export {manifest} from '@alneas/eaos-plugins/approval/manifest'\n")
  expect(inspectPlugin(root,'public-probe').issues).toEqual([])
  await writeFile(source,"export {manifest} from 'untrusted-metadata-provider/manifest'\n")
  expect(inspectPlugin(root,'public-probe').issues.some(issue=>issue.code==='source.unresolved')).toBe(true)
 }finally{await rm(root,{recursive:true,force:true})}
})
