import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {digest,verifyBundleIdentity} from './bundle.mjs'
test('real tarball identity and version notes reject archive, source, notes and path substitutions',async t=>{
 const root=await mkdtemp(join(tmpdir(),'eaos-publish-bundle-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const meta={name:'@alneas/eaos-core',version:'0.2.0',license:'MIT',exports:{'.':'./dist/index.js'},publishConfig:{access:'public',registry:'https://registry.npmjs.org'}}
 const changelog='# Changelog\n\n## 0.2.0\n\n- Add a reviewed consumer contract.\n'
 await mkdir(join(root,'package'));await writeFile(join(root,'package/package.json'),JSON.stringify(meta));await writeFile(join(root,'package/CHANGELOG.md'),changelog)
 execFileSync('tar',['-czf',join(root,'core.tgz'),'-C',root,'package'])
 const bytes=await readFile(join(root,'core.tgz')),notes=`# ${meta.name} ${meta.version}\n\n## 0.2.0\n\n- Add a reviewed consumer contract.\n`
 await writeFile(join(root,'core.notes.md'),notes)
 const a={name:meta.name,version:meta.version,archive:'core.tgz',...digest(bytes),notes:'core.notes.md',notesSha256:digest(notes).sha256}
 const m={schemaVersion:1,repository:'https://github.com/dataarthub/eaos',commit:'a'.repeat(40),targets:[a.name],artifacts:[a]}
 const options={directory:root,expectedCommit:m.commit,targets:[{name:a.name,version:a.version,meta,changelog}]}
 await verifyBundleIdentity(m,options)
 for(const mutate of [m=>{m.commit='b'.repeat(40)},m=>{m.artifacts[0].archive='../core.tgz'},m=>{m.artifacts[0].integrity='wrong'},m=>{m.artifacts[0].sha256='wrong'},m=>{m.targets.push('@alneas/eaos-cli')},m=>{m.artifacts.push({...a})}]){const x=structuredClone(m);mutate(x);await assert.rejects(verifyBundleIdentity(x,options))}
 await assert.rejects(verifyBundleIdentity(m,{...options,targets:[{...options.targets[0],meta:{...meta,exports:{'.':'./wrong.js'}}}]}))
 await writeFile(join(root,'core.notes.md'),'Changed notes');const changed=structuredClone(m);changed.artifacts[0].notesSha256=digest('Changed notes').sha256
 await assert.rejects(verifyBundleIdentity(changed,options),/Notes differ/)
 await writeFile(join(root,'core.notes.md'),notes)
 await rm(join(root,'core.tgz'));await writeFile(join(root,'original.tgz'),bytes);await symlink('original.tgz',join(root,'core.tgz'))
 await assert.rejects(verifyBundleIdentity(m,options))
})
