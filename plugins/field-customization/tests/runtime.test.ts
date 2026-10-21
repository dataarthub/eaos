import {expect,test} from 'bun:test'
import {createExtension} from '../src/runtime'
test('runtime requires reviewed tenant scope and live host bindings',()=>{
 for(const tenantIds of [[],['*'],['tenant-a','tenant-a']])expect(()=>createExtension({tenantIds})).toThrow('tenant catalog')
 expect(()=>createExtension({tenantIds:['tenant-a']})).toThrow('host bindings')
})
