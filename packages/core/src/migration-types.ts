/**
 * Ordered SQL statements for a plugin or shared data-contract migration, separated by driver and execution scope.
 * @see {@link collectSchemaMigrations}
 */
export interface PluginMigration { 
  /** Stable historical migration-ledger identity; validated contract sources require unique IDs. */
  id:string; 
  
  /** Whether the host applies this migration once per database or within each tenant scope. */
  scope:'database'|'tenant'; 
/** Driver-keyed ordered SQL statements; hosts select a supported driver and own execution transactions. */
  sql:Partial<Record<'sqlite'|'oracle'|'postgres',string[]>> }
