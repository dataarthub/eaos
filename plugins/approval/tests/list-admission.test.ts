import {test,expect} from 'bun:test'
import {ApprovalService} from '../src/service'
test('approval list denies already accumulated results when authority is revoked during resource filtering',async()=>{
 let allowed=true
 const service=new ApprovalService({store:{read:async()=>null,list:async()=>[{id:'request-a',revision:1,value:{templateId:'template',title:'Request',targetType:'note',targetId:'note',requestedBy:'author',stages:[{id:'review',label:'Review',roles:['admin']}],allowSelfApproval:false,currentStage:0,status:'pending',history:[]}}],create:async()=>{},replace:async()=>false},authorize:async(_p,_action,resource)=>{if(resource){allowed=false;return true}return allowed},resolveTemplate:async()=>null})
 await expect(service.list({tenantId:'tenant-a',userId:'reviewer',roles:['admin']})).rejects.toMatchObject({status:403})
})
