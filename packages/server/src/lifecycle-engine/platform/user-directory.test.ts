import { expect, test } from 'bun:test'
import { parseAccountMemberships, selectAccountTenant, initialPersonName } from './user-directory'
test('multiple active tenants require a selection or an explicit default', () => {
 const memberships = [{tenantId:'kankyo',role:'admin',active:true},{tenantId:'alneas',role:'member',active:true}]
 expect(selectAccountTenant(parseAccountMemberships({memberships}))).toBeUndefined()
 expect(selectAccountTenant(parseAccountMemberships({memberships,defaultTenantId:'alneas'}))).toBe('alneas')
 expect(selectAccountTenant(parseAccountMemberships({memberships:[{...memberships[0],active:false}]}))).toBeUndefined()
})
test('malformed, duplicated, inactive default and global roles cannot grant membership', () => {
 for (const memberships of [[{tenantId:'a',role:'super_admin',active:true}],[{tenantId:'a',role:'member',active:'true'}],[{tenantId:'a',role:'member',active:true},{tenantId:'a',role:'admin',active:true}]]) expect(() => parseAccountMemberships({memberships})).toThrow()
 expect(() => parseAccountMemberships({memberships:[],defaultTenantId:'a'})).toThrow()
})
test('first registration takes an explicit legal name or the verified display name', () => {
 expect(initialPersonName(undefined,' 表示名 ')).toBe('表示名')
 expect(initialPersonName('正式氏名','表示名')).toBe('正式氏名')
 expect(() => initialPersonName(undefined,undefined)).toThrow()
})
