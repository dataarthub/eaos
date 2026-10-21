import { preparePluginCollection } from '@alneas/eaos-cli/platform/deployment-assets'
import { cp, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
const catalog = JSON.parse(await readFile(join(import.meta.dir, 'catalog.json'), 'utf8'))
for (const id of catalog.plugins as string[]) {
  const source = join(import.meta.dir, id), output = join(import.meta.dir, 'dist', id)
  // Manifest guide/skill paths remain relative to each independently staged module.
  await cp(join(source, 'docs'), join(output, 'docs'), { recursive: true })
  if (existsSync(join(source, 'skills'))) {
    await cp(join(source, 'skills'), join(output, 'skills'), { recursive: true })
  }
  await mkdir(join(output, 'src'), { recursive: true })
  await cp(join(source, 'src/user-guide.json'), join(output, 'src/user-guide.json'))
  if (existsSync(join(source, 'eaos.clients.json'))) {
    await cp(join(source, 'eaos.clients.json'), join(output, 'eaos.clients.json'))
  }
}
await preparePluginCollection(import.meta.dir)
