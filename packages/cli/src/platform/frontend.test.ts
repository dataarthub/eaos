import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { acquireFrontendArtifact, stageFrontendArtifacts } from './frontend'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eaos-frontend-'))
  async function artifact(id: string, route = '/business/' + id, navigation = true) {
    const folder = join(root, 'inputs', id)
    await mkdir(folder, { recursive: true })
    const source = 'export const Page = () => "fixture";' + (navigation ? ' export const webNavigation = { label: "Business" };' : '') + '\n'
    await writeFile(join(folder, 'index.js'), source)
    const inventory = { apiVersion: 1, owner: 'fixture-' + id, version: '1.0.0', runtime: 'index.js', functions: [], assets: [{ path: 'index.js', sha256: createHash('sha256').update(source).digest('hex') }], frontend: { pluginId: id, routes: [{ path: route, component: 'Page' }] } }
    const file = join(folder, 'deployment.json')
    await writeFile(file, JSON.stringify(inventory))
    return file
  }
  return { root, artifact, close: () => rm(root, { recursive: true, force: true }) }
}

test('verified acquisition repeats without activation and stages usable namespace exports', async () => {
  const f = await fixture()
  try {
    const file = await f.artifact('one')
    const first = await acquireFrontendArtifact(f.root, file)
    expect(first).toMatchObject({ acquired: 'fixture-one', verified: true, activated: false })
    expect(await acquireFrontendArtifact(f.root, file)).toEqual(first)
    const staged = await stageFrontendArtifacts(f.root, { output: 'web/private.js', reservedRoutes: ['/'] })
    expect(staged).toEqual({ pluginIds: ['one'], routes: ['/business/one'] })
    const module = await import(join(f.root, 'web/private.js'))
    expect(module.privatePages[0].component()).toBe('fixture')
    expect(module.privateNavigation[0].pluginId).toBe('one')
  } finally { await f.close() }
})

test('tampering and invalid config cannot replace selected configuration', async () => {
  const f = await fixture()
  try {
    const file = await f.artifact('one')
    await acquireFrontendArtifact(f.root, file)
    const config = await readFile(join(f.root, 'frontend.packages.json'), 'utf8')
    await writeFile(join(f.root, 'inputs/one/index.js'), 'tampered')
    await expect(acquireFrontendArtifact(f.root, file)).rejects.toThrow()
    expect(await readFile(join(f.root, 'frontend.packages.json'), 'utf8')).toBe(config)
    await writeFile(join(f.root, 'frontend.packages.json'), '{malformed')
    await expect(acquireFrontendArtifact(f.root, await f.artifact('two'))).rejects.toThrow()
    expect(await readFile(join(f.root, 'frontend.packages.json'), 'utf8')).toBe('{malformed')
  } finally { await f.close() }
})

test('conflicting and reserved routes do not replace the previous generated module', async () => {
  const f = await fixture()
  try {
    await acquireFrontendArtifact(f.root, await f.artifact('one'))
    await stageFrontendArtifacts(f.root, { output: 'web/private.js', reservedRoutes: [] })
    const previous = await readFile(join(f.root, 'web/private.js'), 'utf8')
    const config = await readFile(join(f.root, 'frontend.packages.json'), 'utf8')
    await expect(acquireFrontendArtifact(f.root, await f.artifact('two', '/business/one'))).rejects.toThrow('route')
    expect(await readFile(join(f.root, 'frontend.packages.json'), 'utf8')).toBe(config)
    await expect(stageFrontendArtifacts(f.root, { output: 'web/private.js', reservedRoutes: ['/business/one'] })).rejects.toThrow('route')
    expect(await readFile(join(f.root, 'web/private.js'), 'utf8')).toBe(previous)
  } finally { await f.close() }
})

test('symlink assets and an undeclared component export are rejected', async () => {
  const f = await fixture()
  try {
    const file = await f.artifact('one')
    await rm(join(f.root, 'inputs/one/index.js'))
    await writeFile(join(f.root, 'outside.js'), 'export const Page = 1')
    await symlink(join(f.root, 'outside.js'), join(f.root, 'inputs/one/index.js'))
    await expect(acquireFrontendArtifact(f.root, file)).rejects.toThrow()
    const other = await f.artifact('two')
    const inventory = JSON.parse(await readFile(other, 'utf8'))
    inventory.frontend.routes[0].component = 'Missing'
    await writeFile(other, JSON.stringify(inventory))
    await expect(acquireFrontendArtifact(f.root, other)).rejects.toThrow('export')
  } finally { await f.close() }
})

test('generated output cannot overwrite normalized immutable paths or the selected catalog', async () => {
  const f = await fixture()
  try {
    const acquired = await acquireFrontendArtifact(f.root, await f.artifact('one'))
    const runtime = `.eaos/frontend/${acquired.digest}/index.js`
    const before = await readFile(join(f.root, runtime), 'utf8')
    for (const output of [runtime, './' + runtime, 'frontend.packages.json', './frontend.packages.json']) {
      await expect(stageFrontendArtifacts(f.root, { output, reservedRoutes: [] })).rejects.toThrow()
    }
    expect(await readFile(join(f.root, runtime), 'utf8')).toBe(before)
    await expect(stageFrontendArtifacts(f.root, { output: 'web/private.js', reservedRoutes: [] })).resolves.toMatchObject({ pluginIds: ['one'] })
  } finally { await f.close() }
})

test('held operation locks and traversal fail without changing selected bytes', async () => {
  const f = await fixture()
  try {
    await acquireFrontendArtifact(f.root, await f.artifact('one'))
    const config = await readFile(join(f.root, 'frontend.packages.json'), 'utf8')
    await writeFile(join(f.root, '.eaos/frontend-register.lock'), 'other operation')
    await expect(acquireFrontendArtifact(f.root, await f.artifact('two'))).rejects.toThrow()
    await expect(stageFrontendArtifacts(f.root, { output: 'web/private.js', reservedRoutes: [] })).rejects.toThrow()
    expect(await readFile(join(f.root, 'frontend.packages.json'), 'utf8')).toBe(config)
    expect(await readFile(join(f.root, '.eaos/frontend-register.lock'), 'utf8')).toBe('other operation')
    await rm(join(f.root, '.eaos/frontend-register.lock'))
    await expect(stageFrontendArtifacts(f.root, { output: '../escape.js', reservedRoutes: [] })).rejects.toThrow()
    await writeFile(join(f.root, 'blocked'), 'file parent')
    await expect(stageFrontendArtifacts(f.root, { output: 'blocked/private.js', reservedRoutes: [] })).rejects.toThrow()
    expect(await readFile(join(f.root, 'frontend.packages.json'), 'utf8')).toBe(config)
  } finally { await f.close() }
})

test('registered mixed server/browser package stages its browser entry and explicit tenant scope',async()=>{
 const f=await fixture()
 try{
  const file=await f.artifact('one'),folder=join(file,'..')
  const inventory=JSON.parse(await readFile(file,'utf8'))
  const browser=await readFile(join(folder,'index.js'),'utf8')
  await writeFile(join(folder,'web.js'),browser)
  await writeFile(join(folder,'index.js'),'export const createExtension=()=>({});\n')
  inventory.assets=[{path:'web.js',sha256:createHash('sha256').update(browser).digest('hex')},{path:'index.js',sha256:createHash('sha256').update(await readFile(join(folder,'index.js'))).digest('hex')}]
  inventory.frontend.runtime='web.js'
  await writeFile(file,JSON.stringify(inventory))
  await writeFile(join(f.root,'eaos.platform.json'),JSON.stringify({packages:[{id:'fixture-one',inventory:'inputs/one/deployment.json',module:'inputs/one/index.js',pluginIds:['one'],tenantIds:['tenant-a']}]}))
  await stageFrontendArtifacts(f.root,{packageConfig:'eaos.platform.json',output:'web/private.js',reservedRoutes:[]})
  const module=await import(join(f.root,'web/private.js'))
  expect(module.privatePages[0].component()).toBe('fixture')
  expect(module.privatePages[0].tenantIds).toEqual(['tenant-a'])
 }finally{await f.close()}
})

test('optional navigation export does not break a strict generated TypeScript consumer',async()=>{
 const f=await fixture()
 try{
  await acquireFrontendArtifact(f.root,await f.artifact('no-nav','/business/no-nav',false))
  await stageFrontendArtifacts(f.root,{output:'web/private.ts',reservedRoutes:[]})
  await writeFile(join(f.root,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,allowJs:true,noEmit:true,skipLibCheck:true,types:[],target:'ES2022',module:'ESNext',moduleResolution:'bundler'},include:['web/private.ts']}))
  const result=Bun.spawnSync(['bun',join(import.meta.dirname,'../../../../node_modules/typescript/bin/tsc'),'--project',join(f.root,'tsconfig.json')])
  expect(result.stdout.toString()+result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
 }finally{await f.close()}
})
