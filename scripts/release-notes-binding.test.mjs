import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {releaseNotes,verifyReleaseNotes} from './release-notes.mjs'
const pkg={name:'@alneas/eaos-core',version:'0.1.0'},source='# Core\n\n## 0.1.0\n\n- Introduce the public SDK.\n'
const notes=releaseNotes(pkg,source),sha256=createHash('sha256').update(notes).digest('hex')
test('notes bind canonical changelog, packed changelog and transferred Markdown bytes',()=>{
 const inputs={sourceChangelog:source,packedChangelog:source,notes,sha256}
 assert.doesNotThrow(()=>verifyReleaseNotes(pkg,inputs))
 for(const change of [{packedChangelog:source+'tampered'},{notes:notes+'tampered'},{sourceChangelog:source.replace('SDK','API')},{sha256:'0'.repeat(64)}])assert.throws(()=>verifyReleaseNotes(pkg,{...inputs,...change}))
})
