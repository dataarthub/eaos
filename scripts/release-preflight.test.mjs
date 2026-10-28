import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registryPreflight } from './release-preflight.mjs'

const core = { name: '@alneas/eaos-core', version: '0.1.0', directory: 'packages/core' }
const server = { name: '@alneas/eaos-server', version: '0.1.0', directory: 'packages/server', dependencies: { [core.name]: '^0.1.0' } }
const integrity = 'sha512-'+Buffer.alloc(64, 1).toString('base64')
const otherIntegrity = 'sha512-'+Buffer.alloc(64, 2).toString('base64')
const archive = pkg => ({name: pkg.name, version: pkg.version, integrity, requiredTags: ['beta','latest']})
const metadata = (name, versions = ['0.1.0'], tags = {}) => ({name, versions: Object.fromEntries(versions.map(version => [version, {name, version, dist: {integrity}}])), 'dist-tags': tags})
function transport(data, inspect = () => {}) {
  return async (url, options) => {
    inspect(url, options)
    const value = data[decodeURIComponent(new URL(url).pathname.slice(1))]
    if (value instanceof Error) throw value
    return new Response(JSON.stringify(value ?? {error: 'Not found'}), {status: typeof value === 'number' ? value : value ? 200 : 404})
  }
}
const run = (data = {}, extra = {}, packages = [core]) => registryPreflight({packages, archives: packages.map(archive), fetch: transport(data), ...extra})

test('missing bootstrap package requires maintainer confirmation and never proves ownership', async () => {
  const report = await run()
  assert.equal(report.ok, true)
  assert.equal(report.targets[0].status, 'maintainer-confirmation-required')
  assert.deepEqual(report.maintainerConfirmationRequired, [core.name])
})
test('every query uses public npm HTTPS GET without authorization or redirects', async () => {
  let calls = 0
  const report = await run({}, {fetch: transport({}, (url, options) => {
    calls++
    assert.equal(new URL(url).origin, 'https://registry.npmjs.org')
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.headers.Accept, 'application/vnd.npm.install-v1+json')
    assert.ok(options.signal instanceof AbortSignal)
  })})
  assert.equal(report.ok,true)
  assert.equal(calls, 1)
  for (const registry of ['http://registry.npmjs.org','https://registry.npmjs.org.evil.test','https://user:secret@registry.npmjs.org','https://registry.npmjs.org/other','https://registry.npmjs.org?token=secret']) {
    await assert.rejects(() => run({}, {registry}), /public npm registry/)
  }
})
test('permission, server and transport failures fail closed without leaking response or exception details', async () => {
  for (const value of [401,403,500, new Error('https://user:secret@example.test/?token=secret')]) {
    const report = await run({[core.name]: value})
    assert.equal(report.ok, false)
    assert.equal(report.maintainerConfirmationRequired.length, 0)
    assert.doesNotMatch(JSON.stringify(report), /secret/)
  }
})
test('identical published bytes skip first-publication eligibility while mismatched bytes conflict', async () => {
  const published = metadata(core.name)
  const report = await run({[core.name]: published})
  assert.equal(report.ok, true)
  assert.equal(report.targets[0].status, 'already-published')
  assert.deepEqual(report.maintainerConfirmationRequired, [])
  published.versions['0.1.0'].dist.integrity = otherIntegrity
  assert.equal((await run({[core.name]: published})).errors[0].code, 'integrity-conflict')
})
test('existing package with a missing version cannot use manual bootstrap', async () => {
  const report = await run({[core.name]: metadata(core.name, ['0.0.9'])})
  assert.equal(report.ok, false)
  assert.equal(report.targets[0].status, 'existing-package')
})
test('newer required channels reject rollback even when candidate bytes already match', async () => {
  for (const tag of ['latest','beta']) {
    const report = await run({[core.name]: metadata(core.name, ['0.1.0','0.2.0'], {[tag]:'0.2.0'})})
    assert.equal(report.ok, false)
    assert.ok(report.errors.some(error => error.code === 'newer-channel'))
  }
})
test('bootstrap permits only a selected compatible internal archive as pending', async () => {
  const report = await run({}, {}, [core,server])
  assert.equal(report.ok, true)
  assert.equal(report.targets[1].dependencies[0].status, 'pending-internal')
  assert.equal((await run({}, {}, [{...server, dependencies:{[core.name]:'^0.2.0'}},core])).ok, false)
  assert.equal((await run({}, {}, [server])).ok, false)
})
test('publish checks one target strictly and requires registry integrity of internal prerequisite', async () => {
  const options = {mode:'publish', selectedName:server.name}
  assert.equal((await run({}, options, [core,server])).ok, false)
  const report = await run({[core.name]: metadata(core.name)}, options, [core,server])
  assert.equal(report.ok, true)
  assert.equal(report.targets.length, 1)
  assert.equal(report.targets[0].dependencies[0].integrity, integrity)
  const noIntegrity = metadata(core.name)
  delete noIntegrity.versions['0.1.0'].dist.integrity
  assert.equal((await run({[core.name]:noIntegrity}, options, [core,server])).ok, false)
  await assert.rejects(() => run({}, {mode:'publish'}, [core,server]), /selectedName/)
})
test('all direct runtime, optional and peer requirements resolve publicly; dev requirements are ignored', async () => {
  const pkg = {...core, dependencies:{'@alneas/appkit-core':'0.2.0', hono:'^4.0.0'}, peerDependencies:{react:'^19.0.0'}, optionalDependencies:{optional:'~1.0.0'}, devDependencies:{missing:'1.0.0'}}
  const data = {'@alneas/appkit-core':metadata('@alneas/appkit-core',['0.2.0']), hono:metadata('hono',['4.1.0']),react:metadata('react',['19.0.0']),optional:metadata('optional',['1.0.1'])}
  const report = await run(data, {}, [pkg])
  assert.equal(report.ok, true)
  assert.equal(report.targets[0].dependencies.length, 4)
  delete data.react
  assert.equal((await run(data, {}, [pkg])).ok, false)
  data.react=metadata('react',['19.0.0'])
  assert.equal((await run(data, {}, [{...pkg, dependencies:{'@alneas/appkit-core':'^0.2.0'}}])).ok, true)
})
test('unavailable dependency ranges and malformed metadata fail closed', async () => {
  const pkg = {...core, dependencies:{hono:'^4.0.0'}}
  for (const value of [metadata('hono',['3.0.0']), metadata('wrong',['4.0.0']), {name:'hono',versions:{'4.0.0':{name:'hono',version:'5.0.0',dist:{integrity}}}}, {name:'hono',versions:{'4.0.0':{name:'hono',version:'4.0.0',dist:{}}}}]) {
    assert.equal((await run({hono:value}, {}, [pkg])).ok, false)
  }
})
test('body size and read deadline are bounded, including a transport ignoring abort', async () => {
  assert.equal((await run({}, {maxBodyBytes:16,fetch:async()=>new Response(' '.repeat(64))})).ok, false)
  const hangingFetch = () => new Promise(() => {})
  const report = await run({}, {timeoutMs:10,fetch:hangingFetch})
  assert.equal(report.ok, false)
  const hangingBody = () => new Response(new ReadableStream({start() {}}))
  assert.equal((await run({}, {timeoutMs:10,fetch:hangingBody})).ok, false)
})

test('prerequisite visibility failures cannot become pending bootstrap prerequisites', async () => {
  for (const value of [401,403,503,new Error('secret')]) {
    const report = await run({[core.name]:value}, {}, [core,server])
    assert.equal(report.ok,false)
    assert.equal(report.targets[1].dependencies[0].status,'blocked')
  }
})
test('selected internal dependency cannot substitute unreviewed bytes or another satisfying version', async () => {
  const data = metadata(core.name,['0.1.0','0.1.1'])
  data.versions['0.1.0'].dist.integrity = otherIntegrity
  const report = await run({[core.name]:data}, {mode:'publish',selectedName:server.name}, [core,server])
  assert.equal(report.ok,false)
  assert.ok(report.errors.some(error => error.code === 'dependency-integrity-conflict'))
  delete data.versions['0.1.0']
  assert.equal((await run({[core.name]:data}, {mode:'publish',selectedName:server.name}, [core,server])).ok,false)
})
test('candidate identity and channels are validated before querying', async () => {
  await assert.rejects(() => registryPreflight({packages:[core],archives:[{...archive(core),version:'0.2.0'}]}),/identity/)
  await assert.rejects(() => registryPreflight({packages:[core],archives:[{...archive(core),requiredTags:['latest']}]}),/required tags/)
  const data = metadata(core.name)
  data.versions['0.1.0'].name = 'other'
  assert.equal((await run({[core.name]:data})).ok,false)
})
test('stream errors and malformed JSON fail closed with sanitized codes', async () => {
  const badStream = () => new Response(new ReadableStream({start(controller) {
    controller.error(Object.assign(new Error('secret'),{code:'secret-token'}))
  }}))
  const report = await run({}, {fetch:badStream})
  assert.equal(report.ok,false)
  assert.doesNotMatch(JSON.stringify(report), /secret/)
  assert.equal((await run({}, {fetch:async()=>new Response('{')})).ok,false)
})


test('oversized external histories resolve a bounded exact public version through channels', async () => {
  const pkg = {...core, dependencies:{typescript:'^6.0.3'}}
  const paths = []
  const fetch = async (url, options) => {
    assert.equal(options.method,'GET')
    const path = new URL(url).pathname
    paths.push(path)
    if (path === '/typescript') return new Response(' ',{headers:{'content-length':String(9*1024*1024)}})
    if (path === '/-/package/typescript/dist-tags') return Response.json({latest:'6.1.0',next:'7.0.0-dev.1'})
    if (path === '/typescript/6.1.0') return Response.json({name:'typescript',version:'6.1.0',dist:{integrity}})
    return new Response('{}',{status:404})
  }
  const report = await run({}, {fetch}, [pkg])
  assert.equal(report.ok,true)
  assert.equal(report.targets[0].dependencies[0].version,'6.1.0')
  assert.equal(report.targets[0].dependencies[0].integrity,integrity)
  assert.ok(paths.includes('/-/package/typescript/dist-tags'))
})
test('oversized external histories may resolve the exact range floor; unproven ranges fail closed', async () => {
  const pkg = {...core, dependencies:{typescript:'^6.0.3'}}
  for (const available of [true,false]) {
    const fetch = async url => {
      const path = new URL(url).pathname
      if (path === '/typescript') return new Response(' ',{headers:{'content-length':String(9*1024*1024)}})
      if (path === '/-/package/typescript/dist-tags') return Response.json({latest:'7.0.0'})
      if (available && path === '/typescript/6.0.3') return Response.json({name:'typescript',version:'6.0.3',dist:{integrity}})
      return new Response('{}',{status:404})
    }
    const report = await run({}, {fetch}, [pkg])
    assert.equal(report.ok,available)
    if (!available) assert.ok(report.errors.some(error => error.code === 'dependency-range-unresolved'))
  }
})

test('large-history fallback rejects invalid tags, permission failures, mismatched identity and unverified integrity', async () => {
  const pkg = {...core, dependencies:{typescript:'^6.0.3'}}
  for (const scenario of ['invalid-tags','permission','identity','integrity']) {
    const fetch = async url => {
      const path = new URL(url).pathname
      if (path === '/typescript') return new Response(' ',{headers:{'content-length':String(9*1024*1024)}})
      if (path === '/-/package/typescript/dist-tags') {
        if (scenario === 'invalid-tags') return Response.json({latest:'secret-invalid-version'})
        if (scenario === 'permission') return new Response('{}',{status:403})
        return Response.json({latest:'6.0.3'})
      }
      if (path === '/typescript/6.0.3') return Response.json({name:scenario==='identity'?'wrong':'typescript',version:'6.0.3',dist:scenario==='integrity'?{}:{integrity}})
      return new Response('{}',{status:404})
    }
    const report = await run({}, {fetch}, [pkg])
    assert.equal(report.ok,false,scenario)
    assert.equal(report.targets[0].dependencies[0].status,'blocked')
    assert.doesNotMatch(JSON.stringify(report),/secret/)
  }
})

test('Appkit React accepts its own exact version and rejects stale pins', async () => {
  const data = {'@alneas/appkit-react':metadata('@alneas/appkit-react',['0.2.0','0.3.0'])}
  assert.equal((await run(data, {}, [{...core, peerDependencies:{'@alneas/appkit-react':'0.3.0'}}])).ok, true)
  assert.equal((await run(data, {}, [{...core, peerDependencies:{'@alneas/appkit-react':'0.2.0'}}])).ok, false)
})
