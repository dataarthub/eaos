// Expose failure names in CI while keeping raw diagnostics in private local logs.
export function failedCheckNames(log) {
  const plain=log.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'')
  const names=plain.split(/\r?\n/).flatMap(line=>{
    const match=line.match(/^(?:\(fail\)|✖|not ok \d+ -)\s+(.+)$/)
    return match?[match[1].replace(/\s*[[(]\d+(?:\.\d+)?\s*ms[\])]$/,'').trim().slice(0,300)]:[]
  })
  return [...new Set(names)].slice(0,10)
}
