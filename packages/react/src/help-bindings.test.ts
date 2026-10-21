import {test,expect} from 'bun:test'
import {readFile} from 'node:fs/promises'
import document from './workspace-guide.json'
test('public Core screens retain shared in-app help and the canonical Markdown source',async()=>{
 for(const entry of ['record-workspace','command-workspace','workspace-layout','workspace-login']){
  const source=await readFile(new URL('./'+entry+'.tsx',import.meta.url),'utf8')
  expect(source).toContain('user-guide')
  expect(source).toMatch(/<(?:CoreWorkspaceHelp|UserGuide)\b/)
 }
 const guide=await readFile(new URL('../docs/user-guides/workspace.md',import.meta.url),'utf8')
 expect(guide).toContain('# ')
 expect(JSON.stringify(document)).toContain('core-workspace')
})
