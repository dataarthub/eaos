import {assertPrincipal,PluginError,type PluginPrincipal} from './index'
import {atomicHash,type AtomicSession} from './atomic'
/**
 * Version-1 hash-linked journal event storing payload hashes and optional command receipt identity.
 * 
 * @see appendAtomicAudit for canonical host integration.
 */
export interface AtomicAuditEvent {
  /**
   * Persisted journal schema version; must be 1.
   */
  version:1;
  /**
   * Tenant identity bound by the trusted principal; never selected as an authorization grant from request data.
   */
  tenantId:string;
  /**
   * Positive monotonically increasing journal position within the tenant/namespace.
   */
  sequence:number;
  /**
   * Trusted operation label recorded for this admitted command.
   */
  operation:string;
  /**
   * Verified actor identity at append time.
   */
  actorId:string;
  /**
   * UTC ISO append timestamp.
   */
  at:string;
  /**
   * Hash of JSON-normalized command input; no input payload bytes are stored here.
   */
  inputHash:string;
  /**
   * Hash of JSON-normalized command result; undefined is normalized to null.
   */
  resultHash:string;
  /**
   * Optional immutable command receipt key, otherwise null.
   */
  commandKey:string|null;
  /**
   * Previous journal event hash, or null for the first event.
   */
  previousHash:string|null;
  /**
   * Canonical hash of the other event fields; not an external signature.
   */
  hash:string}
interface Head {version:1;tenantId:string;sequence:number;hash:string}
const eventKey=(sequence:number)=>'audit/event/'+String(sequence).padStart(16,'0')
const jsonHash=(value:unknown)=>atomicHash(value===undefined?null:JSON.parse(JSON.stringify(value)))
/**
 * Append a hash-linked immutable audit event and CAS-update its head in the current transaction.
 * @param tx - Live atomic session shared with the domain command.
 * @param p - Verified tenant/user principal.
 * @param operation - Trusted nonempty operation label of at most 240 characters.
 * @param input - Input whose JSON-normalized hash is recorded; payload bytes are not stored in the audit event.
 * @param result - Result whose JSON-normalized hash is recorded; undefined is normalized to null.
 * @param commandKey - Optional command/ receipt key linking command input/result evidence; defaults to null.
 * @returns The appended version-1 event with sequence and integrity hash.
 * @throws Rejects invalid principals/labels/receipt keys, corrupt head/previous event, sequence capacity or transaction failures.
 * @remarks Requires the caller's existing transaction and current authorization. Hash continuity is not an external trust anchor; real business payloads remain outside audit events.
 * @example
 * import { appendAtomicAudit } from '@alneas/eaos-server/plugin-data'
 * export function audit(tx: Parameters<typeof appendAtomicAudit>[0], p: Parameters<typeof appendAtomicAudit>[1], input: unknown, result: unknown) { return appendAtomicAudit(tx, p, 'example-operation', input, result) }
 */
export async function appendAtomicAudit(tx:AtomicSession,p:PluginPrincipal,operation:string,input:unknown,result:unknown,commandKey:string|null=null){assertPrincipal(p);if(!operation||operation.length>240||commandKey!==null&&!commandKey.startsWith('command/'))throw new PluginError(400,'Invalid trusted audit operation');const head=await tx.get<Head>('audit/head');if(head&&(head.value.version!==1||head.value.tenantId!==p.tenantId||!Number.isSafeInteger(head.value.sequence)||head.value.sequence<1||!/^[a-f0-9]{64}$/.test(head.value.hash)))throw new PluginError(409,'Audit head differs');if(head){const previous=await tx.get<AtomicAuditEvent>(eventKey(head.value.sequence));if(!previous||previous.value.hash!==head.value.hash)throw new PluginError(409,'Previous audit event unavailable');const {hash,...v}=previous.value;if(hash!==atomicHash(v))throw new PluginError(409,'Previous audit integrity differs')}const sequence=(head?.value.sequence??0)+1;if(!Number.isSafeInteger(sequence)||sequence>1e12)throw new PluginError(409,'Audit sequence at capacity');const value:Omit<AtomicAuditEvent,'hash'>={version:1,tenantId:p.tenantId,sequence,operation,actorId:p.userId,at:new Date().toISOString(),inputHash:jsonHash(input),resultHash:jsonHash(result),commandKey,previousHash:head?.value.hash??null},event={...value,hash:atomicHash(value)};await tx.put(eventKey(sequence),event,0);await tx.put('audit/head',{version:1,tenantId:p.tenantId,sequence,hash:event.hash},head?.revision??0);return event}
/**
 * Read and verify one bounded page of immutable tenant audit events.
 * @param tx - Live tenant-scoped atomic session.
 * @param p - Verified principal whose tenant must match each event.
 * @param afterSequence - Exclusive nonnegative sequence; defaults to 0.
 * @param limit - Integer page size from 1 to 100; defaults to 50.
 * @returns Verified events and a continuation sequence or null when no further row was observed.
 * @throws Rejects invalid pagination, event identity/version/revision/hash mismatches or store failures.
 * @remarks Caller enforces current resource permission before and after reading. One page does not verify full chain continuity or an external trust anchor.
 * @example
 * import { readAtomicAudit } from '@alneas/eaos-server/plugin-data'
 * export function auditPage(tx: Parameters<typeof readAtomicAudit>[0], p: Parameters<typeof readAtomicAudit>[1]) { return readAtomicAudit(tx, p, 0, 50) }
 */
export async function readAtomicAudit(tx:AtomicSession,p:PluginPrincipal,afterSequence=0,limit=50){assertPrincipal(p);if(!Number.isSafeInteger(afterSequence)||afterSequence<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new PluginError(400,'Invalid audit page');const rows=await tx.list<AtomicAuditEvent>('audit/event/',afterSequence?eventKey(afterSequence):'',limit+1);const events:AtomicAuditEvent[]=[];for(const row of rows.slice(0,limit)){const {hash,...v}=row.value;if(v.tenantId!==p.tenantId||v.version!==1||!Number.isSafeInteger(v.sequence)||v.sequence<1||row.id!==eventKey(v.sequence)||row.revision!==1||hash!==atomicHash(v))throw new PluginError(409,'Audit event integrity differs');events.push(row.value)}return{events,nextSequence:rows.length>limit?events.at(-1)!.sequence:null}}
/**
 * Verify a bounded audit chain, its head and linked command receipts within the current tenant transaction.
 * @param tx - Live atomic session containing the journal and receipts.
 * @param p - Verified tenant/user principal with host-admitted audit access.
 * @returns Tenant identity, verified event count/head hash and explicit externalTrustAnchor=false.
 * @throws Rejects more than 10000 events, discontinuous sequence/hash links, receipt mismatches, corrupt head/tail or store failures.
 * @remarks Integrity verification cannot prove an external actor has not rewritten the entire journal. Larger histories need the host's reviewed archival verifier.
 * @example
 * import { verifyAtomicAudit } from '@alneas/eaos-server/plugin-data'
 * export function verifyJournal(tx: Parameters<typeof verifyAtomicAudit>[0], p: Parameters<typeof verifyAtomicAudit>[1]) { return verifyAtomicAudit(tx, p) }
 */
export async function verifyAtomicAudit(tx:AtomicSession,p:PluginPrincipal){assertPrincipal(p);const head=await tx.get<Head>('audit/head');let after=0,count=0,previousHash:string|null=null;for(;;){const page=await readAtomicAudit(tx,p,after,100);for(const event of page.events){if(++count>10000)throw new PluginError(409,'Audit verification exceeds 10000 events; host archival verifier required');if(event.sequence!==count||event.previousHash!==previousHash)throw new PluginError(409,'Audit sequence or previous hash differs');if(event.commandKey){const receipt=await tx.get<{hash:string;result:unknown}>(event.commandKey);if(!receipt||receipt.revision!==1||receipt.value.hash!==event.inputHash||jsonHash(receipt.value.result)!==event.resultHash)throw new PluginError(409,'Audit command receipt differs')}previousHash=event.hash;after=event.sequence}if(page.nextSequence===null)break}if(count===0&&head||count>0&&(!head||head.value.version!==1||head.value.tenantId!==p.tenantId||head.value.sequence!==count||head.value.hash!==previousHash))throw new PluginError(409,'Audit head or event tail differs');return{tenantId:p.tenantId,status:'verified' as const,count,headHash:previousHash,coverage:'atomic-journal-v1' as const,externalTrustAnchor:false as const}}
