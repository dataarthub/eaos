import {test,expect} from 'bun:test'
import {Database} from 'bun:sqlite'
import {createAtomicRepository,createSqliteAtomicDriver} from './atomic'
import {ArtifactDeliveryService,type DeliveryPorts,type DeliveryJob} from './delivery'
const p={tenantId:'one',userId:'publisher',roles:[]},request={commandId:'queue',jobId:'job1',channel:'manual',kind:'publish' as const,target:{ref:'manual-v1'},contentHash:'a'.repeat(64),approvalRequestId:'public-approval'}
function setup(){const db=new Database(':memory:');db.exec('CREATE TABLE delivery_records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))');const repository=createAtomicRepository('delivery_records',createSqliteAtomicDriver(db));return {db,repository}}
test('delivery persists phases, retries CDN failure without duplicate build/activation and serializes the channel',async()=>{
 const {db,repository}=setup();let approved=true,fail=true,builds=0,activations=0,purges=0
 const ports:DeliveryPorts={verify:async()=>approved,build:async()=>{builds++;return {key:'private-static',contentHash:'b'.repeat(64),bytes:20}},activate:async()=>{activations++},purge:async()=>{purges++;if(fail)throw Error('CDN down')}}
 const options={repository,ports,authorize:async()=>true},service=new ArtifactDeliveryService(options)
 try{
  approved=false;await expect(service.execute(p,'enqueue_delivery',request)).rejects.toThrow('approval');approved=true
  const queued=await service.execute(p,'enqueue_delivery',request);expect(queued.value.state).toBe('queued')
  expect(await service.execute(p,'enqueue_delivery',request)).toEqual(queued)
  await expect(service.execute(p,'enqueue_delivery',{...request,commandId:'queue2',jobId:'job2'})).rejects.toThrow('unfinished')
  await expect(service.execute(p,'run_delivery',{jobId:'job1'})).rejects.toThrow('CDN down')
  expect((await service.execute(p,'get_delivery',{jobId:'job1'})).value.phase).toBe('purge')
  fail=false
  const done=await new ArtifactDeliveryService(options).execute(p,'run_delivery',{jobId:'job1'})
  expect(done.value.state).toBe('done');expect(builds).toBe(1);expect(activations).toBe(1);expect(purges).toBe(2)
  expect(await service.execute(p,'run_delivery',{jobId:'job1'})).toEqual(done)
  const withdraw={...request,commandId:'remove',jobId:'remove',kind:'withdraw' as const}
  await service.execute(p,'enqueue_delivery',withdraw);await service.execute(p,'run_delivery',{jobId:'remove'});expect(builds).toBe(1);expect(activations).toBe(2)
  await expect(service.execute({...p,tenantId:'two'},'get_delivery',{jobId:'job1'})).rejects.toThrow('unavailable')
 }finally{db.close()}
})
test('delivery rejects concurrent workers, requires proven drain for recovery and rechecks publication after build',async()=>{
 const {db,repository}=setup();let release:()=>void=()=>{},started:()=>void=()=>{},approved=true,activated=false,drained=false
 const entered=new Promise<void>(r=>started=r),gate=new Promise<void>(r=>release=r)
 const ports:DeliveryPorts={verify:async()=>approved,build:async()=>{started();await gate;approved=false;return {key:'staged',contentHash:'b'.repeat(64),bytes:20}},activate:async()=>{activated=true},purge:async()=>{},drained:async()=>drained}
 const service=new ArtifactDeliveryService({repository,ports,authorize:async()=>true})
 try{
  await service.execute(p,'enqueue_delivery',request)
  const running=service.execute(p,'run_delivery',{jobId:'job1'}).then(()=>null,e=>e);await entered
  await expect(service.execute(p,'run_delivery',{jobId:'job1'})).rejects.toThrow('already running')
  const row=await service.execute(p,'get_delivery',{jobId:'job1'})
  await expect(service.execute(p,'recover_delivery',{jobId:'job1',revision:row.revision})).rejects.toThrow('drained')
  release();expect((await running)?.message).toContain('approval');expect(activated).toBe(false)
  // Simulate process loss, then a host-confirmed drained worker.
  await repository.run(p,async tx=>{const r=await tx.get<DeliveryJob>('delivery/job1');await tx.put(r!.id,{...r!.value,state:'running',token:'lost-worker'},r!.revision)})
  const lost=await service.execute(p,'get_delivery',{jobId:'job1'});drained=true
  expect((await service.execute(p,'recover_delivery',{jobId:'job1',revision:lost.revision})).value.state).toBe('failed')
  await expect(service.execute(p,'enqueue_delivery',{...request,tenantId:'forged'} as any)).rejects.toThrow('Invalid')
 }finally{db.close()}
})

test('revoked publication can be reconciled and cancelled before releasing the channel',async()=>{
 const {db,repository}=setup();let approved=true,reconciled=0
 const ports:DeliveryPorts={verify:async()=>approved,build:async()=>{approved=false;return{key:'staged',contentHash:'b'.repeat(64),bytes:20}},activate:async()=>{},purge:async()=>{},cancel:async()=>{reconciled++}}
 const service=new ArtifactDeliveryService({repository,ports,authorize:async()=>true})
 try{
  await service.execute(p,'enqueue_delivery',request)
  await expect(service.execute(p,'run_delivery',{jobId:'job1'})).rejects.toThrow('approval')
  const cancelled=await service.execute(p,'cancel_delivery',{jobId:'job1'})
  expect(cancelled.value.state).toBe('cancelled');expect(reconciled).toBe(1)
  await service.execute(p,'cancel_delivery',{jobId:'job1'});expect(reconciled).toBe(1)
  approved=true;expect((await service.execute(p,'enqueue_delivery',{...request,jobId:'job2',commandId:'queue2'})).value.state).toBe('queued')
 }finally{db.close()}
})
