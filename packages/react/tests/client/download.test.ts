import { test, expect } from 'bun:test'
import { createFileDownloader, createInvokeFileSaver, validateDownloadFilename } from '../../src/client/index'
test('filenames and limits are enforced before invoking an adapter', async () => {
 let calls = 0; const download = createFileDownloader({ maxBytes: 2, native: async () => { calls++; return { success: true } } })
 for (const filename of ['../a', '/tmp/a', 'a\\b', 'CON.pdf', 'a.', '', 'bad\x00']) expect((await download(new Uint8Array(1), { filename })).success).toBe(false)
 expect((await download(new Uint8Array(3), { filename: 'ok.pdf' })).success).toBe(false); expect(calls).toBe(0)
 validateDownloadFilename('見積書.pdf'); expect((await download(new Uint8Array(1), { filename: '見積書.pdf' })).success).toBe(true)
})
test('native bridge preserves bytes/options, maps Rust response, and does not fall back on failure', async () => {
 let captured: any, webCalls = 0
 const saver = createInvokeFileSaver(async (command, args) => { captured = { command, ...args }; return { success: true, file_path: '/Downloads/a.pdf' } })
 const download = createFileDownloader({ native: saver })
 expect(await download(new Uint8Array([0, 255]), { filename: 'a.pdf', revealInFinder: true })).toEqual({ success: true, filePath: '/Downloads/a.pdf' })
 expect(captured.dataBase64).toBe('AP8='); expect(captured.revealInFinder).toBe(true)
 const failed = createFileDownloader({ native: async () => { throw new Error('denied') }, web: async () => { webCalls++; return { success: true } } })
 expect((await failed(new Uint8Array(), { filename: 'a.pdf' })).success).toBe(false); expect(webCalls).toBe(0)
})
