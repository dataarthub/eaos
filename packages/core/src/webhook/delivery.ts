/**
 * Webhook Delivery Helpers
 * HMAC signatures, verification and retrying POST delivery.
 *
 * @module webhook/delivery
 */

import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

// =============================================================================
// Types
// =============================================================================

/**
 * Webhook event name, caller timestamp and JSON data sent to a receiver.
 * @see {@link deliverWithRetry}
 */
export interface WebhookPayload {
  
  /** Inbound provider event or webhook event name interpreted by the connected host. */
  event: string;
  
  
  /** Caller event timestamp, conventionally Unix epoch milliseconds; delivery signs a separate generated header timestamp. */
  timestamp: number;
  
  /** Structured draft/event data or cached result; serialization and validation occur at the owning API boundary. */
  data: Record<string, unknown>;
}

/**
 * Destination, signing secret, payload, attempt count and optional header overrides.
 * @see {@link deliverWithRetry}
 */
export interface DeliveryOptions {
  
  /** Target/observed HTTP(S) location; adapter/host authorization must restrict navigation and delivery. */
  url: string;
  
  /** Shared or one-time secret value; keep it out of persistence/logs except through host-approved secret storage. */
  secret: string;
  
  /** Typed event/request body; constructors clone and strictly hash JSON where documented. */
  payload: WebhookPayload;
  
/** Total POST attempt count, despite the name; defaults to 3. */
  maxRetries?: number;        // default: 3
  
/** Optional base retry delay in milliseconds, validated from 0 to 300000. */
  backoffMs?: number;         // default: 1000
  
/** Optional headers overriding generated content type, timestamp and signature headers. */
  headers?: Record<string, string>;
}

/**
 * HTTP delivery outcome returned as data with the final attempt number.
 * @see {@link deliverWithRetry}
 */
export interface DeliveryResult {
  
  /** Reported completion flag; inspect status/receipt and reconcile any uncertain side effects before retrying. */
  success: boolean;
  
/** Host-recorded one-based execution attempt; helpers consuming it require a positive integer. */
  attempt: number;
  
/** Optional HTTP status received on the final/successful attempt. */
  statusCode?: number;
  
/** Optional human-readable failure detail; absence does not independently establish success. */
  error?: string;
}

/**
 * Signature comparison result and optional diagnostic error text.
 * @see {@link deliverWithRetry}
 */
export interface SignatureVerification {
  
  /** Whether signature verification succeeded; does not prove timestamp freshness or replay safety. */
  valid: boolean;
  
/** Optional human-readable failure detail; absence does not independently establish success. */
  error?: string;
}

// =============================================================================
// Signature Generation & Verification
// =============================================================================

/**
 * Sign a timestamp and exact webhook body with HMAC-SHA256.
 * @param timestamp - Timestamp text, conventionally Unix epoch milliseconds; signed verbatim without validation.
 * @param body - Exact serialized body; whitespace changes alter the signature.
 * @param secret - Shared HMAC secret.
 * @returns Lowercase hexadecimal signature over timestamp + dot + body.
 * @remarks Requires node:crypto. Receivers must independently enforce timestamp freshness and replay protection.
 * @example
 * ```typescript
 * import { generateSignature } from "@alneas/eaos-core/webhook/delivery";
 * console.log(generateSignature("1792368000000", "{}", "example-only-secret"));
 * ```
 */
export function generateSignature(timestamp: string, body: string, secret: string): string {
  const message = `${timestamp}.${body}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Sign raw text or a JSON-serialized payload with HMAC-SHA256.
 * @param payload - Raw text is signed verbatim; other values are serialized with JSON.stringify.
 * @param secret - Shared HMAC secret.
 * @returns Lowercase hexadecimal signature over the body, without a timestamp prefix.
 * @throws Native JSON serialization or crypto errors propagate, including cycles, bigint and undefined serialization output.
 * @remarks Requires node:crypto; payload signing alone provides no replay protection.
 * @example
 * ```typescript
 * import { signPayload } from "@alneas/eaos-core/webhook/delivery";
 * console.log(signPayload({ event: "demo" }, "example-only-secret"));
 * ```
 */
export function signPayload(payload: unknown, secret: string): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Generate random hexadecimal secret text of a requested length.
 * @param length - Number of random bytes requested and maximum hexadecimal character count returned; defaults to 32. Only the first length hexadecimal characters are retained.
 * @returns Random hexadecimal text truncated to length characters.
 * @throws Native crypto errors for an invalid random byte count.
 * @remarks Requires node:crypto; generated secrets must be stored and transmitted by the host.
 * @example
 * ```typescript
 * import { generateSecret } from "@alneas/eaos-core/webhook/delivery";
 * const secret = generateSecret();
 * console.log(secret.length); // 32
 * ```
 */
export function generateSecret(length: number = 32): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * Verify either a timestamped body or a payload signature.
 * @param timestampOrPayload - Timestamp text in four-argument mode, or raw/JSON payload in three-argument mode.
 * @param bodyOrSignature - Exact body in four-argument mode, otherwise hexadecimal signature.
 * @param signatureOrSecret - Hexadecimal signature in four-argument mode, otherwise shared secret.
 * @param secretParam - Shared secret when verifying timestamp + dot + body; omission selects payload-only mode.
 * @returns Verification data with valid false on comparison, decoding, serialization or crypto errors; error may describe the failure.
 * @remarks Uses timingSafeEqual on decoded bytes. Does not validate timestamp freshness or enforce replay protection.
 * @example
 * ```typescript
 * import { verifySignature } from "@alneas/eaos-core/webhook/delivery";
 * import { signPayload } from "@alneas/eaos-core/webhook/delivery";
 * import { randomBytes } from "node:crypto";
 * const body = "{}";
 * const secret = randomBytes(32).toString('hex'); // Ephemeral key for this local round trip only.
 * console.log(verifySignature(body, signPayload(body, secret), secret).valid); // true
 * ```
 */
export function verifySignature(
  timestampOrPayload: string | unknown,
  bodyOrSignature: string,
  signatureOrSecret: string,
  secretParam?: string,
): SignatureVerification {
  try {
    if (secretParam !== undefined) {
      // 4引数形式: verifySignature(timestamp, body, signature, secret)
      const timestamp = timestampOrPayload as string;
      const body = bodyOrSignature;
      const signature = signatureOrSecret;
      const secret = secretParam;
      const expected = generateSignature(timestamp, body, secret);
      const sigBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');

      if (sigBuffer.length !== expectedBuffer.length) {
        return { valid: false, error: 'Signature length mismatch' };
      }

      const isValid = timingSafeEqual(sigBuffer, expectedBuffer);
      return { valid: isValid };
    } else {
      // 3引数形式: verifySignature(payload, signature, secret)
      const payload = timestampOrPayload;
      const signature = bodyOrSignature;
      const secret = signatureOrSecret;
      const expectedSignature = signPayload(payload, secret);
      const isValid = timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
      return { valid: isValid };
    }
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

// =============================================================================
// Delivery with Retry
// =============================================================================

/**
 * POST a signed JSON webhook with bounded exponential retry attempts.
 * @param options - Destination, secret and payload; maxRetries is the total attempt count (default 3), backoffMs is the base delay (default 1000), and custom headers override generated headers.
 * @returns Success with one-based attempt/status, or failure data after attempts are exhausted; HTTP and fetch errors are returned rather than thrown.
 * @throws Rejects if initial JSON serialization or signature construction fails before delivery.
 * @remarks Requires fetch and node:crypto. All non-2xx responses/fetch errors are retried; there is no cancellation or request timeout. The timestamp/signature are reused across attempts; the receiver must handle duplicate effects safely. No options validation is performed.
 * @example
 * ```typescript
 * import { deliverWithRetry } from "@alneas/eaos-core/webhook/delivery";
 * const destination = process.env.WEBHOOK_TEST_URL;
 * const secret = process.env.WEBHOOK_TEST_SECRET;
 * if (!destination || !secret) throw new Error("Configure a test receiver and its shared secret");
 * const result = await deliverWithRetry({ url: destination, secret, payload: { event: "demo", timestamp: Date.now(), data: { message: "hello" } } });
 * console.log(result);
 * ```
 */
export async function deliverWithRetry(options: DeliveryOptions): Promise<DeliveryResult> {
  const { url, secret, payload, maxRetries = 3, backoffMs = 1000, headers = {} } = options;

  const body = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, body, secret);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': timestamp,
          ...headers,
        },
        body,
      });

      if (res.ok) {
        return { success: true, attempt, statusCode: res.status };
      }

      const errorText = await res.text();
      if (attempt === maxRetries) {
        return { success: false, attempt, statusCode: res.status, error: `HTTP ${res.status}: ${errorText}` };
      }
    } catch (e) {
      const error = (e as Error).message;
      if (attempt === maxRetries) {
        return { success: false, attempt, error };
      }
    }

    // 指数バックオフ
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs * Math.pow(2, attempt - 1)));
    }
  }

  return { success: false, attempt: maxRetries, error: 'Max retries exceeded' };
}

// =============================================================================
// Payload Hash
// =============================================================================

/**
 * Compute a SHA-256 digest of exact payload text.
 * @param payload - UTF-8 text to hash; no JSON normalization occurs.
 * @returns Lowercase hexadecimal digest.
 * @remarks Requires node:crypto; a hash is not an authenticated signature.
 * @example
 * ```typescript
 * import { computePayloadHash } from "@alneas/eaos-core/webhook/delivery";
 * console.log(computePayloadHash("{}"));
 * ```
 */
export function computePayloadHash(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}
