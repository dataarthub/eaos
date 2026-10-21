/**
 * Host-admitted route metadata and its lazy module loader.
 * @typeParam T - Host value shape carried by this contract.
 *
 * @see loadClientRoute for a complete host integration example.
 */
export interface ClientRoute<T = unknown> {
/**
 * Host route identifier used by admission logic.
 */
  id: string;
/**
 * Plugin owning the route.
 */
  pluginId: string;
/**
 * Host router path for this contribution.
 */
  path: string;
/**
 * Declared module metadata; this helper never imports it directly.
 */
  module: string;
/**
 * Lazy module callback called once after initial authorization; rejection propagates.
 */
  load: () => Promise<T> }
/**
 * Loads a route only when host admission succeeds both before and after its module resolves.
 *
 * Admission helper, not a replacement for API authorization or reactive host UI guards.
 * @typeParam T - Module value returned by the host loader.
 * @param route - Declared client route and lazy loader.
 * @param authorize - Live admission predicate called before and after loading; must return true to expose the module.
 * @returns The loaded module after both checks succeed.
 * @throws Rejects when admission denies access or authorize/load rejects.
 *
 * @remarks
 * A loader can already have evaluated module side effects when the second check denies access. This helper does not enforce API authorization or reactively revoke rendered UI.
 *
 * @example
 * ```typescript
 * import { loadClientRoute, type ClientRoute } from '@alneas/eaos-react/client/client-routes';
 * export async function admit<T>(route: ClientRoute<T>, authorize: (route: ClientRoute<T>) => Promise<boolean>) {
 *  return loadClientRoute(route, authorize);
 * }
 * ```
 */
export async function loadClientRoute<T>(route: ClientRoute<T>, authorize: (route: ClientRoute<T>) => boolean | Promise<boolean>): Promise<T> {
  if (!await authorize(route)) throw new Error('Client route unavailable')
  const page = await route.load()
  if (!await authorize(route)) throw new Error('Client route unavailable')
  return page
}
