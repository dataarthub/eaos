import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deployPlatformImage } from './deploy'

test('fixed-port replacement restores the old container if HTTP health fails and releases the lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eaos-deploy-test-'))
  const plan = { host:'edge',service:'platform',image:'registry.test/platform:new',env_path:'.kamal/apps/platform/env/roles/web.env',fixed_port:true,ssh:{user:'ubuntu',port:12222,keys:['key.pub'],config:['ssh.config']},command:'NEW_CONTAINER',lock_ensure:'LOCK_DIR',lock_acquire:'LOCK_ACQUIRE',lock_release:'LOCK_RELEASE' }
  try {
    await writeFile(join(root,'ruby'),'#!/bin/sh\nprintf \'%s\' \'"+JSON.stringify(plan)+"\'\n'.replace('"+JSON.stringify(plan)+"', JSON.stringify(plan)))
    await writeFile(join(root,'ssh'),`#!/usr/bin/env python3
import sys,json
command=sys.argv[-1]
with open('commands.jsonl','a') as f:f.write(json.dumps(command)+'\\n')
if 'Config.Labels.service' in command:print('platform')
if command.startswith('docker ps --filter'):print('platform-web-old')
if command.startswith('for attempt'):sys.exit(1)
`)
    await chmod(join(root,'ruby'),0o755); await chmod(join(root,'ssh'),0o755)
    await expect(deployPlatformImage({configFile:'config.yml',version:'new',transport:'openssh',cwd:root,env:{...process.env,PATH:root+':'+process.env.PATH}})).rejects.toThrow('Platform operation failed')
    const commands = (await Bun.file(join(root,'commands.jsonl')).text()).trim().split('\n').map(line=>JSON.parse(line) as string)
    expect(commands).toContain("docker stop 'platform-web-old'")
    expect(commands).toContain('NEW_CONTAINER')
    expect(commands).toContain("docker start 'platform-web-old'")
    expect(commands.at(-1)).toBe('LOCK_RELEASE')
  } finally { await rm(root,{recursive:true,force:true}) }
})
