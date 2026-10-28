import assert from 'node:assert/strict'
import {generateFeatureRegistrations} from '@alneas/eaos-cli/platform'
import {createWorkspaceApi} from '@alneas/eaos-react/client'
import {composeWorkspacePages,type WorkspaceFactoryOptions,type WorkspaceBindingEnvironment} from '@alneas/eaos-react/workspace-binding'
import {createWorkspacePages as fields} from '@alneas/eaos-plugins/field-customization/workspace-binding'
import {manifest} from '@alneas/eaos-plugins/approval/manifest'

// Required factory ports remain required after packaging and declaration emission.
const factories={fields}
// @ts-expect-error the selected field factory requires explicit adopted resources
const missing:WorkspaceFactoryOptions<typeof factories>={}
const configured:WorkspaceFactoryOptions<typeof factories>={fields:{resources:[{id:'reports',label:'Reports'}]}}
void [missing,configured]
await generateFeatureRegistrations(import.meta.dirname,{descriptors:[{id:'approval',version:manifest.version,manifest:'@alneas/eaos-plugins/approval/manifest',lifecycle:{entry:'@alneas/eaos-plugins/approval/lifecycle',exportName:'lifecycle'},clients:[{target:'web',entry:'@alneas/eaos-plugins/approval/workspace',exportName:'ApprovalPage',path:'/plugins/approval/workspace',workspace:{entry:'@alneas/eaos-plugins/approval/workspace-binding',exportName:'createWorkspacePages',label:'業務画面'}}]}],selectedIds:['approval'],workspacePorts:{},outputs:{manifests:'generated/manifests.ts',lifecycle:'generated/lifecycle.ts',web:'generated/metadata.ts',bindings:'generated/bindings.ts'}})
// A runtime string keeps fixture compilation independent of files generated at execution time.
const bindingPath='./generated/bindings.ts'
const {createOfficialWorkspacePages,officialWorkspaceOptions}=await import(bindingPath)
const environment:WorkspaceBindingEnvironment={selectedIds:['approval'],api:createWorkspaceApi({endpoint:'/api/plugins'}),useIdentity:()=>null,query:{read:()=>'',replace:()=>{}}}
const pages=createOfficialWorkspacePages(environment,officialWorkspaceOptions)
assert.deepEqual(pages.map((page:{pluginId:string;path:string})=>({pluginId:page.pluginId,path:page.path})),[{pluginId:'approval',path:'/plugins/approval/workspace'}])
assert.throws(()=>composeWorkspacePages(environment,{approval:()=>[]},[{pluginId:'approval',routes:[{path:'/plugins/approval/workspace',label:'業務画面'}]}],{}))
assert.deepEqual(composeWorkspacePages({...environment,selectedIds:[]},{},[],{}),[])
console.log('Packed connected factory generation, required option types and exact route validation passed')
