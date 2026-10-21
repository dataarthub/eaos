/** Generate API cards from the declarations emitted from canonical public source. */
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join,resolve,relative} from 'node:path'
import {publicPackages} from './public-packages'
import {readApiJSDoc,renderJSDocDetails,rewriteJSDocLinks,publicJSDocMembers} from './api-jsdoc'
const root=resolve(import.meta.dir,'..')
const outputArgument=process.argv.indexOf('--output-dir')
const outputRoot=outputArgument<0?root:resolve(process.argv[outputArgument+1]??'')
if(outputArgument>=0&&!process.argv[outputArgument+1])throw Error('--output-dir requires a directory')
const outputPath=(path:string)=>join(outputRoot,relative(root,path))
const ts=createRequire(join(root,'packages/core/package.json'))('typescript') as typeof import('typescript')
const printer=ts.createPrinter({removeComments:true})
const escape=(s:string)=>s.replaceAll('|','\\|').replaceAll('\n',' ')
const front=(title:string)=>`---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(title+': source-derived declarations, parameter tables, return types and public import examples.')}\nsidebar:\n  order: 30\narchetype: "reference"\nproject: "eaos-workspace"\ntags: ["api", "generated"]\n---\n\n`
const packageOwners=new Map(await Promise.all(publicPackages.map(async pkg=>[(await Bun.file(join(root,pkg.directory,'package.json')).json()).name,pkg.directory] as const)))
for(const pkg of publicPackages){
 const dir=join(root,pkg.directory),manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'))
 const entries=Object.entries(manifest.exports).flatMap(([key,value]:[string,any])=>{if(!value?.types)return[];const stem=value.types.replace(/^\.\/dist\//,'').replace(/\.d\.ts$/,'');const source=[join(dir,'src',stem+'.ts'),join(dir,'src',stem+'.tsx'),join(dir,stem+'.ts'),join(dir,stem+'.tsx')].find(existsSync);if(!source)throw Error('Missing source entrypoint: '+value.types);return[{specifier:manifest.name+(key==='.'?'':key.slice(1)),path:resolve(dir,value.types),source}]})
 const program=ts.createProgram(entries.flatMap(e=>[e.path,e.source]),{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.ReactJSX,skipLibCheck:true}),checker=program.getTypeChecker()
 let canonicalTargets=new Map<string,string>()
 const featureIds=pkg.id==='plugins'?[...new Set(entries.map(entry=>entry.specifier.slice(manifest.name.length+1).split('/')[0]))]:[]
 const outputs=featureIds.length?featureIds.map(id=>({path:`${id}/docs/api.md`,entries:entries.filter(entry=>entry.specifier===manifest.name+'/'+id||entry.specifier.startsWith(manifest.name+'/'+id+'/')),canonical:true,title:manifest.name+'/'+id,prefix:'./'+id})): [{path:'docs/api.md',entries,canonical:true,title:manifest.name,prefix:'.'},...(pkg.id==='server'?['db','lifecycle','storage'].map(topic=>({path:`docs/${topic}/docs/api.md`,entries:entries.filter(e=>e.specifier.startsWith(manifest.name+'/'+(topic==='lifecycle'?'lifecycle-engine':topic)))})):[]),...(pkg.id==='react'?[{path:'docs/client/docs/api.md',entries:entries.filter(e=>e.specifier.startsWith(manifest.name+'/client'))}]:[])].map(output=>({...output,canonical:output.path==='docs/api.md',title:manifest.name,prefix:'.'}))
 for(const output of outputs){
  const cards=new Map<string,{symbol:any;declarations:any[];imports:string[];name:string;sourceSymbol:any}>()
  for(const entry of [...output.entries].sort((a,b)=>a.specifier.length-b.specifier.length||a.specifier.localeCompare(b.specifier))){
   const source=program.getSourceFile(entry.path);if(!source)throw Error('Build declarations before generating API: '+entry.specifier)
   const module=checker.getSymbolAtLocation(source);if(!module){if(!source.text.trim()||source.text.trim().startsWith('#!'))continue;throw Error('Missing declaration module: '+entry.specifier)}
   const sourceModule=checker.getSymbolAtLocation(program.getSourceFile(entry.source)!);const actual=sourceModule?checker.getExportsOfModule(sourceModule):[]
   const built=checker.getExportsOfModule(module)
   for(const exported of actual){
    const original=exported.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(exported):exported
    const publicDeclaration=built.find(s=>s.name===exported.name)??built.find(s=>(s.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(s):s).name===original.name)
    if(!publicDeclaration)throw Error('Missing built public type: '+entry.specifier+':'+exported.name)
    const symbol=publicDeclaration.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(publicDeclaration):publicDeclaration
    const declarations=symbol.declarations??[];if(!declarations.length)throw Error('Unresolved public declaration: '+entry.specifier+':'+exported.name)
    const key=declarations.map((d:any)=>d.getSourceFile().fileName+':'+d.pos).join('|')+'#'+exported.name
    if(cards.has(key)){cards.get(key)!.imports.push(entry.specifier);continue}
    cards.set(key,{symbol,declarations,imports:[entry.specifier],name:exported.name,sourceSymbol:original})
   }
  }
  const entryRows=output.entries.map(e=>`| \`${e.specifier}\` | Typed public export |`)
  if(output.canonical)for(const [key,value] of Object.entries(manifest.exports))if(typeof value==='string'&&(output.prefix==='.'||key.startsWith(output.prefix+'/')))entryRows.push(`| \`${manifest.name+(key==='.'?'':key.slice(1))}\` | Packaged ${value.endsWith('.json')?'JSON contract/data':'Markdown guide'} asset; resolve this exported path with the host loader |`)
  let text=front(output.title+' API')+`<!-- Generated by scripts/generate-public-api.ts from built source declarations. Edit source JSDoc/types and regenerate; do not edit these cards. -->\n\n# ${output.title} API\n\n## Public entrypoints\n\n| Import | Contract |\n| --- | --- |\n`+entryRows.join('\n')+'\n\n'
  const targets=new Map([...cards.values()].map(card=>[card.name,'#api-'+card.name.replace(/[^A-Za-z0-9_-]/g,'-')]))
  if(output.canonical)canonicalTargets=new Map(targets)
  else for(const [name,anchor]of canonicalTargets)if(!targets.has(name))targets.set(name,relative(join(dir,output.path,'..'),join(dir,'docs/api.md'))+anchor)
  for(const card of [...cards.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.imports[0].localeCompare(b.imports[0]))){
   const declaration=card.declarations.find((d:any)=>!ts.isExportSpecifier(d))??card.declarations[0],source=declaration.getSourceFile()
   const typeOnly=!!(card.symbol.flags&(ts.SymbolFlags.Interface|ts.SymbolFlags.TypeAlias)),kind=ts.isClassDeclaration(declaration)?'CLASS':ts.isInterfaceDeclaration(declaration)?'INTERFACE':ts.isTypeAliasDeclaration(declaration)?'TYPE':ts.isEnumDeclaration(declaration)?'ENUM':ts.isFunctionDeclaration(declaration)||ts.isVariableDeclaration(declaration)&&declaration.type&&ts.isFunctionTypeNode(declaration.type)?'FUNCTION':'CONSTANT'
   const sourceFile=card.sourceSymbol.declarations?.[0]?.getSourceFile().fileName??''
   const upstream=!sourceFile.startsWith(dir+'/')||sourceFile.includes('/node_modules/')
   const upstreamPath=sourceFile.split('/node_modules/').at(-1)??''
   const upstreamName=upstreamPath.split('/').slice(0,upstreamPath.startsWith('@')?2:1).join('/')
   const upstreamOwner=packageOwners.get(upstreamName)
   const upstreamReference=upstreamOwner?`[the owning API reference](${relative(join(dir,output.path,'..'),join(root,upstreamOwner,'docs/api.md'))}#api-${card.sourceSymbol.name.replace(/[^A-Za-z0-9_-]/g,'-')})`:`the owning package \`${upstreamName}\``
   const docs=upstream?{summary:`Compatibility re-export; its implementation and documentation are owned by ${upstreamReference}.`,parameters:new Map<string,string>(),typeParameters:new Map<string,string>(),returns:'',examples:[],remarks:[],throws:[],deprecated:[],references:[]}:readApiJSDoc(card.sourceSymbol,checker);const description=docs.summary&&!/[\u3040-\u30ff\u3400-\u9fff]/.test(docs.summary)?docs.summary:`Public ${kind.toLowerCase()} exported by \`${card.imports[0]}\`.`
   let signature=card.declarations.filter((d:any)=>d.getSourceFile()===source).map((d:any)=>{
    if(ts.isClassDeclaration(d))d=ts.factory.updateClassDeclaration(d,d.modifiers,d.name,d.typeParameters,d.heritageClauses,d.members.filter((m:any)=>!m.modifiers?.some((v:any)=>v.kind===ts.SyntaxKind.PrivateKeyword||v.kind===ts.SyntaxKind.ProtectedKeyword)&&!ts.isPrivateIdentifier(m.name??ts.factory.createIdentifier('_'))))
    const printed=printer.printNode(ts.EmitHint.Unspecified,d,source)
    return ts.isVariableDeclaration(d)?'declare const '+printed+';':printed
   }).join('\n')
   if(/\/Volumes\/|\/Users\/|file:\/\//.test(signature))throw Error('Absolute path in public declaration: '+card.name)
   const call=ts.isFunctionDeclaration(declaration)?declaration:ts.isClassDeclaration(declaration)?declaration.members.find((m:any)=>ts.isConstructorDeclaration(m)):ts.isVariableDeclaration(declaration)&&declaration.type&&ts.isFunctionTypeNode(declaration.type)?declaration.type:undefined
   const parameters=call?.parameters??(ts.isInterfaceDeclaration(declaration)?declaration.members.filter((m:any)=>m.name):[])
   const sourceClass=card.sourceSymbol.declarations?.find((d:any)=>ts.isClassDeclaration(d))
   const sourceConstructor=sourceClass?.members.find((m:any)=>ts.isConstructorDeclaration(m))
   const constructorSignature=sourceConstructor?checker.getSignatureFromDeclaration(sourceConstructor):undefined
   const parameterDocs=constructorSignature&&!upstream?readApiJSDoc(constructorSignature,checker):docs
   const rows=parameters.map((p:any,index:number)=>{const name=p.name.getText(source),member=checker.getDeclaredTypeOfSymbol(card.sourceSymbol).getProperty?.(name)??checker.getSymbolAtLocation(p.name),description=upstream?'See the upstream owning declaration.':parameterDocs.parameters.get(name)??(!ts.isIdentifier(p.name)?[...parameterDocs.parameters.values()][index]:undefined)??(member?ts.displayPartsToString(member.getDocumentationComment(checker)):'');return `| \`${escape(name)}\` | \`${escape(p.type?printer.printNode(ts.EmitHint.Unspecified,p.type,source):'Declared member')}\` | ${p.questionToken||p.initializer?'No':'Yes'} | ${escape(description)||'Not documented in source.'} |`})
   const returns=call?.type?printer.printNode(ts.EmitHint.Unspecified,call.type,source):(kind==='CLASS'?card.name:typeOnly?'Type declaration; no runtime value.':'Declared constant value.')
   const binding=card.name==='default'?'publicValue':card.name
   const imported=card.name==='default'?`import ${binding} from '${card.imports[0]}'`:`import ${typeOnly?'type ':''}{ ${binding} } from '${card.imports[0]}'`
   const example=docs.examples.length?docs.examples.map(value=>/^```/m.test(value)?value+'\n':'```'+(card.sourceSymbol.declarations?.some((d:any)=>d.getSourceFile().fileName.endsWith('.tsx'))?'tsx':'typescript')+'\n'+value+'\n```').join('\n\n'):'See the owning declaration and linked feature guide for usage; no standalone example is documented in source.'
   const sourceDeclaration=card.sourceSymbol.declarations?.[0]
   const memberDocs=(upstream?[]:publicJSDocMembers(ts,sourceDeclaration)).map(({node:m,name:memberName})=>{
    const symbol=checker.getSymbolAtLocation(m.name);if(!symbol)return ''
    const member=readApiJSDoc(symbol,checker)
    const tags=symbol.getJsDocTags(checker).filter((tag:any)=>tag.name==='defaultValue').map((tag:any)=>ts.displayPartsToString(tag.text))
    const rows=[...member.parameters].map(([name,description])=>`- \`${name}\`: ${description}`).join('\n')
    const examples=member.examples.map(value=>/^```/m.test(value)?value:'```'+(m.getSourceFile().fileName.endsWith('.tsx')?'tsx':'typescript')+'\n'+value+'\n```').join('\n\n')
    return `#### \`${memberName}\`\n\n${member.summary||'Not documented in source.'}${tags.length?'\n\nDefault: '+tags.map(value=>'`'+value+'`').join('; ')+'.':''}${rows?'\n\nParameters:\n\n'+rows:''}${member.returns?'\n\nReturns: '+member.returns:''}\n\n${renderJSDocDetails(member)}${examples?'Example:\n\n'+examples+'\n\n':''}`
   }).filter(Boolean)
   const details=renderJSDocDetails(docs)+(constructorSignature?'### Constructor contract\n\n'+renderJSDocDetails(parameterDocs):'')+(memberDocs.length?'### Public members\n\n'+memberDocs.join('\n')+'\n\n':'')
   text+=`<a id="api-${card.name.replace(/[^A-Za-z0-9_-]/g,'-')}"></a>\n\n## [${kind}] \`${card.name}\`\n\n${rewriteJSDocLinks(description,targets)}\n\nImports: ${card.imports.map(v=>'`'+v+'`').join(', ')}.\n\n### Signature\n\n\`\`\`typescript\n${signature}\n\`\`\`\n\n### Parameters\n\n| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n${rows.length?rows.join('\n'):'| — | — | — | No call parameters. |'}\n\n### Returns\n\n${typeOnly?returns:'`'+escape(returns)+'`'}${docs.returns?'\n\n'+docs.returns:''}\n\n${rewriteJSDocLinks(details,targets)}### Example\n\n${example}\n\n`
  }
  if(process.argv.includes('--check')){if(await readFile(join(dir,output.path),'utf8')!==text)throw Error('Generated API reference is stale: '+output.path)}else{await mkdir(join(outputPath(join(dir,output.path)),'..'),{recursive:true});await writeFile(outputPath(join(dir,output.path)),text)}
  console.log(relative(root,join(dir,output.path)),cards.size,'API cards')
 }
 if(featureIds.length){
  const modules=featureIds.map(id=>`## [MODULE] \`${manifest.name}/${id}\`

See [the feature reference](../${id}/docs/api.md) and [feature overview](../${id}/docs/index.md).

### Signature

\`\`\`typescript
type PublicModule = typeof import('${manifest.name}/${id}/manifest')
\`\`\`

### Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| — | — | — | Importing metadata takes no call parameters. |

### Returns

The selected feature metadata namespace. Code selection does not activate a tenant.

### Example

\`\`\`typescript
import { manifest } from '${manifest.name}/${id}/manifest'

console.log(manifest.id, manifest.version)
\`\`\`
`).join('\n')
  const collection=front(manifest.name+' API')+'<!-- Generated from public collection exports; feature symbols remain scoped to their own reference. -->\n\n# '+manifest.name+' API\n\n## Public entrypoints\n\n| Import | Contract |\n| --- | --- |\n| `'+manifest.name+'/catalog.json` | Declarative feature discovery; does not load or activate a feature. |\n\n'+modules
  const path=join(dir,'docs/api.md')
  if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==collection)throw Error('Collection API catalog is stale')}else{await mkdir(join(outputPath(path),'..'),{recursive:true});await writeFile(outputPath(path),collection)}
 }
}
let catalog=front('EAOS public API catalog')+'<!-- Generated from public package manifests; detailed cards are owned by each package. -->\n\n# EAOS public API catalog\n\n'
for(const pkg of publicPackages){
 const manifest=JSON.parse(await readFile(join(root,pkg.directory,'package.json'),'utf8'))
 const specifier=manifest.name+(pkg.id==='cli'?'/baseline':pkg.id==='server'?'/lifecycle-engine':pkg.id==='plugins'?'/approval/manifest':pkg.foundation?'':'/manifest')
 catalog+=`## [MODULE] \`${manifest.name}\`\n\nSee [the complete reference](../${pkg.directory}/docs/api.md) and [package overview](../${pkg.directory}/docs/index.md).\n\n### Signature\n\n\`\`\`typescript\ntype PublicModule = typeof import('${specifier}')\n\`\`\`\n\n### Parameters\n\n| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n| — | — | — | Importing a module takes no call parameters. |\n\n### Returns\n\nThe public module namespace. Host-dependent functions require separately configured adapters.\n\n### Example\n\n\`\`\`typescript\nimport * as API from '${specifier}'\n\nconsole.log(Object.keys(API))\n\`\`\`\n\n`
}
const catalogPath=join(root,'docs/api.md')
if(process.argv.includes('--check')){if(await readFile(catalogPath,'utf8')!==catalog)throw Error('Public API catalog is stale')}else { await mkdir(join(outputPath(catalogPath),'..'),{recursive:true}); await writeFile(outputPath(catalogPath),catalog) }
