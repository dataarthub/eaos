import { describe, expect, it } from 'bun:test'
import { globalExecutionSandbox } from '../src/agentic/execution-sandbox'
import { globalGatekeeper } from '../src/security/gatekeeper'

describe('ExecutionSandbox & Human-in-the-Loop Gatekeeper (Agentic EMS Phase 3)', () => {
  it('should execute safe Python code in sandbox when approved by policy', async () => {
    const res = await globalExecutionSandbox.executeCode({
      taskId: 'task_201',
      agentId: 'wrk_1',
      language: 'python',
      code: 'print("Hello Agentic EMS")',
    })

    expect(res.requiresHumanApproval).toBe(false)
    expect(res.result).toBeDefined()
    expect(res.result?.exitCode).toBe(0)
    expect(res.result?.stdout).toContain('Process executed successfully')
  })

  it('should flag human approval required when high-risk execution policy is registered', async () => {
    // 高リスクポリシーの登録
    globalGatekeeper.registerPolicy('agentic_sandbox_execute_code', {
      requiredRole: 'admin',
      requireHumanApproval: true,
      riskLevel: 'high',
    })


    const res = await globalExecutionSandbox.executeCode(
      {
        taskId: 'task_202',
        agentId: 'wrk_1',
        language: 'bash',
        code: 'curl https://api.external.com/submit',
      },
      { userContext: { userId: 'user_admin', roles: ['admin'] } }
    )



    expect(res.requiresHumanApproval).toBe(true)
    expect(res.approvalTicketId).toBeDefined()
    expect(res.result).toBeUndefined()
  })

  it('should support tauri_local_cli mode for borrowing local Antigravity CLI', async () => {
    const res = await globalExecutionSandbox.executeCode(
      {
        taskId: 'task_301',
        agentId: 'wrk_local',
        language: 'python',
        code: 'Generate financial report summary',
      },
      { mode: 'tauri_local_cli', cliType: 'antigravity' }
    )

    expect(res.requiresHumanApproval).toBe(false)
    expect(res.result).toBeDefined()
    expect(res.result?.stdout).toContain('Tauri Local CLI (antigravity)')
  })

  it('should support tauri_local_cli mode for borrowing local Codex CLI', async () => {
    const res = await globalExecutionSandbox.executeCode(
      {
        taskId: 'task_302',
        agentId: 'wrk_local',
        language: 'python',
        code: 'Refactor accounting ledger parser',
      },
      { mode: 'tauri_local_cli', cliType: 'codex' }
    )

    expect(res.requiresHumanApproval).toBe(false)
    expect(res.result).toBeDefined()
    expect(res.result?.stdout).toContain('Tauri Local CLI (codex)')
  })
})
