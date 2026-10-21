import Ajv from 'ajv'
import { randomUUID } from 'node:crypto'
import { assertPrincipal, PluginError, type PluginPrincipal } from './index'
import { atomicCommand, atomicHash, type AtomicRow, type AtomicRepository } from './atomic'
/**
 * Immutable staged artifact identity, content hash and size returned by the host builder.
 * 
 * @see ArtifactDeliveryService for canonical host integration.
 */
export interface DeliveryArtifact {
  /**
   * Immutable host artifact key, at most 1000 characters.
   */
  key:string;
  /**
   * Lowercase 64-character SHA-256 for the staged artifact.
   */
  contentHash:string;
  /**
   * Positive safe-integer artifact size in bytes.
   */
  bytes:number}
/**
 * Exact target/content/approval identity requested for one public channel delivery.
 * 
 * @see ArtifactDeliveryService for canonical host integration.
 */
export interface DeliveryRequest {
  /**
   * Stable delivery job identity within its tenant repository.
   */
  jobId:string;
  /**
   * Host-defined publication channel serialized against other unfinished delivery work.
   */
  channel:string;
  /**
   * publish stages an artifact; withdraw starts at activation/withdrawal without a build.
   */
  kind:'publish'|'withdraw';
  /**
   * Exact host-owned public destination metadata bound to the approval request.
   */
  target:Record<string,unknown>;
  /**
   * Reviewed source-content SHA-256; the host verifies exact target/hash/approval binding.
   */
  contentHash:string;
  /**
   * Exact host approval request admitting this public delivery; reader access alone is insufficient.
   */
  approvalRequestId:string}
/**
 * Durable delivery phase, worker ownership and retry state for one approved publication/withdrawal.
 * 
 * @see ArtifactDeliveryService for canonical host integration.
 */
export interface DeliveryJob extends DeliveryRequest {
  /**
   * Authenticated user who enqueued the approved request.
   */
  requestedBy:string;
  /**
   * Trusted UTC ISO enqueue time.
   */
  createdAt:string;
  /**
   * queued/running/failed/done/cancelled state retained with CAS revisions.
   */
  state:'queued'|'running'|'failed'|'done'|'cancelled';
  /**
   * Last durable build/activate/purge/cancel/done phase; uncertain external effects are retried idempotently.
   */
  phase:'build'|'activate'|'purge'|'cancel'|'done';
  /**
   * Number of worker claims; incremented when a new run owns the job.
   */
  attempts:number;
  /**
   * Worker ownership token; recovery requires proving prior workers drained rather than waiting for expiry.
   */
  token?:string;
  /**
   * Optional immutable build artifact used by the activation stage.
   */
  artifact?:DeliveryArtifact;
  /**
   * Sanitized failure notice; sensitive host details remain in host-owned logs.
   */
  error?:string}
/**
 * Host publication approval, immutable artifact and idempotent external delivery capabilities.
 * 
 * @see ArtifactDeliveryService for canonical host integration.
 */
export interface DeliveryPorts {
  /**
   * Verify public publication/withdrawal approval for the exact target and content.
   * 
   * Verify explicit PUBLIC publication (or withdrawal) permission, exact target/hash and approval. Ordinary reader access is insufficient.
   * @param p - Verified principal requiring explicit public publication/withdrawal permission.
   * @param job - Pinned request/job with exact approved target/contentHash/approvalRequestId.
   * @returns Exactly true only when public permission and exact binding/approval remain valid.
   * @throws Rejects host permission, artifact, delivery or worker-control failures; external effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { DeliveryPorts, DeliveryRequest, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function verifyReviewed(ports: DeliveryPorts, principal: PluginPrincipal, job: DeliveryRequest) {
   *   // The host binds permission and external effects to this exact job.
   *   return ports.verify(principal, job);
   * }
   * ```
   */
  verify(p:PluginPrincipal,job:DeliveryRequest):Promise<boolean>
  /**
   * Build and stage an immutable artifact outside the database transaction.
   * 
   * Build and stage an immutable artifact outside a DB transaction. Must be idempotent for jobId.
   * @param p - Verified current principal.
   * @param job - Durable job carrying the stable jobId idempotency identity.
   * @returns An immutable staged artifact key, lowercase hash and positive safe byte size.
   * @throws Rejects host permission, artifact, delivery or worker-control failures; external effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { DeliveryPorts, DeliveryJob, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function buildReviewed(ports: DeliveryPorts, principal: PluginPrincipal, job: DeliveryJob) {
   *   // The host binds permission and external effects to this exact job.
   *   return ports.build(principal, job);
   * }
   * ```
   */
  build(p:PluginPrincipal,job:DeliveryJob):Promise<DeliveryArtifact>
  /**
   * Apply or withdraw the exact public channel version idempotently.
   * 
   * Atomic, idempotent channel update/withdrawal. Serialize with other host publishers; key=jobId.
   * @param p - Verified current principal.
   * @param job - Exact pinned publish/withdraw job, including staged artifact when publishing.
   * @returns Resolves without a value after the idempotent channel switch/withdrawal.
   * @throws Rejects host permission, artifact, delivery or worker-control failures; external effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { DeliveryPorts, DeliveryJob, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function activateReviewed(ports: DeliveryPorts, principal: PluginPrincipal, job: DeliveryJob) {
   *   // The host binds permission and external effects to this exact job.
   *   await ports.activate(principal, job);
   * }
   * ```
   */
  activate(p:PluginPrincipal,job:DeliveryJob):Promise<void>
  /**
   * Invalidate the delivered channel idempotently before recording completion.
   * 
   * Idempotent CDN invalidation; completion is recorded only after success.
   * @param p - Verified current principal.
   * @param job - Exact job channel/version requiring invalidation.
   * @returns Resolves without a value only after actual idempotent invalidation succeeds.
   * @throws Rejects host permission, artifact, delivery or worker-control failures; external effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { DeliveryPorts, DeliveryJob, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function purgeReviewed(ports: DeliveryPorts, principal: PluginPrincipal, job: DeliveryJob) {
   *   // The host binds permission and external effects to this exact job.
   *   await ports.purge(principal, job);
   * }
   * ```
   */
  purge(p:PluginPrincipal,job:DeliveryJob):Promise<void>
  /**
   * Reconcile uncertain job effects and purge only this job's owned version.
   * 
   * Reconcile any uncertain activation for this job and purge it, idempotently. Never remove a newer publisher's version.
   * @param p - Verified current principal admitted for cancellation.
   * @param job - Pinned job whose uncertain effects need reconciliation.
   * @returns Resolves without a value after idempotent reconciliation/purge of only this owned version; never remove newer publications.
   * @throws Rejects host permission, artifact, delivery or worker-control failures; external effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { DeliveryPorts, DeliveryJob, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function cancelReviewed(ports: DeliveryPorts, principal: PluginPrincipal, job: DeliveryJob) {
   *   if (!ports.cancel) throw new Error("Required recovery port unavailable");
   *   // The host binds permission and external effects to this exact job.
   *   await ports.cancel(principal, job);
   * }
   * ```
   */
  cancel?(p:PluginPrincipal,job:DeliveryJob):Promise<void>
  /**
   * Prove prior workers for this job token can no longer perform effects.
   * @param p - Verified principal admitted for recovery.
   * @param job - Exact running job revision/token whose prior workers must be stopped.
   * @returns Exactly true only when prior workers cannot perform further effects; false/absence prevents recovery.
   * @throws Rejects host permission, artifact, delivery or worker-control failures; external effects may already be partially complete.
   
   * @example
   * ```typescript
   * import type { DeliveryPorts, DeliveryJob, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export async function drainedReviewed(ports: DeliveryPorts, principal: PluginPrincipal, job: DeliveryJob) {
   *   if (!ports.drained) throw new Error("Required recovery port unavailable");
   *   // The host binds permission and external effects to this exact job.
   *   return ports.drained(principal, job);
   * }
   * ```
   */
  drained?(p:PluginPrincipal,job:DeliveryJob):Promise<boolean>
}
/**
 * Supported durable delivery command names; each requires live host resource/publication authorization.
 * 
 * @see ArtifactDeliveryService for canonical usage.
 */
export const deliveryOperations=['enqueue_delivery','get_delivery','run_delivery','recover_delivery','cancel_delivery'] as const
const id={type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'}
/**
 * Closed schema for a new approved delivery request with stable command/job/target/content identities.
 * 
 * @see ArtifactDeliveryService for canonical usage.
 */
export const enqueueDeliverySchema={type:'object',additionalProperties:false,required:['commandId','jobId','channel','kind','target','contentHash','approvalRequestId'],properties:{commandId:id,jobId:id,channel:id,kind:{enum:['publish','withdraw']},target:{type:'object',maxProperties:10,additionalProperties:true},contentHash:hash,approvalRequestId:id}}
/**
 * Closed schema selecting an existing delivery job by its stable identifier.
 * 
 * @see ArtifactDeliveryService for canonical usage.
 */
export const deliveryJobSchema={type:'object',additionalProperties:false,required:['jobId'],properties:{jobId:id}}
/**
 * Closed schema requiring the exact job revision for explicit drained-worker recovery.
 * 
 * @see ArtifactDeliveryService for canonical usage.
 */
export const recoverDeliverySchema={type:'object',additionalProperties:false,required:['jobId','revision'],properties:{jobId:id,revision:{type:'integer',minimum:1,maximum:9007199254740990}}}
const ajv=new Ajv({strict:true}),validators={enqueue_delivery:ajv.compile(enqueueDeliverySchema),cancel_delivery:ajv.compile(deliveryJobSchema),get_delivery:ajv.compile(deliveryJobSchema),run_delivery:ajv.compile(deliveryJobSchema),recover_delivery:ajv.compile(recoverDeliverySchema)}
/**
 * Coordinates durable approved publication/withdrawal jobs with channel ownership and resumable idempotent host effects.
 * 
 * @remarks
 * Requires a real atomic repository and host public-approval/build/channel/purge ports. Channel locks serialize unfinished jobs per tenant/repository. External build/activate/purge/cancel run outside database transactions; a failed reply can follow a completed external effect. Ports must deduplicate by stable jobId. Recovery requires proof that previous workers drained, never an elapsed lease alone.
 * 
 * @example
 * ```typescript
 * import { ArtifactDeliveryService } from '@alneas/eaos-server/plugin-data';
 * export function connectDelivery(options: ConstructorParameters<typeof ArtifactDeliveryService>[0]) { return new ArtifactDeliveryService(options); }
 * ```
 */
export class ArtifactDeliveryService {
  /**
   * Binds the host atomic delivery ledger, public publication ports and live operation authorization.
   * @param options - Real atomic repository, idempotent host delivery ports and current operation/resource authorization; construction does not validate or execute those ports.
   * 
   * @example
   * ```typescript
   * import { ArtifactDeliveryService } from '@alneas/eaos-server/plugin-data';
   * export function connectDelivery(options: ConstructorParameters<typeof ArtifactDeliveryService>[0]) { return new ArtifactDeliveryService(options); }
   * ```
   */
  constructor(private readonly options:{
    /**
     * Real atomic delivery ledger used for jobs, channel ownership and enqueue command receipts.
     */
    repository:AtomicRepository;
    /**
     * Host public-approval, artifact, channel, purge and recovery adapters with stable jobId idempotency.
     */
    ports:DeliveryPorts;
    /**
     * Live operation/resource permission callback; exactly true admits, false denies; schema validation follows initial admission.
     * @param p - Verified current tenant/user principal.
     * @param operation - Declared operation name.
     * @param input - Operation input to validate and authorize at the owning service boundary.
     * @param resource - Optional current delivery job/resource when available.
     * @returns Exactly true to admit the current operation; false denies.
     * @throws Rejects underlying service, authorization or persistence failures.
     
     * @example
     * ```typescript
     * import type { ArtifactDeliveryService, PluginPrincipal } from '@alneas/eaos-server/plugin-data';
     * export async function canEnqueue(options: ConstructorParameters<typeof ArtifactDeliveryService>[0], principal: PluginPrincipal, input: unknown) {
     *   return await options.authorize(principal, "enqueue_delivery", input) === true;
     * }
     * ```
     */
    authorize(p:PluginPrincipal,operation:string,input:unknown,resource?:unknown):Promise<boolean>}){}
 private async allow(p:PluginPrincipal,op:string,a:unknown,j?:DeliveryJob){assertPrincipal(p);if(await this.options.authorize(structuredClone(p),op,structuredClone(a),structuredClone(j))!==true)throw new PluginError(403,'Delivery access denied')}
 private async verify(p:PluginPrincipal,j:DeliveryRequest){if(await this.options.ports.verify(p,structuredClone(j))!==true)throw new PluginError(403,'Public delivery approval unavailable')}
  /**
   * Enqueues, reads, runs, cancels or explicitly recovers one durable approved delivery job.
   * @param p - Verified current tenant principal; operation/resource admission is rechecked before transitions.
   * @param op - One of deliveryOperations; each input is checked by its closed schema.
   * @param a - jobId for every operation; enqueue additionally needs commandId/channel/kind/target/contentHash/approvalRequestId, and recovery needs the exact running job revision.
   * @returns The durable AtomicRow<DeliveryJob>, possibly an existing identical enqueue receipt or already terminal job; query get_delivery for current state after receipt replay.
   * @throws Rejects invalid principal/input (401/400), denied live/public approval (403), absent job (404), busy channel/worker, stale recovery or unavailable cancellation port (409), invalid built artifact and propagated repository/port failures; effects may already have occurred.
   * 
   * @remarks
   * Publish starts at build, withdrawal at activate; completion follows successful purge. Cancellation requires a reconciliation port and never removes a newer host version. Completed jobs require a new withdrawal job instead of cancellation. Recovery requires exact revision and drained(old token), marks failed and clears ownership for retry. Failure retains the last durable phase and a sanitized error, while the original host error may reject the call.
   * 
   * @example
   * ```typescript
   * import { ArtifactDeliveryService, type PluginPrincipal } from '@alneas/eaos-server/plugin-data';
   * export function readDelivery(service: ArtifactDeliveryService, principal: PluginPrincipal, jobId: string) { return service.execute(principal, 'get_delivery', { jobId }); }
   * ```
   */
  async execute(p:PluginPrincipal,op:string,a:{
    /**
     * Stable job ID required by every delivery operation; 1–80 letters/digits/underscore/hyphen characters.
     */
    jobId:string;
    /**
     * Exact current positive running-job revision required only for explicit drained-worker recovery.
     */
    revision?:number;
    /**
     * Stable enqueue idempotency ID; identical input replays the original receipt and conflicting reuse rejects.
     */
    commandId?:string}&Partial<DeliveryRequest>):Promise<any>{
  p=structuredClone(p);a=structuredClone(a)
  await this.allow(p,op,a)
  if(!Object.hasOwn(validators,op)||!validators[op as keyof typeof validators](a))throw new PluginError(400,'Invalid delivery job')
  const repo=this.options.repository,ports=this.options.ports,key='delivery/'+a.jobId
  if(op==='enqueue_delivery'){
   if(!a.commandId||!a.channel||!a.target||!['publish','withdraw'].includes(a.kind??'')||!/^[a-f0-9]{64}$/.test(a.contentHash??'')||!a.approvalRequestId||JSON.stringify(a.target).length>4000)throw new PluginError(400,'Invalid delivery request')
   await this.verify(p,a as DeliveryRequest)
   return repo.run(p,async tx=>atomicCommand(tx,p,op,a as any,async()=>{
    const j:DeliveryJob={jobId:a.jobId,channel:a.channel!,kind:a.kind!,target:a.target!,contentHash:a.contentHash!,approvalRequestId:a.approvalRequestId!,requestedBy:p.userId,createdAt:new Date().toISOString(),state:'queued',phase:a.kind==='publish'?'build':'activate',attempts:0}
    const channel='delivery-channel/'+atomicHash(j.channel),lock=await tx.get<{jobId:string|null}>(channel)
    if(lock?.value.jobId)throw new PluginError(409,'Channel has unfinished delivery')
    await this.allow(p,op,a,j);await tx.put(channel,{jobId:j.jobId},lock?.revision??0)
    return tx.put(key,j,0)
   }))
  }
  const row=await repo.run(p,tx=>tx.get<DeliveryJob>(key));if(!row)throw new PluginError(404,'Delivery unavailable')
  await this.allow(p,op,a,row.value)
  if(op==='get_delivery')return row
  if(op==='recover_delivery'){
   if(row.revision!==a.revision||row.value.state!=='running'||await ports.drained?.(p,structuredClone(row.value))!==true)throw new PluginError(409,'Recovery requires a drained worker at this revision')
   return repo.run(p,async tx=>{await this.allow(p,op,a,row.value);const j={...row.value,state:'failed' as const};delete j.token;return tx.put(key,j,row.revision)})
  }
  if(['done','cancelled'].includes(row.value.state)){if(op==='cancel_delivery'&&row.value.state==='done')throw new PluginError(409,'Use a new withdrawal job for completed delivery');return row}
  if(row.value.state==='running')throw new PluginError(409,'Delivery worker already running')
  if(op==='cancel_delivery'&&!ports.cancel)throw new PluginError(409,'Cancellation reconciliation port unavailable')
  if(op!=='cancel_delivery'&&!['purge','cancel'].includes(row.value.phase))await this.verify(p,row.value)
  let current:AtomicRow<DeliveryJob>=await repo.run(p,async tx=>{await this.allow(p,op,a,row.value);return tx.put(key,{...row.value,...(op==='cancel_delivery'?{phase:'cancel' as const}:{}),state:'running' as const,token:randomUUID(),attempts:row.value.attempts+1,error:undefined},row.revision)})
  try{
   while(current.value.phase!=='done'){
    const j=current.value;await this.allow(p,op,a,j);if(!['purge','cancel'].includes(j.phase))await this.verify(p,j)
    let patch:Partial<DeliveryJob>
    if(j.phase==='cancel'){await this.allow(p,'cancel_delivery',a,j);if(!ports.cancel)throw new PluginError(409,'Cancellation reconciliation port unavailable');await ports.cancel(p,structuredClone(j));patch={phase:'done',state:'cancelled'}}else if(j.phase==='build'){
     const artifact=await ports.build(p,structuredClone(j))
     if(!artifact||typeof artifact.key!=='string'||artifact.key.length>1000||!/^[a-f0-9]{64}$/.test(artifact.contentHash)||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<1)throw new Error('Invalid delivery artifact')
     patch={artifact,phase:'activate'}
    }else if(j.phase==='activate'){await ports.activate(p,structuredClone(j));patch={phase:'purge'}}
    else {await ports.purge(p,structuredClone(j));patch={phase:'done',state:'done'}}
    current=await repo.run(p,async tx=>{
     await this.allow(p,op,a,j)
     const saved=await tx.put(key,{...j,...patch},current.revision)
     if(patch.phase==='done'){
      const ck='delivery-channel/'+atomicHash(j.channel),lock=await tx.get<{jobId:string|null}>(ck)
      if(lock?.value.jobId!==j.jobId)throw new PluginError(409,'Delivery channel ownership changed')
      await tx.put(ck,{jobId:null},lock.revision)
     }
     return saved
    })
   }
   return current
  }catch(e){
   // Preserve the last durable phase. An uncertain external side effect is repeated with the same jobId.
   await repo.run(p,async tx=>{const fresh=await tx.get<DeliveryJob>(key);if(fresh&&fresh.value.token===current.value.token&&fresh.value.state==='running')await tx.put(key,{...fresh.value,state:'failed',error:'Delivery step failed; inspect host logs and retry'},fresh.revision)})
   throw e
  }
 }
}
