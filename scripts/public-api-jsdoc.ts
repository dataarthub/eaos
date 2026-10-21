/** Structural inventory of owned declarations reachable through the public package export maps. */
import {createRequire} from 'node:module'
import {existsSync} from 'node:fs'
import {mkdir,writeFile} from 'node:fs/promises'
import {join,resolve,relative,dirname} from 'node:path'
import {publicPackages} from './public-packages'
import {readApiJSDoc,publicJSDocMembers} from './api-jsdoc'
const defaultRoot=resolve(import.meta.dir,'..')
const ts=createRequire(join(defaultRoot,'packages/core/package.json'))('typescript') as typeof import('typescript')
export interface PublicApiJSDocRecord {package:string;name:string;file:string;line:number;imports:string[];kind:string;issues:string[];examples:string[]}
/** Enumerate canonical owned symbols once; external package declarations remain owned upstream. */
export async function auditPublicApiJSDoc(options:{root?:string;packages?:{id:string;directory:string}[]}={}){
 const root=options.root??defaultRoot,targets=options.packages??publicPackages
 const records:PublicApiJSDocRecord[]=[],external=new Set<string>()
 for(const pkg of targets){
  const dir=join(root,pkg.directory),manifest=await Bun.file(join(dir,'package.json')).json()
  const entries=Object.entries(manifest.exports).flatMap(([path,target]:[string,any])=>{
   if(!target?.types)return[]
   const stem=target.types.replace(/^\.\/dist\//,'').replace(/\.d\.ts$/,'')
   const source=[join(dir,'src',stem+'.ts'),join(dir,'src',stem+'.tsx'),join(dir,stem+'.ts'),join(dir,stem+'.tsx')].find(existsSync)
   if(!source)throw Error('Missing public source: '+manifest.name+path)
   return[{path:manifest.name+(path==='.'?'':path.slice(1)),source}]
  })
  const program=ts.createProgram(entries.map(e=>e.source),{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.ReactJSX,skipLibCheck:true}),checker=program.getTypeChecker(),seen=new Map<string,PublicApiJSDocRecord>()
  function inspect(node:any,symbol:any,name:string,entry:string,parentDocs?:ReturnType<typeof readApiJSDoc>){
   const file=node.getSourceFile().fileName,key=file+':'+node.pos
   if(seen.has(key)){const item=seen.get(key)!;if(!item.imports.includes(entry))item.imports.push(entry);return}
   const docs=symbol?readApiJSDoc(symbol,checker):{summary:'',parameters:new Map(),typeParameters:new Map(),returns:'',examples:[],remarks:[],throws:[],deprecated:[],references:[]},issues:string[]=[]
   const ownComment=ts.getJSDocCommentsAndTags(node).find((value:any)=>ts.isJSDoc(value)) as any
   if(!docs.summary&&ownComment?.comment)docs.summary=typeof ownComment.comment==='string'?ownComment.comment:ownComment.comment.map((v:any)=>v.text??'').join('')
   if(!docs.summary.trim())issues.push('summary')
   const call=ts.isVariableDeclaration(node)&&(ts.isArrowFunction(node.initializer??node)||ts.isFunctionExpression(node.initializer??node))?node.initializer:node
   const callable=ts.isFunctionDeclaration(call)||ts.isMethodDeclaration(call)||ts.isMethodSignature(call)||ts.isConstructorDeclaration(call)||ts.isArrowFunction(call)||ts.isFunctionExpression(call)||ts.isGetAccessorDeclaration(call)||ts.isSetAccessorDeclaration(call)
   if(callable){
    for(const parameter of call.parameters??[]){const pname=parameter.name.getText();if(ts.isIdentifier(parameter.name)?!docs.parameters.has(pname):docs.parameters.size<(call.parameters?.length??0))issues.push('param:'+pname)}
    if(!ts.isConstructorDeclaration(call)&&!docs.returns)issues.push('returns')
    const example=docs.examples.length||(ts.isConstructorDeclaration(call)&&parentDocs?.examples.length)
    if(!example)issues.push('example')
   }else if(ts.isClassDeclaration(node)&&!docs.examples.length)issues.push('example')
   for(const parameter of call.typeParameters??node.typeParameters??[])if(!docs.typeParameters.has(parameter.name.text))issues.push('typeParam:'+parameter.name.text)
   const usageReference=docs.examples.length||docs.references.length||/\{@link\b|\[[^\]]+\]\([^)]+\)/.test(ownComment?.getText()??'')
   if(!parentDocs&&!callable&&!ts.isClassDeclaration(node)&&!usageReference)issues.push('usageReference')
   const item:PublicApiJSDocRecord={package:manifest.name,name,file:relative(root,file),line:node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line+1,imports:[entry],kind:ts.SyntaxKind[node.kind],issues,examples:docs.examples}
   seen.set(key,item)
   const members=node.members??(ts.isTypeAliasDeclaration(node)?typeMembers(node.type):[])
   for(const member of members??[]){
    if(member.modifiers?.some((mod:any)=>mod.kind===ts.SyntaxKind.PrivateKeyword||mod.kind===ts.SyntaxKind.ProtectedKeyword)||member.name&&ts.isPrivateIdentifier(member.name))continue
    if(ts.isIndexSignatureDeclaration(member)||ts.isCallSignatureDeclaration(member))continue
    const memberName=member.name?.getText()??'constructor',memberSymbol=member.name?checker.getSymbolAtLocation(member.name):undefined
    // Constructor documentation is attached to its declaration, not a named symbol.
    let resolved=memberSymbol
    if(!resolved&&ts.isConstructorDeclaration(member))resolved={getDocumentationComment:()=>[],getJsDocTags:()=>ts.getJSDocTags(member).map((tag:any)=>({name:tag.tagName.text,text:[{text:(tag.name?.getText()?tag.name.getText()+' ':'')+(typeof tag.comment==='string'?tag.comment:'')}]}))}
    inspect(member,resolved,name+'.'+memberName,entry,docs)
   }
   for(const member of publicJSDocMembers(ts,node)){
    inspect(member.node,checker.getSymbolAtLocation(member.node.name),name+'.'+member.name,entry,docs)
   }
  }
  function typeMembers(type:any):any[]{if(ts.isTypeLiteralNode(type))return[...type.members];if(ts.isUnionTypeNode(type)||ts.isIntersectionTypeNode(type))return type.types.flatMap(typeMembers);return[]}
  for(const entry of entries.sort((a,b)=>a.path.length-b.path.length)){
   const sf=program.getSourceFile(entry.source)!,module=checker.getSymbolAtLocation(sf);if(!module)continue
   for(const exported of checker.getExportsOfModule(module)){
    const symbol=exported.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(exported):exported
    for(const declaration of symbol.declarations??[]){
     const file=declaration.getSourceFile().fileName
     if(!file.startsWith(dir+'/')||file.includes('/node_modules/')||file.includes('/dist/')){external.add(manifest.name+':'+exported.name);continue}
     inspect(declaration,symbol,exported.name,entry.path)
    }
   }
  }
  records.push(...seen.values())
 }
 const packages=targets.map(pkg=>{const list=records.filter(r=>r.file.startsWith(pkg.directory+'/'));return{id:pkg.id,declarationsAndMembers:list.length,withIssues:list.filter(r=>r.issues.length).length,issues:list.reduce((n,r)=>n+r.issues.length,0)}})
 return{schemaVersion:1,scope:'canonical declarations reachable through typed package exports',structuralOnly:true,semanticReview:'Requires implementation/test review; tags alone cannot prove behavior, error completeness or valid examples.',packages,externalReferences:external.size,externalReExports:[...external].sort(),records}
}
export async function runPublicApiAudit(){
 const result=await auditPublicApiJSDoc(),out=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)
 if(out){const path=resolve(out);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(result,null,2)+'\n')}
 console.log(JSON.stringify({packages:result.packages,externalReferences:result.externalReferences,structuralOnly:true},null,2))
 if(process.argv.includes('--check')&&result.records.some(r=>r.issues.length))process.exitCode=1
}

if(import.meta.main)await runPublicApiAudit()
