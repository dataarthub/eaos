import {readFile,realpath} from 'node:fs/promises'
import {resolve,dirname,relative,posix} from 'node:path'
export const publicRoot=resolve(import.meta.dir,'..')
export interface PublicDoc {title:string;slug:string;source:string;sourceJa?:string;visibility:'public';archetype:'tutorial'|'how-to'|'reference'|'explanation'}
export interface DocsManifest {projectId:string;displayName:string;documents:PublicDoc[]}
export function frontmatter(markdown:string){
 const match=/^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);if(!match)throw Error('Missing frontmatter')
 const field=(name:string)=>match[1].match(new RegExp('^'+name+': (.+)$','m'))?.[1]
 const string=(name:string)=>{const value=field(name);if(!value)throw Error('Missing frontmatter '+name);const parsed=JSON.parse(value);if(typeof parsed!=='string'||!parsed.trim())throw Error('Invalid frontmatter '+name);return parsed}
 const metadata={title:string('title'),description:string('description'),archetype:string('archetype'),project:string('project')}
 if(!/^sidebar:\n  order: \d+/m.test(match[1])||!/^tags: \[.+\]$/m.test(match[1]))throw Error('Missing sidebar order/tags')
 return{...metadata,body:markdown.slice(match[0].length)}
}
export function securityErrors(text:string){return [
 [/\/Volumes\/|\/Users\/|file:\/\//i,'local filesystem path'],
 [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_]{20,}/,'credential'],
 [/\bocid1\.|\b(?:kankyo|tkc)\b|internal\.alneas\.org/i,'real host or customer setting'],
 [/(?:password|token|secret)\s*[:=]\s*["'][^"'${}<>\n]{12,}["']/i,'literal credential assignment'],
 ].filter(([pattern])=>(pattern as RegExp).test(text)).map(([,label])=>label as string)}
/** Runtime literals and identifiers keep their spelling even when the surrounding prose is English. */
export function hasJapaneseProse(markdown:string){return /[\u3040-\u30ff\u3400-\u9fff]/.test(markdown.replace(/```[^\n]*\n[\s\S]*?```/g,'').replace(/`[^`\n]+`/g,''))}
export async function documentPath(source:string){
 if(!source.endsWith('.md')||source.includes('\\')||source.startsWith('/')||source.split('/').includes('..')||!(/^(?:(?:README(?:\.ja)?|CONTRIBUTING|RELEASING)\.md|docs\/|packages\/[^/]+\/(?:README|docs\/)|plugins\/(?:README\.md|docs\/|[^/]+\/(?:README|docs\/)))/.test(source)))throw Error('Forbidden documentation source: '+source)
 const path=await realpath(resolve(publicRoot,source));if(!path.startsWith(publicRoot+'/'))throw Error('Documentation source escaped public ownership')
 return path
}
export async function loadManifest():Promise<DocsManifest>{return JSON.parse(await readFile(resolve(publicRoot,'docs.manifest.json'),'utf8'))}
export function documentMap(manifest:DocsManifest){const map=new Map<string,PublicDoc>();for(const doc of manifest.documents){map.set(doc.source,doc);if(doc.sourceJa)map.set(doc.sourceJa,doc)}return map}
export function documentLinks(markdown:string){return [...markdown.replace(/```[^\n]*\n[\s\S]*?```/g,'').matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)].map(v=>v[1])}
export function resolveDocumentLink(source:string,target:string,map:Map<string,PublicDoc>){
 if(/^(?:https?:|mailto:|#)/i.test(target))return null
 if(target.startsWith('/')||/^[a-z]+:/i.test(target))throw Error('Use registered relative source links: '+target)
 const [path,fragment]=target.split('#'),resolved=posix.normalize(posix.join(posix.dirname(source),decodeURIComponent(path)))
 const doc=map.get(resolved);if(!doc)throw Error('Unregistered public link '+source+' -> '+target)
 return{doc,fragment}
}
export async function verifyDocumentation(){
 const manifest=await loadManifest(),routes=new Set<string>(),sources=new Set<string>(),map=documentMap(manifest);let translations=0,cards=0
 if(manifest.projectId!=='eaos-workspace'||!manifest.documents.length)throw Error('Invalid public documentation manifest')
 for(const doc of manifest.documents){
  if(doc.visibility!=='public'||!['tutorial','how-to','reference','explanation'].includes(doc.archetype)||!/^([a-z0-9-]+\/)*[a-z0-9-]+$/.test(doc.slug)||routes.has(doc.slug)||sources.has(doc.source))throw Error('Invalid, duplicate or non-public document: '+doc.source)
  routes.add(doc.slug);sources.add(doc.source)
  for(const [locale,source]of [['en',doc.source],...(doc.sourceJa?[['ja',doc.sourceJa]]:[])] as [string,string][]){
   const text=await readFile(await documentPath(source),'utf8'),meta=frontmatter(text),errors=securityErrors(text)
   if(errors.length)throw Error(source+': '+errors.join(', '))
   if(meta.archetype!==doc.archetype||meta.project!==manifest.projectId)throw Error('Frontmatter differs from manifest: '+source)
   if(locale==='ja')translations++
   const prose=meta.body.replace(/```[^\n]*\n[\s\S]*?```/g,'')
   if(locale==='en'&&hasJapaneseProse(meta.body))throw Error('English canonical root contains Japanese prose: '+source)
   if((prose.match(/^# /gm)??[]).length!==1)throw Error('Expected one H1: '+source)
   const fences=[...meta.body.matchAll(/^```([^\n]*)$/gm)];for(let i=0;i<fences.length;i+=2)if(!/^[a-z][a-z0-9-]*$/i.test(fences[i][1]))throw Error('Unlabelled code fence: '+source)
   for(const link of documentLinks(meta.body))resolveDocumentLink(source,link,map)
   const isLanding=source.endsWith('README.md')||source.endsWith('README.ja.md')||(JSON.parse(await readFile(resolve(publicRoot,'readme-landings.json'),'utf8')) as {output:string}[]).some(item=>item.output===source)
   const required=isLanding?(locale==='en'?['Elevator Pitch','Why & Value','Key Highlights','Quickstart','Next Steps']:['概要','目的と利点','主な機能','クイックスタート','次の手順']):doc.archetype==='how-to'?(locale==='en'?['Prerequisites','Step-by-Step Implementation','Verification','Troubleshooting']:['前提条件','手順','確認方法','問題が起きたとき']):doc.archetype==='explanation'?(locale==='en'?['Motivation','Architectural Diagram','Trade-offs & Decisions']:['背景と目的','構成図','トレードオフと判断']):[]
   let previous=-1;for(const title of required){const index=meta.body.indexOf('## '+title);if(index<=previous)throw Error('Missing/out-of-order '+title+': '+source);previous=index}
   if(doc.archetype==='explanation'&&!isLanding&&!meta.body.includes('```mermaid'))throw Error('Missing architecture diagram: '+source)
   if(doc.archetype==='reference'){
    const sections=meta.body.split(/^## \[/m).slice(1);if(!sections.length)throw Error('Missing generated API cards: '+source)
    for(const card of sections)for(const part of ['### Signature','### Parameters','### Returns','### Example'])if(!card.includes(part))throw Error('Incomplete API card '+part+': '+source)
    if(locale==='en')cards+=sections.length
   }
   if(locale==='ja'){
    const canonical=await readFile(await documentPath(doc.source),'utf8')
    const snippets=(value:string)=>[...value.matchAll(/```[^\n]*\n[\s\S]*?```/g)].map(match=>match[0])
    if(JSON.stringify(snippets(canonical))!==JSON.stringify(snippets(text)))throw Error('Japanese code snippets differ from canonical source: '+source)
   }
  }
 }
 return{status:'succeeded',englishPages:manifest.documents.length,japaneseSources:translations,englishFallbackPages:manifest.documents.length-translations,apiCards:cards,publicOnly:true}
}
if(import.meta.main)console.log(JSON.stringify(await verifyDocumentation(),null,2))
