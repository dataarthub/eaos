import { Database } from 'bun:sqlite'
import { expect,test } from 'bun:test'
import { createSqlRecordStore,ScopedRecordService,createAtomicRepository,createSqliteAtomicDriver,createAtomicRecordStore } from './index'
const p={tenantId:'a',userId:'operator',roles:['USER']},schemas={list:{type:'object',additionalProperties:false,properties:{limit:{type:'integer',minimum:1,maximum:100},search:{type:'string'},cursor:{type:'string'}}}},operations={list:'list',get:'get',create:'create',update:'update',archive:'archive'}
test('scoped paging searches beyond 100 rows, preserves filters and admission, and isolates literal namespaces',async()=>{const db=new Database(':memory:');db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))');const store=createSqlRecordStore<any>('records',{dialect:'sqlite',execute:async(_tenant,sql,binds)=>{const q=db.query(sql);return /^SELECT/.test(sql)?{rows:q.all(...binds as any[]) as any[]}:{affectedRows:q.run(...binds as any[]).changes}}},{namespace:'estate_properties'});let live=true;const definition={schemas,operations,listKey:'rows',label:'Fixture',pagination:true,searchableFields:['name'],create:()=>({tenantId:'a',id:'new'}),update:()=>{},archive:()=>{}},service=new ScopedRecordService<any,any>({store,authorize:async(_p,_op,_args,row)=>live&&row?.id!=='0201'},definition);try{for(let n=0;n<205;n++)await store.create('a',{id:String(n).padStart(4,'0'),revision:1,value:{tenantId:'a',id:String(n).padStart(4,'0'),name:n>=200?'needle':'other'}});db.query('INSERT INTO records VALUES(?,?,1,?)').run('a','estateXproperties:bad',JSON.stringify({tenantId:'a',id:'bad',name:'needle'}));await store.create('b',{id:'foreign',revision:1,value:{tenantId:'b',id:'foreign',name:'needle'}});const first:any=await service.execute(p,'list',{search:'needle',limit:2});expect(first.rows.map(row=>row.id)).toEqual(['0200','0202']);expect(first.scannedCount).toBe(203);const second:any=await service.execute(p,'list',{search:'needle',limit:2,cursor:first.nextCursor});expect(second.rows.map(row=>row.id)).toEqual(['0203','0204']);await expect(service.execute({...p,userId:'someone-else'},'list',{search:'needle',limit:2,cursor:first.nextCursor})).rejects.toThrow('cursor');await expect(service.execute(p,'list',{search:'different',limit:2,cursor:first.nextCursor})).rejects.toThrow('cursor');live=false;await expect(service.execute(p,'list',{search:'needle',limit:2,cursor:first.nextCursor})).rejects.toMatchObject({status:403})}finally{db.close()}})
test('list final admission is checked after asynchronous resource filtering',async()=>{let allowed=true;const service=new ScopedRecordService<any,any>({store:{read:async()=>null,list:async()=>[{id:'r',revision:1,value:{id:'r',tenantId:'a',name:'visible'}}],create:async()=>{},replace:async()=>false},authorize:async(_p,_op,_input,row)=>{if(row){allowed=false;return true}return allowed}},{schemas,operations,listKey:'rows',label:'Fixture',create:()=>({id:'new',tenantId:'a'}),update:()=>{},archive:()=>{}});await expect(service.execute(p,'list',{})).rejects.toMatchObject({status:403})})

test('ordinary scoped CRUD shares atomic serialization and cannot expose or lose writes in a rolled-back payment transaction',async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 const store=createSqlRecordStore<any>('records',{dialect:'sqlite',execute:async(_tenant,sql,binds)=>/^SELECT/.test(sql)?{rows:db.query(sql).all(...binds as any[])as any[]}:{affectedRows:db.query(sql).run(...binds as any[]).changes}},{namespace:'masters'})
 const repository=createAtomicRepository('records',createSqliteAtomicDriver(db),{namespace:'masters'})
 const createSchema={type:'object',additionalProperties:false,properties:{id:{type:'string'}},required:['id']}
 let pause!:()=>void,started!:()=>void
 const gate=new Promise<void>(resolve=>{pause=resolve}),ready=new Promise<void>(resolve=>{started=resolve})
 const definition={schemas:{...schemas,create:createSchema},operations,listKey:'rows',label:'Fixture',pagination:true,create:(args:any,principal:any)=>({id:args.id,tenantId:principal.tenantId}),update:()=>{},archive:()=>{}}
 const service=new ScopedRecordService<any,any>({store,repository,authorize:async(_principal,op,_input,record)=>{if(op==='create'&&record?.id==='rollback'){started();await gate;return false}return true}},definition)
 try{
  const failed=service.execute(p,'create',{id:'rollback'}).catch(error=>error);await ready
  let readReturned=false
  const reader=service.execute(p,'list',{}).then(result=>{readReturned=true;return result})
  const writer=service.execute(p,'create',{id:'committed'})
  await new Promise<void>(resolve=>setTimeout(resolve,0));expect(readReturned).toBe(false)
  pause();expect(await failed).toMatchObject({status:403});expect((await reader as any).rows).toHaveLength(0)
  expect(await writer).toMatchObject({id:'committed',revision:1})
  expect((await service.execute(p,'list',{})as any).rows.map((row:any)=>row.id)).toEqual(['committed'])
  await repository.run(p,async tx=>{const scoped=createAtomicRecordStore<any>(tx,p);await expect(scoped.read('other','committed')).rejects.toMatchObject({status:403});expect((await tx.list<any>('', '',100)).filter(row=>!row.id.startsWith('audit/')).map(row=>row.id)).toEqual(['committed']);expect((await tx.get<any>('audit/head'))?.value.sequence).toBe(1)})
 }finally{db.close()}
})

test('late command denial rolls back identity reservations and receipts; replay authorizes the current record', async () => {
 const db = new Database(':memory:')
 db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))')
 const repository = createAtomicRepository('records', createSqliteAtomicDriver(db))
 const schema = (properties: object, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required })
 const string = { type: 'string', minLength: 1 }, revision = { type: 'integer', minimum: 1 }
 let deniedRevision: number | undefined
 const observed: number[] = []
 const service = new ScopedRecordService<any, any>({
  store: createSqlRecordStore('records', { dialect: 'sqlite', execute: async (_tenant, sql, binds) => /^SELECT/.test(sql) ? { rows: db.query(sql).all(...binds as any[]) as any[] } : { affectedRows: db.query(sql).run(...binds as any[]).changes } }), repository,
  authorize: async (_principal, operation, _input, current) => {
   if (operation === 'rename' && current) observed.push((current as any).revision)
   return !current || (current as any).revision !== deniedRevision
  },
 }, {
  schemas: { ...schemas, get: schema({ id: string }, ['id']), create: schema({ id: string, name: string }, ['id', 'name']), update: schema({ id: string, revision, patch: schema({ name: string }, ['name']) }, ['id', 'revision', 'patch']), rename: schema({ id: string, revision, commandId: string, name: string }, ['id', 'revision', 'commandId', 'name']) },
  operations, listKey: 'rows', label: 'Fixture', pagination: true, unique: [{ name: 'name', fields: ['name'] }],
  create: (input, principal) => ({ ...input, tenantId: principal.tenantId }), update: (record, patch) => Object.assign(record, patch), archive: () => {}, custom: { rename: (record, input) => { record.name = input.name } },
 })
 try {
  await service.execute(p, 'create', { id: 'record', name: 'first' })
  const before = db.query('SELECT * FROM records ORDER BY id').all()
  const input = { id: 'record', revision: 1, name: 'second', commandId: 'rename-once' }
  deniedRevision = 2
  await expect(service.execute(p, 'rename', input)).rejects.toMatchObject({ status: 403 })
  expect(db.query('SELECT * FROM records ORDER BY id').all()).toEqual(before)
  deniedRevision = undefined
  const saved = await service.execute(p, 'rename', input)
  expect(await service.execute(p, 'rename', input)).toEqual(saved)
  await service.execute(p, 'create', { id: 'freed', name: 'first' })
  await service.execute(p, 'update', { id: 'record', revision: 2, patch: { name: 'third' } })
  const after = db.query('SELECT * FROM records ORDER BY id').all()
  deniedRevision = 3; observed.length = 0
  await expect(service.execute(p, 'rename', input)).rejects.toMatchObject({ status: 403 })
  expect(observed).toEqual([3])
  expect(db.query('SELECT * FROM records ORDER BY id').all()).toEqual(after)
  deniedRevision = undefined
  expect((await service.execute(p, 'list', {}) as any).rows).toHaveLength(2)
  const auxiliary = db.query("SELECT id FROM records WHERE id LIKE 'command/%'").get() as { id: string }
  await expect(service.execute(p, 'get', { id: auxiliary.id })).rejects.toMatchObject({ status: 404 })
 } finally { db.close() }
})

test('conditional identities reserve only live records, release atomically and roll back a late denied release',async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))');const store=createSqlRecordStore<any>('records',{dialect:'sqlite',execute:async(_t,s,b)=>/^SELECT/.test(s)?{rows:db.query(s).all(...b as any[]) as any[]}:{affectedRows:db.query(s).run(...b as any[]).changes}}),repository=createAtomicRepository('records',createSqliteAtomicDriver(db));let fail=false
 const input={type:'object',additionalProperties:false,properties:{id:{type:'string'},slot:{type:'string'},status:{enum:['active','inactive']}},required:['id','slot','status']} as const,update={type:'object',additionalProperties:false,properties:{id:{type:'string'},revision:{type:'integer'},patch:{type:'object',additionalProperties:false,properties:{status:{enum:['active','inactive']}}}},required:['id','revision','patch']} as const
 const service=new ScopedRecordService<any,any>({store,repository,authorize:async(_p,_o,_a,r)=>{if(fail&&r?.status==='inactive'){const row=await store.read('a',r.id);if(row?.value.status==='inactive')return false}return true}},{schemas:{...schemas,create:input,update},operations,listKey:'rows',label:'Conditional',pagination:true,unique:[{name:'slot',fields:['slot'],when:v=>v.status==='active'}],create:(a)=>({...a,tenantId:'a'}),update:(v,patch)=>Object.assign(v,patch),archive:(v)=>{v.status='inactive'}})
 try{await service.execute(p,'create',{id:'first',slot:'one',status:'active'});await service.execute(p,'create',{id:'history',slot:'one',status:'inactive'});await expect(service.execute(p,'create',{id:'duplicate',slot:'one',status:'active'})).rejects.toMatchObject({status:409});fail=true;await expect(service.execute(p,'update',{id:'first',revision:1,patch:{status:'inactive'}})).rejects.toMatchObject({status:403});expect((await store.read('a','first'))?.value.status).toBe('active');await expect(service.execute(p,'create',{id:'still-reserved',slot:'one',status:'active'})).rejects.toMatchObject({status:409});fail=false;await service.execute(p,'update',{id:'first',revision:1,patch:{status:'inactive'}});await service.execute(p,'create',{id:'new',slot:'one',status:'active'});await expect(service.execute(p,'update',{id:'history',revision:1,patch:{status:'active'}})).rejects.toMatchObject({status:409});expect((await service.execute(p,'list',{}) as any).rows).toHaveLength(3)}finally{db.close()}
})

test('owning write composition requires atomic storage, isolates callback arguments and rolls back final revocation with receipts',async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))');const store=createSqlRecordStore<any>('records',{dialect:'sqlite',execute:async(_t,s,b)=>/^SELECT/.test(s)?{rows:db.query(s).all(...b as any[]) as any[]}:{affectedRows:db.query(s).run(...b as any[]).changes}}),repository=createAtomicRepository('records',createSqliteAtomicDriver(db));let live=true,revoke=false,calls=0
 const definition={schemas:{create:{type:'object',additionalProperties:false,properties:{id:{type:'string'},commandId:{type:'string'}},required:['id','commandId']}},operations,listKey:'rows',label:'Owning fixture',create:(args:any,principal:any)=>({id:args.id,tenantId:principal.tenantId}),update:()=>{},archive:()=>{},afterWrite:async(principal:any,_operation:string,args:any,current:any)=>{calls++;expect((await store.read('a',current.id))?.revision).toBe(current.revision);principal.tenantId='foreign';args.id='tampered';current.tenantId='foreign';if(revoke)live=false}}
 const service=new ScopedRecordService<any,any>({store,repository,authorize:async()=>live},definition)
 try{const args={id:'one',commandId:'one'},saved=await service.execute(p,'create',args);expect(saved).toMatchObject({id:'one',tenantId:'a'});expect(args.id).toBe('one');expect(await service.execute(p,'create',args)).toEqual(saved);expect(calls).toBe(1);const before=db.query('SELECT * FROM records ORDER BY id').all();revoke=true;await expect(service.execute(p,'create',{id:'late',commandId:'late'})).rejects.toMatchObject({status:403});expect(db.query('SELECT * FROM records ORDER BY id').all()).toEqual(before);live=true;const unsafe=new ScopedRecordService<any,any>({store,authorize:async()=>true},{...definition,schemas:{create:{type:'object',properties:{id:{type:'string'}}}}});await expect(unsafe.execute(p,'create',{id:'unsafe'})).rejects.toMatchObject({status:409});expect(await store.read('a','unsafe')).toBeNull()}finally{db.close()}
})

test('optional command receipts serialize once when supplied and preserve ordinary commands without an id',async()=>{
 const db=new Database(':memory:');db.exec('CREATE TABLE records(tenant_id TEXT,id TEXT,revision INTEGER,payload TEXT,PRIMARY KEY(tenant_id,id))');const store=createSqlRecordStore<any>('records',{dialect:'sqlite',execute:async(_t,s,b)=>/^SELECT/.test(s)?{rows:db.query(s).all(...b as any[]) as any[]}:{affectedRows:db.query(s).run(...b as any[]).changes}}),repository=createAtomicRepository('records',createSqliteAtomicDriver(db));let created=0
 const optional={type:'object',additionalProperties:false,properties:{commandId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$'},name:{type:'string'}},required:['name']}
 const definition={schemas:{create:optional,mandatory:{...optional,required:['name','commandId']}},operations,listKey:'rows',label:'Optional receipt',create:(a:any)=>({tenantId:'a',id:String(++created),name:a.name}),update:()=>{},archive:()=>{},custom:{mandatory:()=>{}}}
 const service=new ScopedRecordService<any,any>({store,repository,authorize:async()=>true},definition)
 try{const a={name:'once',commandId:'same'},saved=await service.execute(p,'create',a);expect(await service.execute(p,'create',a)).toEqual(saved);expect(created).toBe(1);expect((await service.execute(p,'create',{name:'again'})as any).id).toBe('2');expect((await service.execute(p,'create',{name:'again'})as any).id).toBe('3');await expect(service.execute(p,'create',{name:'bad',commandId:1})).rejects.toMatchObject({status:400});await expect(service.execute(p,'mandatory',{name:'missing'})).rejects.toMatchObject({status:400});expect(created).toBe(3)}finally{db.close()}
})
