import { expect, test } from 'bun:test'
import { applyAccountMembershipChange, metadataHash, planAccountMembershipPublication, publishAccountMemberships, type AccountAdminPort, type AccountMutationStore, type ManagedIdentity } from '../src/browser-auth/index'

const membership = { tenantId: 'a', role: 'admin', active: true }
function fixture() {
  let identity: ManagedIdentity = { id: 'u', state: 'active', traits: { name: 'Owner' }, metadata_admin: { eaos_memberships: [membership], eaos_default_tenant_id: 'a', is_superadmin: true, private_note: 'secret' }, metadata_public: { subscription: 'paid' } }
  let locks = 0, completed = 0, writes = 0, acceptWrites = true
  const store: AccountMutationStore = { acquire: async () => { locks++ }, complete: async () => { completed++ } }
  const admin: AccountAdminPort = { read: async () => structuredClone(identity), write: async (current, metadata, field) => { writes++; if (acceptWrites) identity = structuredClone({ ...current, [field]: metadata }) } }
  return { store, admin, get: () => identity, change: (value: ManagedIdentity) => { identity = value }, rejectWrites: () => { acceptWrites = false }, counts: () => ({ locks, completed, writes }) }
}
test('publication moves only reviewed membership fields and preserves unrelated public/private metadata', async () => {
  const f = fixture(), plan = planAccountMembershipPublication(f.get())
  expect(JSON.stringify(plan)).not.toContain('secret')
  await publishAccountMemberships(plan, 'operator', f.store, f.admin)
  expect(f.get().metadata_public).toEqual({ subscription: 'paid', eaos_memberships: [membership], eaos_default_tenant_id: 'a' })
  expect(f.get().metadata_admin).toEqual({ is_superadmin: true, private_note: 'secret' })
  expect(f.counts()).toEqual({ locks: 1, completed: 1, writes: 1 })
})
test('publication rejects conflicts, changed reviewed metadata and membership edits', async () => {
  const f = fixture(), plan = planAccountMembershipPublication(f.get())
  expect(() => planAccountMembershipPublication({ ...f.get(), metadata_public: { eaos_memberships: [] } })).toThrow()
  f.change({ ...f.get(), metadata_admin: { ...f.get().metadata_admin, private_note: 'updated' } })
  await expect(publishAccountMemberships(plan, 'operator', f.store, f.admin)).rejects.toThrow('Stale')
  expect(f.counts()).toEqual({ locks: 1, completed: 0, writes: 0 })
  const other = fixture()
  await expect(publishAccountMemberships({ ...planAccountMembershipPublication(other.get()), memberships: { memberships: [] } }, 'operator', other.store, other.admin)).rejects.toThrow('changes memberships')
})
test('unverified publication keeps the durable lock for reconciliation', async () => {
  const f = fixture(); f.rejectWrites()
  await expect(publishAccountMemberships(planAccountMembershipPublication(f.get()), 'operator', f.store, f.admin)).rejects.toThrow('could not be verified')
  expect(f.counts()).toEqual({ locks: 1, completed: 0, writes: 1 })
})
test('public membership writes clear defaults on revocation and retain unrelated metadata', async () => {
  const f = fixture()
  await publishAccountMemberships(planAccountMembershipPublication(f.get()), 'operator', f.store, f.admin)
  await applyAccountMembershipChange({ identityId: 'u', metadataField: 'metadata_public', beforeMetadataHash: metadataHash(f.get().metadata_public), memberships: { memberships: [{ ...membership, active: false }] } }, 'operator', f.store, f.admin)
  expect(f.get().metadata_public).toEqual({ subscription: 'paid', eaos_memberships: [{ ...membership, active: false }], eaos_default_tenant_id: null })
  expect(f.get().metadata_admin).toEqual({ is_superadmin: true, private_note: 'secret' })
  expect(f.counts().completed).toBe(2)
})
test('legacy mutation plans keep the private field contract', async () => {
  const f = fixture()
  await applyAccountMembershipChange({ identityId: 'u', beforeMetadataHash: metadataHash(f.get().metadata_admin), memberships: { memberships: [] } }, 'operator', f.store, f.admin)
  expect(f.get().metadata_admin?.eaos_memberships).toEqual([])
  expect(f.get().metadata_public).toEqual({ subscription: 'paid' })
})
