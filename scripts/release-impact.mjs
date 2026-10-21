import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { packages as loadPackages } from './check-public.mjs'
export function releaseImpactErrors({packages,files,targets,rationale=''}) {
  if(rationale.trim().length>=40)return [] // Presence only; reviewers must approve the reasoning.
  const owners=new Set()
  for(const file of files) {
    if(file.startsWith('.changeset/'))continue
    const owner=packages.find(pkg=>file.startsWith(pkg.directory+'/'))
    if(owner)owners.add(owner.name)
    else for(const pkg of packages)owners.add(pkg.name) // Unknown/shared inputs: conservative.
  }
  for(let changed=true;changed;) {
    changed=false
    for(const pkg of packages)if(!owners.has(pkg.name)&&['dependencies','peerDependencies','optionalDependencies'].some(field=>Object.keys(pkg[field]??{}).some(name=>owners.has(name)))){owners.add(pkg.name);changed=true}
  }
  const missing=[...owners].filter(name=>!targets.includes(name))
  return missing.length?['New release-impact notes missing for '+missing.join(', ')+'; add affected Changesets or an explicit No-release rationale for human review']:[]
}
if(process.argv[1]===import.meta.filename) {
  const event=process.env.GITHUB_EVENT_PATH?JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8')):null
  const base=process.argv[2]??event?.pull_request?.base?.sha
  if(!base) {
    console.log('Release-impact baseline not supplied; fragment syntax is checked locally. PR coverage requires check:release-impact <base-sha> or PR event evidence.')
  } else {
    if(!/^[a-f0-9]{40}$/.test(base))throw Error('Use a full reviewed Git baseline SHA')
    const files=execFileSync('git',['diff','--name-only','--no-renames',base+'...HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)
    const targets=[]
    for(const file of files.filter(file=>/^\.changeset\/[^/]+\.md$/.test(file)&&file!=='.changeset/README.md')) {
      let text
      try{text=await readFile(file,'utf8')}catch(error){if(error.code==='ENOENT')continue;throw error}
      const header=text.match(/^---\n([\s\S]+?)\n---/)
      for(const match of header?.[1].matchAll(/^"([^"]+)": (patch|minor|major)$/gm)??[])targets.push(match[1])
    }
    const rationale=(event?.pull_request?.body??'').match(/^### No-release rationale\s*\n([\s\S]*?)(?=^### |$(?![\s\S]))/m)?.[1]?.replace(/<!--[\s\S]*?-->/g,'').trim()??''
    const errors=releaseImpactErrors({packages:await loadPackages(),files,targets,rationale})
    if(errors.length)throw Error(errors.join('\n'))
    console.log('Release-impact record present; target/increment/consumer impact and no-release reasoning still require human review.')
  }
}
