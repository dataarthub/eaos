import process from 'node:process'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

const decode = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
function attributes(text) { return Object.fromEntries([...text.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])])) }
export function validateReport(xml, files, cwd) {
 const header = xml.match(/<testsuites\s([^>]+)>/)
 assert(header && xml.trim().endsWith('</testsuites>'), 'Missing or malformed fresh test report')
 const summary = attributes(header[1]), count = Number(summary.tests)
 assert(Number.isSafeInteger(count) && count > 0 && summary.failures === '0' && summary.skipped === '0', 'Source tests must execute with no failures or skips')
 // Bun nests describe suites. Count leaf cases once and compare exact file coverage,
 // rather than summing parent/child suite counters twice.
 const cases = [...xml.matchAll(/<testcase\s([^>]+)>/g)].map(match => attributes(match[1]))
 const actual = [...new Set(cases.map(value => resolve(cwd, value.file)))]
 assert.equal(cases.length, count, 'Test report count differs')
 assert.deepEqual(actual.sort(), files.map(file => resolve(cwd, file)).sort(), 'Every selected test file must execute tests')
 assert(!/<(?:skipped|failure|error)\b/.test(xml), 'Test report contains skipped or unsuccessful cases')
 let depth = 0
 for (const match of xml.matchAll(/<(\/?)testsuite\b[^>]*>/g)) {
  depth += match[1] ? -1 : 1
  assert(depth >= 0, 'Malformed test suite nesting')
 }
 assert.equal(depth, 0, 'Incomplete test suites')
 return count
}
export function discoverTests(cwd) {
 const files = []
 function visit(directory) {
  for (const item of readdirSync(resolve(cwd, directory), {withFileTypes: true})) {
   if (['node_modules', 'dist', '.git', '.cache', '.verification'].includes(item.name) || directory === '' && item.name === 'build') continue
   const file = directory ? directory + '/' + item.name : item.name
   if (item.isDirectory()) visit(file)
   else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(item.name)) files.push(file)
  }
 }
 visit(''); return files.sort()
}
export function runSourceTests({cwd = process.cwd(), files = discoverTests(cwd), reportRoot = join(cwd, '.verification/test-reports'), env = process.env} = {}) {
 assert(files.length > 0 && new Set(files).size === files.length, 'Empty or duplicate source-test selection')
 mkdirSync(reportRoot, {recursive: true})
 const report = join(mkdtempSync(join(reportRoot, 'run-')), 'junit.xml')
 const result = spawnSync('bun', ['test', ...files.map(file => './' + file), '--reporter=junit', '--reporter-outfile=' + report], {cwd, env, stdio: 'inherit'})
 if (result.error) throw result.error
 assert.equal(result.status, 0, 'Source test process failed')
 const count = validateReport(readFileSync(report, 'utf8'), files, cwd)
 console.log(`Verified ${count} executed source tests; fresh report: ${report}`)
 return {count, report}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runSourceTests()
