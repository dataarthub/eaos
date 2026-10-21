import { PluginError, type PluginPrincipal } from './index'

/**
 * Minimal verified-principal operation dispatch contract shared by bounded composite services.
 * 
 * @see createCompositePluginService for canonical host integration.
 */
export interface PluginOperationService {
  /**
   * Executes one service-owned operation using host-verified identity and operation input.
   * @param principal - Verified current tenant principal.
   * @param operation - Declared service operation name.
   * @param input - Operation input whose schema/permission must be checked by the owning service.
   * @returns The owner's operation result; no composite layer adds authentication or transactions.
   * @throws Rejects owning-service schema, authorization, persistence or domain failures.
   
   * @example
   * ```typescript
   * import type { PluginOperationService, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function executeAdmitted(service: PluginOperationService, principal: PluginPrincipal, operation: string, input: unknown) {
   *   // The owning service validates input and live resource permission.
   *   return service.execute(principal, operation, input);
   * }
   * ```
   */
  execute(principal: PluginPrincipal, operation: string, input: unknown): Promise<unknown>
}

/**
 * Route explicitly owned operations to their bounded service instances.
 * @param services - Trusted service instances keyed by owner name.
 * @param operationOwners - Explicit operation-to-owner mapping copied at construction.
 * @returns A principal-aware execute service forwarding to the declared owner.
 * @throws Unknown declared owners throw at construction; unknown operations reject with PluginError 400 and owner errors propagate.
 * @remarks Does not authenticate principals or add authorization/transactions; each owner service retains its actual boundaries.
 * @example
 * import { createCompositePluginService } from '@alneas/eaos-server/plugin-data'
 * export function composite(services: Parameters<typeof createCompositePluginService>[0]) { return createCompositePluginService(services, { list: 'records' }) }
 */
export function createCompositePluginService(
  services: Readonly<Record<string, PluginOperationService>>,
  operationOwners: Readonly<Record<string, string>>,
): PluginOperationService {
  const owned = new Map(Object.entries(operationOwners))
  for (const [operation, owner] of owned) {
    if (!services[owner]) throw new Error(`Unknown composite service: ${owner} (${operation})`)
  }
  return {
    async execute(principal, operation, input) {
      const owner = owned.get(operation)
      if (!owner) throw new PluginError(400, 'Unknown bundled plugin operation')
      return services[owner]!.execute(principal, operation, input)
    },
  }
}
