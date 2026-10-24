import { describe, expect, it } from 'bun:test'
import { createMockDoclingParser } from '../ai/document-parser'
import { generateConstructionJournalDraft } from './construction-journal-pipeline'
import { assertImmutableTransition, type ImmutableLedgerEntry } from './immutable-ledger'
import { evaluateAIRiskPolicy } from '../ai/governance'

describe('Vertical Slice: PDF Docling -> Level 2 AI Draft -> Editable Table UI -> Immutable Ledger POST', () => {
  it('executes full pipeline from document parsing to immutable ledger posting', async () => {
    // 1. Docling parse simulation
    const parser = createMockDoclingParser(() => ({
      markdown: '# 請求書\n\n発行日: 2026-10-24\n案件: 青山ビル新築工事\n',
      tables: [
        {
          title: '請求明細',
          headers: ['品名・工種', '数量', '単位', '単価', '金額'],
          rows: [
            ['基礎鉄筋配筋工事', '1', '式', '500000', '500000'],
            ['コンクリート打設工事', '1', '式', '800000', '800000'],
          ],
        },
      ],
    }))

    const parsedDoc = await parser.parse({
      filename: '請求書_基礎工事_20261024.pdf',
      content: new Uint8Array([1, 2, 3]),
    })

    // 2. Draft generation with accounting rules (WIP vs Cost)
    const mapping = {
      wipAccountId: 'acc-wip', // 未成工事支出金
      completedCostAccountId: 'acc-completed-cost', // 完成工事原価
      payableAccountId: 'acc-payable', // 工事未払金
    }

    // In-progress project generates WIP (未成工事支出金)
    const inProgressResult = generateConstructionJournalDraft({
      tenantId: 'tenant-demo',
      periodId: 'period-2026-10',
      parsedDoc,
      mapping,
      projectStatus: 'IN_PROGRESS',
      createdBy: 'ai-docling-agent',
    })

    expect(inProgressResult.draftEntry.status).toBe('DRAFT')
    expect(inProgressResult.draftEntry.lines[0].accountId).toBe('acc-wip')
    expect(inProgressResult.draftEntry.lines[0].amount).toBe(1300000)
    expect(inProgressResult.draftEntry.lines[1].accountId).toBe('acc-payable')
    expect(inProgressResult.draftEntry.lines[1].amount).toBe(1300000)
    expect(inProgressResult.draftEntry.date).toBe('2026-10-24')

    // 3. UI Draft compatibility check (AI-to-UI payload)
    const { uiDraft } = inProgressResult
    expect(uiDraft.mode).toBe('create_journal')
    expect(uiDraft.riskLevel).toBe(2)
    expect(uiDraft.summary).toContain('1,300,000')
    expect(uiDraft.values.lines).toBeDefined()

    // 4. Governance check: Level 2 direct automated DB commit MUST be blocked without human confirmation
    const directAutoCommit = evaluateAIRiskPolicy(uiDraft.riskLevel!, {
      isDirectMutation: true,
      hasHumanConfirmation: false,
    })
    expect(directAutoCommit.allowed).toBe(false)
    expect(directAutoCommit.humanConfirmationRequired).toBe(true)

    // 5. Human-in-the-Loop: Operator verifies in UI (EditableTable) and modifies if needed
    // Operator confirms, policy allows commit
    const humanApprovedCommit = evaluateAIRiskPolicy(uiDraft.riskLevel!, {
      isDirectMutation: true,
      hasHumanConfirmation: true,
    })
    expect(humanApprovedCommit.allowed).toBe(true)

    // 6. State Transition: DRAFT -> POSTED in Immutable Ledger
    const committedEntry: ImmutableLedgerEntry = {
      id: 'journal-uuid-999',
      ...inProgressResult.draftEntry,
      status: 'POSTED',
      provenance: {
        ...inProgressResult.draftEntry.provenance,
        humanReviewedFields: ['lines', 'date', 'amount'],
        reviewNotes: '現場監督承認済',
      },
    }

    expect(() => assertImmutableTransition('DRAFT', 'POSTED')).not.toThrow()
    expect(committedEntry.status).toBe('POSTED')
    expect(committedEntry.provenance.humanReviewedFields).toContain('lines')

    // 7. Verify Post-Commit Immutability: POSTED cannot be mutated or rolled back to DRAFT
    expect(() => assertImmutableTransition(committedEntry.status, 'DRAFT')).toThrow('immutable')
  })
})
