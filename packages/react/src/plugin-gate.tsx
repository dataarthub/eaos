import { createElement, type ReactNode } from 'react'
import { useTenantModule, type TenantContext } from './index'

/**
 * Host tenant context augmented with per-plugin presentation admission decisions.
 *
 * @see createWorkspaceReactBindings for a complete host integration example.
 *
 * @remarks
 * Authenticated host snapshot. These decisions control presentation only.
 */
export interface PluginTenantContext extends TenantContext {
  /**
 * Host-admitted plugin decisions; allowed must be true as well as enabledModules membership; optional reason selects denial presentation.
 */
  pluginAccess: Readonly<Record<string, {
/**
 * Host admission decision; must be true along with module membership to show plugin content.
 */
  allowed: boolean;
/**
 * Optional host denial reason used to select unavailable/upgrade UI.
 */
  reason?: string }>>
}
/**
 * Derives fail-closed plugin visibility from the authenticated module and plugin-access snapshots.
 * @param pluginId - Plugin key present in both enabledModules and pluginAccess.
 * @returns Allowed/loading flags and optional host denial reason; allowed is false during loading or errors.
 * @throws Error outside TenantModuleProvider.
 *
 * @remarks
 * Requires TenantModuleProvider and PluginTenantContext from a trusted host loader; does not grant server access.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { usePluginAccess } from '@alneas/eaos-react/plugin-gate';
 * // Render under the host TenantModuleProvider.
 * export function ApprovalStatus() { const access = usePluginAccess('approval'); return <p>{access.allowed ? 'Available' : 'Unavailable'}</p>; }
 * ```
 */
export function usePluginAccess(pluginId: string) {
  const state = useTenantModule<PluginTenantContext>()
  const access = state.context?.pluginAccess?.[pluginId]
  return { allowed: !state.loading && !state.error && state.hasModule(pluginId) && access?.allowed === true, loading: state.loading, reason: access?.reason }
}
/**
 * Renders plugin children only when the current tenant snapshot permits the plugin.
 *
 * Missing/stale identity fails closed through the existing tenant module store.
 * @param props - pluginId identifies the plugin; children are authorized presentation; optional fallback replaces a denied state.
 * @returns A plugin-marked div, loading paragraph, fallback div, upgrade message, or null for tenant-locked/unspecified denial.
 * @throws Error outside TenantModuleProvider.
 *
 * @remarks
 * Requires TenantModuleProvider; this UI guard never replaces host/server authorization.
 *
 * @example
 * ```tsx
 * import * as React from 'react';
 * import { PluginGate } from '@alneas/eaos-react/plugin-gate';
 * export function ApprovalEntry() { return <PluginGate pluginId="approval"><a href="/plugins/approval/workspace">Approvals</a></PluginGate>; }
 * ```
 */
export function PluginGate({ pluginId, children, fallback }: {
/**
 * Plugin identifier admitted by current host policy.
 */
  pluginId: string;
/**
 * React descendants rendered within this component.
 */
  children: ReactNode;
/**
 * Optional denied-access content; undefined selects the built-in denial behavior.
 */
  fallback?: ReactNode }) {
  const access = usePluginAccess(pluginId)
  if (access.allowed) return createElement('div', { 'data-plugin': pluginId }, children)
  if (access.loading) return createElement('p', { role: 'status' }, '読み込み中...')
  if (fallback !== undefined) return createElement('div', null, fallback)
  if (access.reason === 'tenant-locked' || !access.reason) return null
  return createElement('div', { role: 'status', 'data-plugin-locked': pluginId }, 'この機能を利用するには、契約プランまたはアドオンの更新が必要です。')
}
