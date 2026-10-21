import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
export * from './api-key'
/**
 * Creates a body-limited registration endpoint that verifies the caller before parsing JSON.
 * @typeParam T - Validated registration input returned by parse and passed unchanged to register.
 * @param options - Host callbacks: verify receives the request context before parsing and must return a rejection Response or no value to continue; parse synchronously validates unknown JSON; register receives the parsed input and context and resolves the final response.
 * @returns A Hono router serving POST /registration with a 128 KiB body limit; JSON or parser failures return 400.
 * @throws Request handling propagates verify and register rejections; parse exceptions become 400 responses.
 * @remarks The host owns authentication, registration persistence, duplicate handling, and transactional behavior. Body size enforcement precedes verify.
 * @example
 * ```typescript
 * import type { Context } from "hono";
 * import { createRegistrationHook } from "@alneas/eaos-server/auth-hooks";
 * export function registrationRouter(
 *   verify: (context: Context) => Promise<Response | void>,
 *   register: (input: { email: string }, context: Context) => Promise<Response>,
 * ) {
 *   return createRegistrationHook({ verify, register, parse(body: unknown) {
 *     if (!body || typeof body !== "object" || !("email" in body) || typeof body.email !== "string") {
 *       throw new Error("email is required");
 *     }
 *     return { email: body.email };
 *   } });
 * }
 * ```
 */
export function createRegistrationHook<T>(options: {
 /**
  * Verifies the caller before request JSON is parsed.
  * @param c - Hono request context containing the headers/credentials to verify.
  * @returns A rejection Response, or no value to continue registration.
  * @throws Host verification failures propagate through request handling.
  * @example
  * ```typescript
  * import { createRegistrationHook } from '@alneas/eaos-server/auth-hooks';
  * import type { Context } from 'hono';
  * export async function verifyCaller(options: Parameters<typeof createRegistrationHook>[0], context: Context) {
  *   return options.verify(context);
  * }
  * ```
  */
 
 verify(c: Context): Promise<Response | void>
 /**
  * Synchronously validates parsed JSON and produces the registration input.
  * @param body - Unknown JSON value from the request body.
  * @returns Validated registration data passed unchanged to register.
  * @throws Validation errors are converted to a 400 Invalid registration payload response.
  * @example
  * ```typescript
  * import { createRegistrationHook } from '@alneas/eaos-server/auth-hooks';
  * export function parseRegistration(options: Parameters<typeof createRegistrationHook>[0], body: unknown) {
  *   return options.parse(body);
  * }
  * ```
  */
 parse(body: unknown): T
 /**
  * Performs host registration after caller verification and input parsing.
  * @param input - Validated parser result, passed unchanged from parse.
  * @param c - Same Hono request context used for caller verification.
  * @returns The final host registration response.
  * @throws Host persistence/registration failures propagate; earlier external effects may already have occurred.
  * @example
  * ```typescript
  * import { createRegistrationHook } from '@alneas/eaos-server/auth-hooks';
  * import type { Context } from 'hono';
  * export async function registerValidated(options: Parameters<typeof createRegistrationHook>[0], body: unknown, context: Context) {
  *   const denied = await options.verify(context);
  *   if (denied) return denied;
  *   return options.register(options.parse(body), context);
  * }
  * ```
  */
 register(input: T, c: Context): Promise<Response>
}) {
 const app = new Hono()
 app.use('*', bodyLimit({ maxSize: 128 * 1024 }))
 app.post('/registration', async c => {
  const denied = await options.verify(c); if (denied) return denied
  let input: T
  try { input = options.parse(await c.req.json()) } catch { return c.json({ error: 'Invalid registration payload' }, 400) }
  return options.register(input, c)
 })
 return app
}
