import {expect,test} from 'bun:test'
import {workspaceNavigation} from '../src/workspace-shell'
const labels=(options:Parameters<typeof workspaceNavigation>[0])=>workspaceNavigation(options).flatMap(group=>group.items.map(item=>item.label))
test('default workspace navigation does not assume tenant admin, Platform admin or business activation',()=>{
  expect(labels({hasTenant:true})).toEqual(['テナントトップ','所属・招待'])
  expect(labels({hasTenant:true,isPlatformAdmin:true})).toEqual(['テナントトップ','所属・招待','Platform管理'])
  expect(labels({hasTenant:true,isTenantAdmin:true})).toEqual(['テナントトップ','ユーザー管理','所属・招待'])
})
test('private product navigation is an explicit host contribution and route bindings remain host-owned',()=>{
  const groups=workspaceNavigation({routes:{home:'home'},contributions:[{title:'private',items:[{label:'ANDPAD',path:'/andpad/import',icon:null}]}]})
  expect(groups[0].items[0].path).toBe('home')
  expect(groups.flatMap(group=>group.items.map(item=>item.path))).toEqual(['home','/settings/profile','/andpad/import'])
})
