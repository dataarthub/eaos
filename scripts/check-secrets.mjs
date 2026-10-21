import { existsSync } from 'node:fs'
import { mkdtemp,cp,rm,mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gitleaksVersion,localGitleaks } from './quality-tools.mjs'
const root=resolve(import.meta.dirname,'..')
const binary=process.env.EAOS_GITLEAKS_BINARY || (existsSync(localGitleaks)?localGitleaks:'gitleaks')
const version=spawnSync(binary,['version'],{encoding:'utf8',timeout:10000})
if(version.status!==0 || version.stdout.trim()!==gitleaksVersion)throw Error(`Verified Gitleaks ${gitleaksVersion} required; run bun run secrets:setup`)
await mkdir(join(root,'.verification/logs'),{recursive:true})
const temporary=await mkdtemp(join(tmpdir(),'eaos-secret-scan-'))
try {
  await cp(root,temporary,{recursive:true,filter:path=>!path.slice(root.length).split(/[\\/]/).some(x=>['node_modules','.git','.verification','dist','artifacts','.DS_Store'].includes(x))})
  const args=process.argv.includes('--history')?['git','--log-opts=--all',root]:['dir',temporary]
  const scan=spawnSync(binary,[...args,'--redact=100','--no-banner','--config',join(root,'.gitleaks.toml'),'--report-format=json','--report-path',join(root,'.verification/logs/secrets.json')],{stdio:'inherit'})
  if(scan.status!==0)process.exitCode=scan.status??2
} finally { await rm(temporary,{recursive:true,force:true}) }
