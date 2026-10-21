import type { Context } from 'hono'

/**
 * Controls error response redaction and logging for {@link createErrorHandler}.
 */
export interface ErrorHandlerOptions {
  /** Hide message and stack when true; defaults to NODE_ENV === "production". */
  isProduction?: boolean
  /** Called synchronously with the original error and request context before rendering; defaults to console.error. A thrown logger error propagates. */
  logger?: (err: Error, c: Context) => void
}

/**
 * Creates a Hono error handler that logs errors and renders a JSON 500 response.
 * @param options - Logging and redaction settings; omitted settings use console.error and NODE_ENV.
 * @returns An async handler resolving to a 500 response; production responses omit stacks and use "Internal Server Error".
 * @throws The returned handler rejects if the host logger throws.
 * @remarks Nonproduction responses expose error messages and stacks. Choose production redaction explicitly for externally accessible services.
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { createErrorHandler } from "@alneas/eaos-server/middleware/error-handler";
 * const app = new Hono();
 * app.onError(createErrorHandler({ isProduction: true }));
 * app.get("/example", () => { throw new Error("example failure"); });
 * console.log((await app.request("/example")).status); // 500
 * ```
 */
export function createErrorHandler(options?: ErrorHandlerOptions) {
  const isProduction = options?.isProduction ?? process.env.NODE_ENV === 'production'

  return async (err: Error, c: Context) => {
    if (options?.logger) {
      options.logger(err, c)
    } else {
      console.error(`[EaosServer:Error] ${c.req.method} ${c.req.path} -`, err)
    }

    const message = isProduction ? 'Internal Server Error' : err.message
    return c.json(
      {
        error: message,
        ...(isProduction ? {} : { stack: err.stack }),
      },
      500
    )
  }
}
