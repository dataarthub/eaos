/** Portable browser fetch call signature, without Bun-specific static helpers.
 * @see createWorkspaceApi
 */
export type BrowserFetch=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>
