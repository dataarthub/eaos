import {test,expect} from 'bun:test'
import type {DataContract} from '@alneas/eaos-core/contracts/data-contracts'
import {MigrationAggregator} from '../../src/db-package/migration/aggregator'
const schema=(name='notes')=>({'x-db':{tableName:name},type:'object',properties:{tenant_id:{type:'string'},id:{type:'string'}},required:['tenant_id','id']})
const contract=(id='notes',extras:Partial<DataContract>={}):DataContract=>({id,version:'1.2.0',description:'Isolated fixture',schema:schema(id),migrations:[{id:'initial',scope:'database',sql:{sqlite:[`CREATE TABLE ${id} (tenant_id TEXT NOT NULL, id TEXT)`]}}],...extras})
test('schema aggregation uses contract dependency order, skips feature copies, and collects ordered extensions',()=>{
 const p=(id:string,order?:number,extra:any={})=>({id,name:id,schema:{migrationOrder:order},...extra}) as any
 const plugins=[p('later',20,{extensions:[{id:'extra'},{id:'missing'}]}),p('feature',1,{schema:{dataContracts:{notes:'^1'}}}),p('earlier',2),p('none')],calls:string[]=[]
 const sources=new MigrationAggregator(plugins,[contract()]).collectSchemas((id,extension)=>{calls.push(id+(extension?':'+extension:''));return id==='none'||extension==='missing'?null:{tables:{}}})
 expect(sources.map(s=>s.pluginId+(s.extensionId?':'+s.extensionId:''))).toEqual(['data:notes','earlier','later','later:extra'])
 expect(calls).not.toContain('feature');expect(plugins[0].id).toBe('later')
 expect(()=>new MigrationAggregator([p('a',0,{schema:{dataContracts:{notes:'^2'}}})],[contract()]).collectSchemas(()=>null)).toThrow('Unsatisfied')
 expect(()=>new MigrationAggregator([]).generatePostgres([{pluginId:'canonical',schemaJson:schema()}])).toThrow('reviewed lifecycle')
 expect(()=>new MigrationAggregator([]).generateOracle([{pluginId:'canonical',schemaJson:{$defs:{notes:schema()}}}])).toThrow('reviewed lifecycle')
})
