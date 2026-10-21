import type { AtomicSession, AtomicSqlConnection, AtomicSqlDriver } from './atomic'
import type { PluginPrincipal } from './index'
/**
 * Weak capability map joining validated session wrappers to their live SQL connection, principal and dialect; trusted adapter plumbing only.
 * 
 *
 * Internal capability propagation through validated session wrappers; never a new transaction.
 * @see inheritAtomicSqlSession for canonical usage.
 */
export const atomicSqlBindings = new WeakMap<AtomicSession,{
  /**
   * Exact active SQL connection whose commit/rollback boundary owns this session.
   */
  connection:AtomicSqlConnection;
  /**
   * Verified tenant/user scope bound to this live connection.
   */
  principal:PluginPrincipal;
  /**
   * Trusted SQL dialect of the joined transaction driver.
   */
  dialect:AtomicSqlDriver['dialect']}>()
/**
 * Temporarily propagate an existing joined SQL capability to a validated session wrapper.
 * @param source - Currently bound source session; if unbound no capability is created.
 * @param wrapper - Wrapper session whose lifetime must not exceed the parent callback.
 * @returns A release callback deleting the wrapper's propagated binding.
 * @remarks Internal trusted capability plumbing exposed for validated host adapters. It never opens a transaction, authenticates a principal or extends the underlying session lifetime.
 * @example
 * import { inheritAtomicSqlSession } from '@alneas/eaos-server/plugin-data/atomic-context'
 * export function withBinding(source: Parameters<typeof inheritAtomicSqlSession>[0], wrapper: Parameters<typeof inheritAtomicSqlSession>[1], work: () => void) { const release = inheritAtomicSqlSession(source, wrapper); try { work() } finally { release() } }
 */
export function inheritAtomicSqlSession(source:AtomicSession,wrapper:AtomicSession):()=>void {
 const binding=atomicSqlBindings.get(source)
 if(binding)atomicSqlBindings.set(wrapper,binding)
 return ()=>{atomicSqlBindings.delete(wrapper)}
}
