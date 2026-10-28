/**
 * File destination hints accepted by native and browser save adapters.
 *
 * @see createFileDownloader for a complete host integration example.
 */
export interface SaveFileOptions {
/**
 * Single safe filename up to 200 characters; no path separators/reserved desktop names.
 */
  filename: string;
/**
 * Browser Blob MIME type.
 * @defaultValue 'application/octet-stream'
 */
  contentType?: string;
/**
 * Request native file-manager reveal; ignored by browser saver.
 * @defaultValue false
 */
  revealInFinder?: boolean;
/**
 * Request native opening after save; ignored by browser saver.
 * @defaultValue false
 */
  openWithDefaultApp?: boolean }
/**
 * Save outcome data; success need not prove a browser download was durably written.
 *
 * @see createFileDownloader for a complete host integration example.
 */
export interface SaveFileResult {
/**
 * Whether the adapter reports success; browser success only confirms initiation.
 */
  success: boolean;
/**
 * Optional host-reported native destination path; absent for browser downloads.
 */
  filePath?: string;
/**
 * Optional failure message returned as data rather than rejection by createFileDownloader.
 */
  error?: string }
/**
 * Host file-saving callback accepting bytes and destination hints.
 *
 * @see createFileDownloader for a complete host integration example.
 */
export type NativeFileSaver = (data: Uint8Array, options: SaveFileOptions) => Promise<SaveFileResult>
/**
 * Rejects filenames unsafe for a single downloaded file on common desktop filesystems.
 * @param filename - Nonempty filename up to 200 characters, excluding path separators, reserved names, controls and trailing dot/space.
 * @returns Completes without a value when the name is accepted.
 * @throws Error for invalid or reserved filenames.
 *
 * @example
 * ```typescript
 * import { validateDownloadFilename } from '@alneas/eaos-react/client';
 * validateDownloadFilename('report.csv');
 * ```
 */
export function validateDownloadFilename(filename: string): void {
 // eslint-disable-next-line no-control-regex -- Reject ASCII control characters in untrusted identifiers/paths.
 if (typeof filename !== 'string' || !filename || filename.length > 200 || /[/\\<>:"|?*\x00-\x1f]/.test(filename) || /[. ]$/.test(filename) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename)) throw new Error('Invalid download filename')
}
/**
 * Chooses one file-saving destination and converts validation or adapter errors into failure data.
 *
 * The host supplies the native adapter; a failed native save never silently changes destination.
 * @param options - Optional native/web adapters and positive maxBytes limit, defaulting to 104857600 bytes; native takes precedence.
 * @returns An async saver accepting bytes/ArrayBuffer/Blob and SaveFileOptions, resolving SaveFileResult even on adapter failure.
 * @throws Error if maxBytes is not a positive safe integer at construction.
 *
 * @remarks
 * No fallback follows native failure. Browser success means the download was initiated, not durably written. Blob conversion allocates memory; native/web adapters own persistence and prompts.
 *
 * @example
 * ```typescript
 * import { createFileDownloader } from '@alneas/eaos-react/client';
 * const download = createFileDownloader();
 * export async function saveReport() {
 *  return download(new TextEncoder().encode('name\nSample\n'), { filename: 'report.csv', contentType: 'text/csv' });
 * }
 * ```
 */
export function createFileDownloader(options: {
/**
 * Optional native adapter; selected before web and never silently retried in another destination.
 */
  native?: NativeFileSaver;
/**
 * Optional web save adapter, used only when native is absent.
 */
  web?: NativeFileSaver;
/**
 * Positive safe byte limit; defaults to 104857600 (100 MiB).
 */
  maxBytes?: number } = {}) {
 const maxBytes = options.maxBytes ?? 100 * 1024 * 1024
 if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid download size limit')
 return async (data: Uint8Array | ArrayBuffer | Blob, save: SaveFileOptions): Promise<SaveFileResult> => {
  try {
   validateDownloadFilename(save.filename)
   const size = data instanceof Blob ? data.size : data.byteLength
   if (size > maxBytes) throw new Error('Download exceeds size limit')
   const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data)
   return await (options.native ?? options.web ?? saveInBrowser)(bytes, { ...save })
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Download failed' } }
 }
}
/**
 * Starts an anchor download and schedules object URL cleanup.
 * @param bytes - File contents copied into a Blob.
 * @param options - Filename and MIME type; contentType defaults to application/octet-stream; desktop reveal/open flags are ignored.
 * @returns Success after clicking the anchor; no path or durable-save confirmation is available.
 * @throws Rejects for invalid filename, unavailable document or browser API failure.
 *
 * @remarks
 * Requires browser document, Blob and object URL APIs. The anchor is removed immediately and URL revoked after one second.
 *
 * @example
 * ```typescript
 * import { saveInBrowser } from '@alneas/eaos-react/client';
 * export const saveText = () => saveInBrowser(new TextEncoder().encode('Hello'), { filename: 'hello.txt', contentType: 'text/plain' });
 * ```
 */
export async function saveInBrowser(bytes: Uint8Array, options: SaveFileOptions): Promise<SaveFileResult> {
 validateDownloadFilename(options.filename)
 if (typeof document === 'undefined') throw new Error('Browser download is unavailable')
 const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: options.contentType ?? 'application/octet-stream' }))
 const anchor = document.createElement('a')
 try { anchor.href = url; anchor.download = options.filename; document.body.appendChild(anchor); anchor.click(); return { success: true } }
 finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
/**
 * Adapts a host native save_file_native command to the file-saving contract.
 *
 * Optional adapter for a host-owned save_file_native command. It does not import Tauri.
 * @param invoke - Installed native bridge; receives command and base64 data, filename and desktop flags, and must return a success boolean.
 * @returns A saver normalizing camelCase/snake_case file paths; validation, malformed responses and bridge failures reject.
 *
 * @remarks
 * Does not import Tauri. The host must implement the command and enforce allowed destinations. Desktop flags default to false; contentType is not forwarded.
 *
 * @example
 * ```typescript
 * import { createInvokeFileSaver } from '@alneas/eaos-react/client';
 * export function connectNativeSave(invoke: Parameters<typeof createInvokeFileSaver>[0]) {
 *  return createInvokeFileSaver(invoke);
 * }
 * ```
 */
export function createInvokeFileSaver(invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>): NativeFileSaver {
 return async (bytes, options) => {
  validateDownloadFilename(options.filename)
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  const result = await invoke('save_file_native', { dataBase64: btoa(chunks.join('')), filename: options.filename, revealInFinder: options.revealInFinder ?? false, openWithDefaultApp: options.openWithDefaultApp ?? false }) as any
  if (!result || typeof result.success !== 'boolean') throw new Error('Invalid native save response')
  return { success: result.success, ...(typeof (result.filePath ?? result.file_path) === 'string' ? { filePath: result.filePath ?? result.file_path } : {}), ...(typeof result.error === 'string' ? { error: result.error } : {}) }
 }
}
export * from './browser-auth'
export * from './plugin-execution'
export * from './client-routes'
export * from './liff'

export * from './compute'
export * from './workspace-api'
export type {BrowserFetch} from './http'
