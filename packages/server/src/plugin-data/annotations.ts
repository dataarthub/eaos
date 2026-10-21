import { atomicHash, parseRecordCursor, recordCursor, type AtomicSession } from './atomic'
import { PluginError, type PluginPrincipal } from './index'

/**
 * Pinned owning-document scope hash and admitted anchor/check IDs; authorization is supplied by its owner.
 * 
 *
 * The owning plugin authorizes and pins the document before entering this transaction.
 * @see documentAnnotations for canonical host integration.
 */
export interface AnnotationTarget {
  /**
   * Trusted 64-character document-scope hash pinned by the owning plugin.
   */
  scope: string;
  /**
   * Exact anchor IDs valid for newly created reader comments.
   */
  anchorIds: readonly string[];
  /**
   * Exact reading-check IDs admitted for this pinned document.
   */
  checkIds: readonly string[] }
/**
 * Document-scoped reader comment with author-controlled resolution and private/shared visibility.
 * 
 * @see documentAnnotations for canonical host integration.
 */
export interface ReaderComment {
  /**
   * Generated comment UUID; physical storage also prefixes the pinned document and visibility scope.
   */
  id: string;
  /**
   * Pinned valid document anchor, or null for a document-wide comment.
   */
  anchorId: string | null;
  /**
   * Nonblank trimmed comment text; outer schema limits input to 4000 characters.
   */
  body: string;
  /**
   * private scopes rows to the actor hash; shared scopes them to the authorized document audience.
   */
  visibility: 'private' | 'shared';
  /**
   * Authenticated creator; only this actor may change resolution.
   */
  authorId: string;
  /**
   * Trusted ISO timestamp supplied by the owning command.
   */
  createdAt: string;
  /**
   * Author-controlled resolution flag, updated using the stored CAS revision.
   */
  resolved: boolean }
/**
 * Supported reader annotation operation names; this list itself grants no document access.
 * 
 * @see documentAnnotations for canonical usage.
 */
export const annotationOperations = ['get_annotations', 'set_check', 'add_comment', 'resolve_comment'] as const
/**
 * Compose closed annotation operation schemas from the owning document's trusted target fields.
 * @param target - Trusted JSON Schema property map for the owning document identity; those keys are required on every operation.
 * @returns Schemas for get_annotations, set_check, add_comment and resolve_comment.
 * @remarks Schema generation does not authorize or execute annotations; the owner validates input and pins the exact document before transaction work.
 * @example
 * import { annotationSchemas } from '@alneas/eaos-server/plugin-data'
 * const schemas = annotationSchemas({ documentId: { type: 'string', minLength: 1 } })
 */
export function annotationSchemas(target: Record<string, unknown>) {
 const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' }, revision = { type: 'integer', minimum: 0, maximum: 9007199254740990 }
 const visibility = { enum: ['private', 'shared'] }, anchorId = { anyOf: [{ type: 'string', minLength: 1, maxLength: 1000 }, { type: 'null' }] }
 const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, required: [...Object.keys(target), ...required], properties: { ...target, ...properties } })
 return {
  get_annotations: schema({ visibility, cursor: { type: 'string', maxLength: 1000 } }, ['visibility']),
  set_check: schema({ commandId: id, revision, itemId: { type: 'string', minLength: 1, maxLength: 1000 }, checked: { type: 'boolean' } }, ['commandId', 'revision', 'itemId', 'checked']),
  add_comment: schema({ commandId: id, visibility, anchorId, body: { type: 'string', minLength: 1, maxLength: 4000 } }, ['commandId', 'visibility', 'anchorId', 'body']),
  resolve_comment: schema({ commandId: id, revision, visibility, commentId: id, resolved: { type: 'boolean' } }, ['commandId', 'revision', 'visibility', 'commentId', 'resolved']),
 }
}
/**
 * Read or mutate document checks/comments within an already authorized atomic document command.
 * @param tx - Live tenant-scoped atomic session inside the owner's atomicCommand.
 * @param p - Verified document reader principal.
 * @param target - Pinned document scope hash and its admitted anchor/check IDs.
 * @param operation - One of annotationOperations.
 * @param a - Input already validated against the selected annotation schema.
 * @param now - Trusted ISO timestamp used for newly created comments.
 * @returns Operation-specific checks, comment or page data with CAS revisions and optional scoped cursor.
 * @throws Rejects invalid scope/cursors, unknown checks/anchors/operations, comment ownership violations, missing comments, capacity or CAS conflicts.
 * @remarks Does not enforce the outer schema or own authorization/transaction/table creation. The owner must authorize the exact document and wrap write operations in atomicCommand; private/shared visibility is scoped by user and document hash.
 * @example
 * import { documentAnnotations } from '@alneas/eaos-server/plugin-data'
 * export function readComments(tx: Parameters<typeof documentAnnotations>[0], p: Parameters<typeof documentAnnotations>[1], target: Parameters<typeof documentAnnotations>[2], now: string) { return documentAnnotations(tx, p, target, 'get_annotations', { visibility: 'private' }, now) }
 */
export async function documentAnnotations(tx: AtomicSession, p: PluginPrincipal, target: AnnotationTarget, operation: string, a: Record<string, any>, now: string) {
 if (!/^[a-f0-9]{64}$/.test(target.scope)) throw new Error('Trusted annotation scope required')
 const owner = atomicHash(p.userId), checksKey = `checks/${target.scope}/${owner}`
 const prefix = `comments/${target.scope}/${a.visibility === 'shared' ? 'shared' : owner}/`
 const visible = (row: { revision: number; value: ReaderComment }) => ({ ...row.value, revision: row.revision, canResolve: row.value.authorId === p.userId })
 if (operation === 'get_annotations') {
  const scope = [p.tenantId, p.userId, target.scope, a.visibility], after = parseRecordCursor(scope, a.cursor)
  if (after && !after.startsWith(prefix)) throw new PluginError(400, 'Invalid comment cursor')
  const checks = await tx.get<Record<string, boolean>>(checksKey), rows = await tx.list<ReaderComment>(prefix, after, 51)
  return { checkIds: target.checkIds, checks: checks?.value ?? {}, revision: checks?.revision ?? 0, comments: rows.slice(0, 50).map(visible), ...(rows.length > 50 ? { cursor: recordCursor(scope, rows[49].id) } : {}) }
 }
 if (operation === 'set_check') {
  if (!target.checkIds.includes(a.itemId)) throw new PluginError(400, 'Unknown reading check')
  const old = await tx.get<Record<string, boolean>>(checksKey), value = { ...old?.value }
  if (a.checked) Object.defineProperty(value, a.itemId, { value: true, enumerable: true, configurable: true, writable: true })
  else delete value[a.itemId]
  if (Object.keys(value).length > 1000) throw new PluginError(400, 'Reading check capacity exceeded')
  const saved = await tx.put(checksKey, value, a.revision)
  return { checks: saved.value, revision: saved.revision }
 }
 if (operation === 'add_comment') {
  if (!a.body.trim() || (a.anchorId !== null && !target.anchorIds.includes(a.anchorId))) throw new PluginError(400, 'Comment body and valid anchor required')
  const comment: ReaderComment = { id: crypto.randomUUID(), anchorId: a.anchorId, body: a.body.trim(), visibility: a.visibility, authorId: p.userId, createdAt: now, resolved: false }
  return visible(await tx.put(prefix + comment.id, comment, 0))
 }
 if (operation === 'resolve_comment') {
  const row = await tx.get<ReaderComment>(prefix + a.commentId)
  if (!row) throw new PluginError(404, 'Comment unavailable')
  if (row.value.authorId !== p.userId) throw new PluginError(403, 'Only the comment author may resolve it')
  return visible(await tx.put(row.id, { ...row.value, resolved: a.resolved }, a.revision))
 }
 throw new PluginError(400, 'Unknown annotation operation')
}
