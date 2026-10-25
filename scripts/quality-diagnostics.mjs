// Expose failure names in CI while keeping raw diagnostics in private local logs.
export function failedCheckNames(log) {
  const plain=log.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'')
  const names=plain.split(/\r?\n/).flatMap(line=>{
    const match=line.match(/^(?:\(fail\)|✖|not ok \d+ -)\s+(.+)$/)
    return match?[match[1].replace(/\s*[[(]\d+(?:\.\d+)?\s*ms[\])]$/,'').trim().slice(0,300)]:[]
  })
  const runnerCategories=['Empty or duplicate source-test selection','Source test process failed','Missing or malformed fresh test report','Source tests must execute with no failures or skips','Test report count differs','Every selected test file must execute tests','Test report contains skipped or unsuccessful cases','Malformed test suite nesting','Incomplete test suites']
  for(const category of runnerCategories)if(plain.includes(category))names.push('Source runner: '+category)
  return [...new Set(names)].slice(0,10)
}
