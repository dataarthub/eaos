import assert from 'node:assert/strict'
import { readFile,readdir } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { validateManifest,publicationOrder } from './release-contract.mjs'
import {fragmentTargets} from './release-notes.mjs'
const root=resolve(import.meta.dirname,'..')
export async function packages() {
  const result=[]
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
  for(const workspace of manifest.workspaces) {
    const directories=workspace.endsWith('/*')?(await readdir(join(root,workspace.slice(0,-2)),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>workspace.slice(0,-1)+entry.name):[workspace]
    for(const directory of directories.sort()) {
      const pkg=JSON.parse(await readFile(join(root,directory,'package.json'),'utf8'))
      result.push({...pkg,directory})
    }
  }
  return result
}
export function validateChangeset(text,entries,file='change record') {
  const targets=fragmentTargets(text,{minimumSummaryLength:30})
  for(const name of targets)assert.ok(entries.some(pkg=>pkg.name===name),`Unknown target: ${file}`)
}
if(process.argv[1]===import.meta.filename) {
  const entries=await packages()
  for(const pkg of entries) {
    assert.deepEqual(validateManifest(pkg),[],pkg.name)
    assert.equal(pkg.repository?.url,'git+https://github.com/dataarthub/eaos.git','Public source metadata')
    const changelog=await readFile(join(root,pkg.directory,'CHANGELOG.md'),'utf8')
    assert.ok(changelog.includes('## '),'Consumer history required')
    const readme=await readFile(join(root,pkg.directory,'README.md'),'utf8')
    assert.ok(readme.includes(`https://github.com/dataarthub/eaos/blob/main/${pkg.directory}/CHANGELOG.md`),'Visible npm-safe history link required')
  }
  const config=JSON.parse(await readFile(join(root,'.changeset/config.json'),'utf8'))
  assert.equal(config.access,'public')
  for(const file of (await readdir(join(root,'.changeset'))).filter(x=>x.endsWith('.md')&&x!=='README.md')) {
    const text=await readFile(join(root,'.changeset',file),'utf8')
    validateChangeset(text,entries,file)
  }
  const lock=await readFile(join(root,'bun.lock'),'utf8')
  assert.ok(!lock.includes('@dataarthub/'),'Private lock dependency')
  console.log('Public metadata, Changesets and dependency order verified:',publicationOrder(entries).map(x=>x.name).join(' -> '))
}
