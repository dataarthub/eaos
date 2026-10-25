import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export async function sourceHash(root, ignored=new Set(['.git','.cache','.verification','node_modules','dist','artifacts','.DS_Store'])) {
  const hash=createHash('sha256')
  async function walk(dir) {
    for (const item of (await readdir(join(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (ignored.has(item.name)) continue
      const path=dir?dir+'/'+item.name:item.name
      if(item.isSymbolicLink())throw Error(`Source symlink is not supported: ${path}`)
      if(item.isDirectory())await walk(path)
      else { hash.update(path+'\0');hash.update(await readFile(join(root,path)));hash.update('\0') }
    }
  }
  await walk('');return hash.digest('hex')
}
export function candidateCommit(root) {
  try { return execFileSync('git',['rev-parse','--verify','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim() } catch { return null }
}
export function cleanCommit(root) {
  const commit=candidateCommit(root)
  if(!commit || execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()) throw Error('Final bundle requires an authorized clean source commit; working-tree preparation is available without it')
  return commit
}
