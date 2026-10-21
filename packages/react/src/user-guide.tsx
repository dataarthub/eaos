import * as React from 'react'
import workspaceGuide from './workspace-guide.json'

/**
 * Supported inline text, code, emphasis and link nodes in static help documents.
 *
 * @see UserGuide for a complete host integration example.
 */
export type UserGuideInline =
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'text';
/**
 * Literal text rendered as escaped content.
 */
  text:string}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'code';
/**
 * Literal text rendered as escaped content.
 */
  text:string}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'strong';
/**
 * Ordered inline nodes rendered recursively.
 */
  children:readonly UserGuideInline[]}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'emphasis';
/**
 * Ordered inline nodes rendered recursively.
 */
  children:readonly UserGuideInline[]}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'link';
/**
 * Link target; only HTTP, HTTPS and mailto schemes render as anchors.
 */
  href:string;
/**
 * Ordered inline nodes rendered recursively.
 */
  children:readonly UserGuideInline[]}
/**
 * Supported help blocks; tables/lists contain structured child nodes rather than HTML.
 *
 * @see UserGuide for a complete host integration example.
 */
export type UserGuideBlock =
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'heading';
/**
 * Source heading level from 1 to 6; rendered one level deeper, capped at h6.
 */
  level:1|2|3|4|5|6;
/**
 * Ordered inline nodes rendered recursively.
 */
  children:readonly UserGuideInline[]}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'paragraph';
/**
 * Ordered inline nodes rendered recursively.
 */
  children:readonly UserGuideInline[]}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'list';
/**
 * True renders an ordered list; false renders a bullet list.
 */
  ordered:boolean;
/**
 * Ordered list items containing structured block nodes.
 */
  items:readonly (readonly UserGuideBlock[])[]}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'table';
/**
 * Table header cells containing inline node arrays.
 */
  header:readonly (readonly UserGuideInline[])[];
/**
 * Table body rows, each containing cells of inline nodes.
 */
  rows:readonly (readonly (readonly UserGuideInline[])[])[]}
 | {
/**
 * Discriminator selecting the supported node shape; raw HTML is not a variant.
 */
  type:'code';
/**
 * Literal text rendered as escaped content.
 */
  text:string;
/**
 * Optional code-language metadata; the renderer currently uses plain escaped code.
 */
  language?:string}
/**
 * Version-1 static help document with locale and structured blocks.
 *
 * @see UserGuide for a complete host integration example.
 */
export interface UserGuideDocument {
/**
 * Supported document discriminator; must equal 1.
 */
  schemaVersion:1;
/**
 * Static guide identity exposed through data-guide-id.
 */
  id:string;
/**
 * Language tag rendered on the guide element.
 */
  locale:string;
/**
 * Ordered structured document blocks; no raw executable HTML.
 */
  blocks:readonly UserGuideBlock[]}

function inline(nodes:readonly UserGuideInline[]):React.ReactNode[]{return nodes.map((node,key)=>{
 if(node.type==='text')return <React.Fragment key={key}>{node.text}</React.Fragment>
 if(node.type==='code')return <code key={key}>{node.text}</code>
 if(node.type==='strong')return <strong key={key}>{inline(node.children)}</strong>
 if(node.type==='emphasis')return <em key={key}>{inline(node.children)}</em>
 if(!/^(?:https?:\/\/|mailto:)/.test(node.href))return <React.Fragment key={key}>{inline(node.children)}</React.Fragment>
 return <a key={key} href={node.href}>{inline(node.children)}</a>
})}
function blocks(nodes:readonly UserGuideBlock[]):React.ReactNode[]{return nodes.map((node,key)=>{
 if(node.type==='paragraph')return <p key={key}>{inline(node.children)}</p>
 if(node.type==='heading')return React.createElement('h'+Math.min(6,node.level+1),{key},inline(node.children))
 if(node.type==='code')return <pre key={key} style={{overflowX:'auto'}}><code>{node.text}</code></pre>
 if(node.type==='list'){const items=node.items.map((item,i)=><li key={i}>{blocks(item)}</li>);return node.ordered?<ol key={key}>{items}</ol>:<ul key={key}>{items}</ul>}
 return <div key={key} style={{overflowX:'auto'}}><table style={{borderCollapse:'collapse',width:'100%'}}><thead><tr>{node.header.map((cell,i)=><th key={i} scope="col" style={{textAlign:'left',padding:8,borderBottom:'1px solid #888'}}>{inline(cell)}</th>)}</tr></thead><tbody>{node.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} style={{padding:8,verticalAlign:'top',borderBottom:'1px solid #aaa'}}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>
})}
/**
 * Renders structured repository-authored help as native HTML details without executing HTML content.
 *
 * Static repository-authored document data, never executable HTML or fetched tenant content.
 * @param props - Version-1 document, optional summary (default Japanese help title) and initiallyOpen flag (default false).
 * @returns A collapsible guide; unsupported link protocols render as plain inline content.
 * @throws Error for a document schemaVersion other than 1.
 *
 * @remarks
 * Requires React. The scrollable guide body is keyboard-focusable. Heading levels are shifted down by one, capped at h6. Pass trusted static document data, not tenant-authored executable content.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { UserGuide, type UserGuideDocument } from '@alneas/eaos-react/user-guide';
 * const document: UserGuideDocument = { schemaVersion: 1, id: 'sample', locale: 'en', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Select a record to begin.' }] }] };
 * export function Help() { return <UserGuide document={document} summary="Help"/>; }
 * ```
 */
export function UserGuide({document,summary='この画面の使い方・用語',initiallyOpen=false}:{
/**
 * Trusted static structured help document with schemaVersion 1.
 */
  document:UserGuideDocument;
/**
 * Details trigger caption; defaults to the bundled Japanese help title.
 */
  summary?:string;
/**
 * Whether the help starts expanded; defaults to false.
 */
  initiallyOpen?:boolean}){
 if(document.schemaVersion!==1)throw new Error('Unsupported user guide format')
 return <details open={initiallyOpen} data-guide-id={document.id} lang={document.locale} style={{margin:'16px 0',padding:16,border:'1px solid #999',borderRadius:8,maxWidth:'80ch'}}><summary style={{cursor:'pointer',fontWeight:600}}>{summary}</summary><article tabIndex={0} aria-label="利用ガイド" style={{lineHeight:1.8,overflowWrap:'anywhere',maxHeight:'70vh',overflowY:'auto',paddingRight:8}}>{blocks(document.blocks)}</article></details>
}

/**
 * Bundled static Japanese guide for the generic workspace controls.
 *
 * @see UserGuide for a complete host integration example.
 */
export const coreWorkspaceGuide = workspaceGuide as UserGuideDocument
/**
 * Renders the bundled core workspace guide in a collapsible help panel.
 * @returns A UserGuide element using the bundled Japanese workspace guide.
 *
 * @remarks
 * Requires React; no host data is fetched.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { CoreWorkspaceHelp } from '@alneas/eaos-react/user-guide';
 * export function Help() { return <CoreWorkspaceHelp/>; }
 * ```
 */
export function CoreWorkspaceHelp(){return <UserGuide document={coreWorkspaceGuide}/>}
