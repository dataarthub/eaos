import type { ParsedDocumentResult } from '../ai/document-parser'
import type { ImmutableLedgerEntry, ImmutableLedgerLine } from './immutable-ledger'
import type { CoreAiDraft } from '../ai/governance'
import { assertBalancedLines } from './immutable-ledger'

/**
 * Standard construction accounting account codes.
 */
export interface ConstructionAccountMapping {
  /** 未成工事支出金 (WIP: 竣工前原価) */
  wipAccountId: string
  /** 完成工事原価 (竣工後原価) */
  completedCostAccountId: string
  /** 工事未払金 (買掛金) */
  payableAccountId: string
  /** 仮払消費税 (仕入税額控除) */
  taxAccountId?: string
}

/**
 * Input request for generating an accounting journal draft from a parsed document.
 */
export interface GenerateJournalDraftRequest {
  tenantId: string
  periodId: string
  parsedDoc: ParsedDocumentResult
  mapping: ConstructionAccountMapping
  /** 工事案件のステータス: 'IN_PROGRESS' (竣工前) | 'COMPLETED' (竣工後) */
  projectStatus: 'IN_PROGRESS' | 'COMPLETED'
  createdBy: string
}

/**
 * Generates an AI-to-UI draft (Level 2) and candidate ImmutableLedgerEntry from parsed document tables.
 *
 * Adheres to enterprise accounting rules:
 * - Deterministic double-entry balance validation (assertBalancedLines).
 * - Automatic WIP classification (未成工事支出金 vs 完成工事原価).
 * - Human-in-the-Loop review gating before DB commitment.
 */
export function generateConstructionJournalDraft(request: GenerateJournalDraftRequest): {
  draftEntry: Omit<ImmutableLedgerEntry, 'id'>
  uiDraft: CoreAiDraft
} {
  const { tenantId, periodId, parsedDoc, mapping, projectStatus, createdBy } = request

  // Find line items from document tables
  const lineItems: { name: string; amount: number }[] = []
  let detectedDate = new Date().toISOString().slice(0, 10)

  // Look for dates in markdown (e.g. 2026-10-20 or 2026年10月20日)
  const dateMatch = parsedDoc.markdown.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/)
  if (dateMatch) {
    const y = dateMatch[1]
    const m = dateMatch[2].padStart(2, '0')
    const d = dateMatch[3].padStart(2, '0')
    detectedDate = `${y}-${m}-${d}`
  }

  // Extract monetary line items from parsed tables
  for (const table of parsedDoc.tables) {
    // Exact or priority match: prioritize '金額' or '小計' over '単価' to prevent selecting unit price
    let amountIdx = table.headers.findIndex(h => /^(?:金額|小計|合計)$/u.test(h))
    if (amountIdx === -1) {
      amountIdx = table.headers.findIndex(h => /金額|小計/u.test(h) && !/単価/u.test(h))
    }
    if (amountIdx === -1) {
      amountIdx = table.headers.findIndex(h => /金額|小計/u.test(h))
    }
    const nameIdx = table.headers.findIndex(h => /品名|工種|項目|名称/u.test(h))

    if (amountIdx !== -1 && nameIdx !== -1) {
      for (const row of table.rows) {
        const name = row[nameIdx]?.trim()
        const rawAmount = row[amountIdx]?.replace(/[,円￥\s]/g, '')
        const amount = Number(rawAmount)
        if (name && Number.isSafeInteger(amount) && amount > 0) {
          lineItems.push({ name, amount })
        }
      }
    }
  }

  const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0)
  if (totalAmount <= 0) {
    throw new Error('No valid billable line items detected from parsed document')
  }

  // Account assignment based on project status (WIP vs Completed Cost)
  const debitAccount = projectStatus === 'IN_PROGRESS' ? mapping.wipAccountId : mapping.completedCostAccountId

  // Double-entry balancing lines (借方: WIP/原価, 貸方: 工事未払金)
  const lines: ImmutableLedgerLine[] = [
    {
      accountId: debitAccount,
      side: 'D',
      amount: totalAmount,
    },
    {
      accountId: mapping.payableAccountId,
      side: 'C',
      amount: totalAmount,
    },
  ]

  // Validate deterministic balance (借方合計 === 貸方合計)
  assertBalancedLines(lines)

  const description = `[AI下書き] ${parsedDoc.name}: ${lineItems.map(i => i.name).slice(0, 3).join(', ')}${lineItems.length > 3 ? ' 他' : ''}`

  const draftEntry: Omit<ImmutableLedgerEntry, 'id'> = {
    tenantId,
    periodId,
    date: detectedDate,
    description,
    sourceKey: `doc:${parsedDoc.name}:${detectedDate}`,
    lines,
    status: 'DRAFT',
    provenance: {
      createdBy,
      riskLevel: 2, // Level 2: Routine draft with human confirmation required
      aiGenerated: true,
      aiFields: ['lines', 'date', 'description', 'totalAmount'],
    },
  }

  const uiDraft: CoreAiDraft = {
    mode: 'create_journal',
    riskLevel: 2,
    summary: `${parsedDoc.name} から ${lineItems.length} 件の工種明細（合計 ¥${totalAmount.toLocaleString()}）を抽出しました。借方: ${projectStatus === 'IN_PROGRESS' ? '未成工事支出金(WIP)' : '完成工事原価'}`,
    fieldMetadata: {
      date: { confidence: dateMatch ? 'high' : 'medium', reasoning: dateMatch ? '請求書テキストから抽出' : '本日日付で補完' },
      lines: { confidence: lineItems.length > 0 ? 'high' : 'low', reasoning: `表構造より${lineItems.length}行の金額明細を抽出` },
    },
    simulation: {
      title: '工事原価インパクト試算',
      metrics: [
        { label: '計上区分', after: projectStatus === 'IN_PROGRESS' ? '未成工事支出金 (WIP)' : '完成工事原価' },
        { label: '当月原価増分', after: `+¥${totalAmount.toLocaleString()}` },
        { label: '貸借一致状況', after: '完全一致 (差額 ¥0)' },
      ],
    },
    values: {
      periodId,
      date: detectedDate,
      description,
      sourceKey: draftEntry.sourceKey,
      lines: lines.map(l => ({ accountId: l.accountId, side: l.side, amount: l.amount })),
    },
  }

  return { draftEntry, uiDraft }
}
