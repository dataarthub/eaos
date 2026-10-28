import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
function fail(message: string): never { throw Error('Platform generation: '+message) }
async function stat(path: string) { try { return await lstat(path) } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; return undefined } }

/**
 * Resolve a workspace-relative path while rejecting traversal and symlink escape.
 * @param root - Trusted workspace directory.
 * @param relative - Relative path within that workspace; absolute paths are rejected.
 * @returns The path formed under root after validating every component; this helper does not canonicalize root itself.
 * @throws Rejects invalid paths, symlink escape and filesystem errors; missing final components are allowed for creation.
 * @example
 * import { safePath } from '@alneas/eaos-cli/platform'
 * export function manifestPath(root: string) { return safePath(root, 'eaos.platform.json') }
 */
export async function safePath(root: string, relative: string): Promise<string> {
  const parts = relative.replace(/^\.\//, '').split('/')
  if (!relative || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\')) || relative.startsWith('/')) fail('paths must remain inside the project')
  let path = root
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i])
    const item = await stat(path)
    if (item?.isSymbolicLink()) fail('symlink paths are not supported')
    if (item && i < parts.length - 1 && !item.isDirectory()) fail('a path parent is not a directory')
  }
  return path
}

/**
 * Read a JSON file of at most 1 MiB and retain its original UTF-8 text.
 * @param path - File selected by the trusted caller; use safePath for workspace containment.
 * @returns The parsed data and original text, without a content hash.
 * @throws Rejects missing, nonregular or oversized files, invalid JSON and read failures.
 * @remarks lstat rejects a final symlink because it is not a regular file. Parent components are not checked here; use safePath for workspace-relative paths. Checks and reads are separate filesystem operations, so callers must control concurrent path changes.
 * @example
 * import { readJson } from '@alneas/eaos-cli/platform'
 * export function readManifest(path: string) { return readJson(path) }
 */
export async function readJson(path: string): Promise<{
/**
 * Parsed JSON value without runtime domain-schema validation.
 */
data: unknown;
/**
 * Original UTF-8 JSON file text retained exactly for hashing or inspection.
 */
text: string }> {
  const item = await stat(path)
  if (!item?.isFile() || item.size > 1024 * 1024) fail('expected a regular JSON file of at most 1 MiB')
  const text = await readFile(path, 'utf8')
  try { return { data: JSON.parse(text), text } } catch { fail('invalid JSON (contents omitted)') }
}
