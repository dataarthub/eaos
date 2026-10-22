import process from 'node:process'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {validateReport} from './run-source-tests.mjs'
const runner = fileURLToPath(new URL('./run-source-tests.mjs', import.meta.url))
for (const [name, source, pass] of [
 ['passing', "import {test,expect} from 'bun:test'; test('runs',()=>expect(1).toBe(1))", true],
 ['nested', "import {describe,test,expect} from 'bun:test'; describe('outer',()=>describe('inner',()=>test('runs',()=>expect(1).toBe(1))))", true],
 ['empty', 'export const value = 1', false],
 ['skipped', "import {test} from 'bun:test'; test.skip('not executed',()=>{})", false],
 ['todo', "import {test} from 'bun:test'; test.todo('not executed')", false],
 ['failing', "import {test,expect} from 'bun:test'; test('fails',()=>expect(1).toBe(2))", false],
 ['import-error', "throw Error('failed before test registration')", false],
]) test('source runner rejects success without execution: ' + name, () => {
 const cwd = mkdtempSync(join(tmpdir(), 'eaos-source-report-'))
 try {
  writeFileSync(join(cwd, 'fixture.test.ts'), source)
  const result = spawnSync(process.execPath, [runner], {cwd, encoding:'utf8'})
  assert.equal(result.status === 0, pass, result.stdout + result.stderr)
 } finally {rmSync(cwd, {recursive:true, force:true})}
})
test('fresh report must cover every selected file, including an empty file alongside a passing file', () => {
 const cwd = mkdtempSync(join(tmpdir(), 'eaos-source-report-'))
 try {
  writeFileSync(join(cwd, 'passing.test.ts'), "import {test} from 'bun:test'; test('runs',()=>{})")
  writeFileSync(join(cwd, 'empty.test.ts'), 'export const empty = true')
  assert.notEqual(spawnSync(process.execPath, [runner], {cwd, encoding:'utf8'}).status, 0)
 } finally {rmSync(cwd, {recursive:true, force:true})}
})
test('missing, truncated, mismatched and unsuccessful reports fail closed', () => {
 for (const xml of ['', '<testsuites tests="1" failures="0" skipped="0">', '<testsuites tests="1" failures="0" skipped="0"></testsuites>', '<testsuites tests="0" failures="0" skipped="0"></testsuites>']) assert.throws(()=>validateReport(xml,['fixture.test.ts'],process.cwd()))
})


test('a successful child cannot reuse a stale report when it produces no fresh evidence', () => {
 const cwd = mkdtempSync(join(tmpdir(), 'eaos-source-report-'))
 try {
  const bin = join(cwd, 'bin'), reports = join(cwd, '.verification/test-reports')
  mkdirSync(bin); mkdirSync(reports, {recursive:true})
  writeFileSync(join(cwd, 'fixture.test.ts'), "import {test} from 'bun:test'; test('runs',()=>{})")
  writeFileSync(join(reports, 'junit.xml'), '<testsuites tests="1" failures="0" skipped="0"><testcase file="fixture.test.ts" /></testsuites>')
  writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 0\n', {mode:0o755})
  const result = spawnSync(process.execPath, [runner], {cwd, encoding:'utf8', env:{...process.env,PATH:bin+':'+process.env.PATH}})
  assert.notEqual(result.status, 0)
 } finally {rmSync(cwd, {recursive:true, force:true})}
})


test('nested source directories named build remain part of actual test execution', () => {
 const cwd = mkdtempSync(join(tmpdir(), 'eaos-source-report-'))
 try {
  mkdirSync(join(cwd, 'src/build'), {recursive:true})
  writeFileSync(join(cwd, 'passing.test.ts'), "import {test} from 'bun:test'; test('runs',()=>{})")
  writeFileSync(join(cwd, 'src/build/contract.test.ts'), "import {test,expect} from 'bun:test'; test('must not be omitted',()=>expect(1).toBe(2))")
  const result = spawnSync(process.execPath, [runner], {cwd, encoding:'utf8'})
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /must not be omitted/)
 } finally {rmSync(cwd, {recursive:true, force:true})}
})
