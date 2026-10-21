/** Source JSDoc extraction shared by API rendering and its focused contract tests. */
export interface ApiJSDoc {
 summary:string
 parameters:Map<string,string>
 typeParameters:Map<string,string>
 returns:string
 examples:string[]
 remarks:string[]
 throws:string[]
 deprecated:string[]
 references:string[]
}
/** Resolve text through the compiler so inline links and multiline examples remain source-owned. */
export function readApiJSDoc(symbol:any,checker:any):ApiJSDoc {
 const text=(parts:any)=>typeof parts==='string'?parts:(parts??[]).map((part:any)=>part.text).join('')
 const docs:ApiJSDoc={summary:text(symbol.getDocumentationComment(checker)),parameters:new Map(),typeParameters:new Map(),returns:'',examples:[],remarks:[],throws:[],deprecated:[],references:[]}
 for(const tag of symbol.getJsDocTags(checker)){
  const value=text(tag.text).trim()
  if(tag.name==='param'||tag.name==='typeParam'||tag.name==='template'){
   const match=/^(\S+)\s*(?:-\s*)?([\s\S]*)$/.exec(value)
   if(match)(tag.name==='param'?docs.parameters:docs.typeParameters).set(match[1],match[2])
  }else if(tag.name==='returns'||tag.name==='return')docs.returns=value
  else if(tag.name==='example')docs.examples.push(value)
  else if(tag.name==='remarks')docs.remarks.push(value)
  else if(tag.name==='throws'||tag.name==='exception')docs.throws.push(value)
  else if(tag.name==='deprecated')docs.deprecated.push(value)
  else if(tag.name==='see')docs.references.push(value)
 }
 return docs
}
/** Render only documented contracts; absent tags remain visible to the separate completeness audit. */
export function renderJSDocDetails(docs:ApiJSDoc):string {
 let text=''
 if(docs.typeParameters.size)text+='### Type parameters\n\n'+[...docs.typeParameters].map(([name,description])=>`- \`${name}\`: ${description}`).join('\n')+'\n\n'
 for(const [title,values]of [['Remarks',docs.remarks],['Errors and rejections',docs.throws],['Deprecated',docs.deprecated],['See also',docs.references]] as const){
  if(values.length)text+=`### ${title}\n\n`+values.join('\n\n')+'\n\n'
 }
 return text
}

/** Resolve inline JSDoc references only when the generated reference contains a known target. */
export function rewriteJSDocLinks(text:string,targets:Map<string,string>):string {
 return text.replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*([^}]+))?\s*\}/g,(_all,name,label)=>{
  const target=targets.get(name)??targets.get(name.split('.')[0])
  return target?`[${label??name}](${target})`:'`'+(label??name)+'`'
 })
}

/** Include inline object contracts and union variants without expanding referenced types. */
export function publicJSDocMembers(ts:any,declaration:any):{node:any;name:string}[]{
 const result:{node:any;name:string}[]=[]
 const parameterName=(parameter:any,index:number)=>ts.isIdentifier(parameter.name)?parameter.name.getText():'argument'+(index+1)
 function typeMembers(type:any,prefix:string){
  if(!type)return
  if(ts.isTypeLiteralNode(type))members(type.members,prefix)
  else if(ts.isUnionTypeNode(type)||ts.isIntersectionTypeNode(type))for(const variant of type.types)typeMembers(variant,prefix)
  else if(ts.isParenthesizedTypeNode(type))typeMembers(type.type,prefix)
  else if(ts.isArrayTypeNode(type))typeMembers(type.elementType,prefix.replace(/\.$/,'')+'[].')
  else if(ts.isTypeOperatorNode(type))typeMembers(type.type,prefix)
  else if(ts.isTypeReferenceNode(type)&&['Array','ReadonlyArray'].includes(type.typeName.getText()))for(const argument of type.typeArguments??[])typeMembers(argument,prefix.replace(/\.$/,'')+'[].')
  else if(ts.isTypeReferenceNode(type))for(const argument of type.typeArguments??[])typeMembers(argument,prefix)
  else if(ts.isFunctionTypeNode(type)){
   for(const [index,parameter]of type.parameters.entries())typeMembers(parameter.type,prefix+parameterName(parameter,index)+'.')
   typeMembers(type.type,prefix+'result.')
  }
 }
 function members(values:readonly any[],prefix:string){
  for(const node of values){
   if(node.modifiers?.some((value:any)=>value.kind===ts.SyntaxKind.PrivateKeyword||value.kind===ts.SyntaxKind.ProtectedKeyword)||node.name&&ts.isPrivateIdentifier(node.name))continue
   const name=node.name?prefix+node.name.getText():undefined
   if(name){result.push({node,name});typeMembers(node.type,name+'.')}
   for(const [index,parameter]of (node.parameters??[]).entries())typeMembers(parameter.type,(name??prefix+'constructor')+'.'+parameterName(parameter,index)+'.')
  }
 }
 if(declaration?.members)members(declaration.members,'')
 else if(declaration&&ts.isTypeAliasDeclaration(declaration))typeMembers(declaration.type,'')
 const callable=declaration?.parameters?declaration:declaration?.initializer?.parameters?declaration.initializer:undefined
 if(callable){
  for(const [index,parameter]of callable.parameters.entries())typeMembers(parameter.type,parameterName(parameter,index)+'.')
  typeMembers(callable.type,'result.')
 }
 return result
}
