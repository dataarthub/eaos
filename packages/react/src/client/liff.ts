/**
 * Presentation-only LIFF profile fields without provider credentials.
 *
 * @see createLiffClient for a complete host integration example.
 */
export interface LiffProfile {
/**
 * Nonblank LINE user ID for presentation only.
 */
  userId: string;
/**
 * Display name supplied by LIFF.
 */
  displayName: string;
/**
 * Optional profile picture URL passed through as text.
 */
  pictureUrl?: string;
/**
 * Optional presentation status message.
 */
  statusMessage?: string }
/**
 * Structural contract for the host-installed LINE LIFF SDK.
 *
 * @see createLiffClient for a complete host integration example.
 *
 * @remarks
 * Structural interface accepted by @line/liff; the host supplies its installed SDK instance.
 */
export interface LiffAdapter {
 /**
 * Initialize the installed SDK for the given liffId; rejects SDK setup failure.
 * @param options - SDK initialization or redirect options supplied by the host wrapper.
 * @returns Resolves without a value after SDK initialization.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function initializeInstalledLiff(sdk: LiffAdapter, liffId: string) {
 *  await sdk.init({ liffId });
 *  return sdk.isLoggedIn();
 * }
 * ```
 */
init(options: { 
    /**
     * Registered LIFF application ID supplied by the host-installed SDK wrapper.
     */
    liffId: string }): Promise<void>
 /**
 * Synchronously report the SDK login state.
 * @returns Whether the installed SDK has a current login.
 *
 * @example
 * ```typescript
 * import type { LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export function loginState(initializedSdk: LiffAdapter) { return initializedSdk.isLoggedIn(); }
 * ```
 */
isLoggedIn(): boolean
 /**
 * Request provider login using the configured HTTPS redirectUri; no value is returned.
 * @param options - SDK initialization or redirect options supplied by the host wrapper.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export function requestLogin(initializedSdk: LiffAdapter, registeredHttpsRedirectUri: string) {
 *  if (!initializedSdk.isLoggedIn()) initializedSdk.login({ redirectUri: registeredHttpsRedirectUri });
 * }
 * ```
 */
login(options: { 
    /**
     * Host-approved registered HTTPS return URI used by createLiffClient when requesting login.
     */
    redirectUri: string }): void
 /**
 * Clear SDK login state; no value is returned.
 * @returns Completes without a value after the requested side effect.
 *
 * @example
 * ```typescript
 * import type { LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export function signOut(initializedSdk: LiffAdapter) { initializedSdk.logout(); }
 * ```
 */
logout(): void
 /**
 * Resolve presentation profile data or reject SDK failure.
 * @returns The current SDK presentation profile.
 * @throws Propagates host adapter or SDK failures; async methods reject their Promise.
 *
 * @example
 * ```typescript
 * import type { LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function readProfile(initializedSdk: LiffAdapter) {
 *  if (!initializedSdk.isLoggedIn()) return null;
 *  return initializedSdk.getProfile(); // Presentation data, never authentication proof.
 * }
 * ```
 */
getProfile(): Promise<LiffProfile>
 /**
 * Optional SDK capability reporting whether running within LINE; absence is treated as false.
 * @returns Whether running inside LINE.
 *
 * @example
 * ```typescript
 * import type { LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export function isInsideLine(initializedSdk: LiffAdapter) { return initializedSdk.isInClient?.() === true; }
 * ```
 */
isInClient?(): boolean
}
/**
 * Wraps a host-installed LIFF SDK with single-flight initialization and stale-profile suppression.
 * @param options - Installed SDK, nonblank LIFF ID and credential-free HTTPS redirectUri.
 * @returns initialize/isInitialized/isInClient/getProfile/login/logout/invalidate methods; getProfile returns null after logout or invalidation.
 * @throws Invalid configuration throws; SDK failures and malformed profiles reject the corresponding action.
 *
 * @remarks
 * The host supplies @line/liff and its registered redirect URI. Profile fields are presentation data, never authentication proof. invalidate discards pending profile replies without logging out; concurrent login/logout uses the latest generation. Initialization can retry after failure.
 *
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
export function createLiffClient(options: {
/**
 * Host-installed SDK instance; no provider credentials are returned by the wrapper.
 */
  sdk: LiffAdapter;
/**
 * Nonblank registered LIFF application identifier.
 */
  liffId: string;
/**
 * Credential-free HTTPS URI configured in the host identity provider.
 */
  redirectUri: string }) {
 const { sdk, liffId } = options, redirect = new URL(options.redirectUri)
 if (!liffId.trim() || redirect.protocol !== 'https:' || redirect.username || redirect.password) throw new Error('Invalid host LIFF configuration')
 let initialized = false, pending: Promise<void> | undefined, generation = 0
 /**
 * Initializes the installed LIFF SDK once and shares an in-flight initialization between callers.
 * @returns Resolves without a value once initialized; a failed attempt clears the pending slot for retry.
 * @throws Rejects when sdk.init fails.
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
const initialize = (): Promise<void> => {
  if (initialized) return Promise.resolve()
  if (!pending) pending = Promise.resolve().then(() => sdk.init({ liffId })).then(() => { initialized = true }).finally(() => { pending = undefined })
  return pending
 }
 return {
  initialize,
  /**
 * Reports whether SDK initialization has completed successfully.
 * @returns True after successful initialize; invalidation does not reset initialization.
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
  isInitialized: () => initialized,
  /**
 * Reports whether an initialized SDK explicitly reports running within LINE.
 * @returns False before initialization or when the SDK capability is absent.
 * @throws Propagates synchronous SDK isInClient errors.
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
  isInClient: () => initialized && sdk.isInClient?.() === true,
  /**
 * Reads and validates presentation profile data while suppressing replies after identity invalidation.
 * @returns A copied profile or null if logged out or superseded before/after the SDK request.
 * @throws Rejects initialization/profile SDK failures or invalid required profile fields.
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
async getProfile(): Promise<LiffProfile | null> {
   const current = generation
   await initialize()
   if (current !== generation || !sdk.isLoggedIn()) return null
   const profile = await sdk.getProfile()
   if (current !== generation || !sdk.isLoggedIn()) return null
   if (typeof profile.userId !== 'string' || !profile.userId.trim() || typeof profile.displayName !== 'string') throw new Error('Invalid LIFF profile')
   // Profile data is presentation only. Provider credentials are not returned or persisted.
   return { userId: profile.userId, displayName: profile.displayName, ...(typeof profile.pictureUrl === 'string' ? { pictureUrl: profile.pictureUrl } : {}), ...(typeof profile.statusMessage === 'string' ? { statusMessage: profile.statusMessage } : {}) }
  },
  /**
 * Initializes LIFF and requests login only if this is the newest identity action and no login exists.
 * @returns Resolves without a value after the SDK login request or when already logged in/superseded.
 * @throws Rejects initialization or synchronous sdk.login failure.
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
async login(): Promise<void> { const current = ++generation; await initialize(); if (current === generation && !sdk.isLoggedIn()) sdk.login({ redirectUri: redirect.href }) },
  /**
 * Initializes LIFF and logs out only when this remains the newest identity action.
 * @returns Resolves without a value after logout or when superseded.
 * @throws Rejects initialization or synchronous sdk.logout failure.
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
async logout(): Promise<void> { const current = ++generation; await initialize(); if (current === generation) sdk.logout() },
  /**
 * Call when host identity changes to discard pending profile responses.
 */
  /**
 * Invalidates pending profile and identity actions when the host identity changes.
 * @returns Completes without a value; does not reset SDK initialization or itself log out.
 * @example
 * ```typescript
 * import { createLiffClient, type LiffAdapter } from '@alneas/eaos-react/client/liff';
 * export async function connectLiff(sdk: LiffAdapter, liffId: string, redirectUri: string) {
 *  const client = createLiffClient({ sdk, liffId, redirectUri });
 *  await client.initialize();
 *  return { client, disconnect: () => client.invalidate() };
 * }
 * ```
 */
  invalidate: () => { ++generation },
 }
}
