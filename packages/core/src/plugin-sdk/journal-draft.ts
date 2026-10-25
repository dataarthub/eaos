import type { ParsedDocumentResult } from '../ai/document-parser'
import type { ImmutableLedgerEntry, ImmutableLedgerLine } from './immutable-ledger'
import type { CoreAiDraft } from '../ai/governance'
import { assertBalancedLines } from './immutable-ledger'

/**
 * Generic account mapping contract for mapping extracted billable documents into double-entry drafts.
 * @see {@link generateJournalDraftFromDocument}
 */
export interface JournalDraftAccountMapping {
  /** Debit account identifier */
  debitAccountId: string
  /** Credit account identifier */
  creditAccountId: string
  /** Optional host tax account metadata; this helper does not split or calculate tax */
  taxAccountId?: string
}

/**
 * Host resolver that maps context to account identifiers.
 * @typeParam TContext - Host context type passed unchanged to the injected account resolver.
 * @see {@link generateJournalDraftFromDocument}
 */
export type AccountMappingResolver<TContext = unknown> = (
  context: TContext
) => JournalDraftAccountMapping

/**
 * Input request for generating an accounting journal draft from a parsed document.
 * @typeParam TContext - Host context type passed unchanged to the injected account resolver.
 * @see {@link generateJournalDraftFromDocument}
 */
export interface GenerateJournalDraftRequest<TContext = unknown> {
  /**
   * Tenant identity supplied by the host; this field alone does not establish authorization.
   */
  tenantId: string
  /**
   * Host-selected accounting period identity.
   */
  periodId: string
  /**
   * Normalized source document containing extracted tables and Markdown.
   */
  parsedDoc: ParsedDocumentResult
  /** Either a static account mapping or a domain resolver function */
  mapping: JournalDraftAccountMapping | AccountMappingResolver<TContext>
  /** Optional domain context passed to mapping resolver */
  context?: TContext
  /**
   * Identity of the user or agent creating the candidate.
   */
  createdBy: string
}

/**
 * Domain-agnostic pipeline helper that extracts line items from parsed document tables
 * and generates an AI-to-UI draft (Level 2) with balanced double-entry lines.
 *
 * Hosts supply account mappings and context through an injected resolver.
 * Unit-price-only columns are excluded; the helper requires a line-total amount column.
 * Preview totals retain numeric minor units; hosts supply currency formatting.
 * @param request - Tenant, period, parsed source, actor and injected account mapping for the candidate.
 * @returns Balanced DRAFT entry data and a corresponding reviewable UI proposal.
 * @example
 * ```typescript
 * import { generateJournalDraftFromDocument } from '@alneas/eaos-core/plugin-sdk/journal-draft';
 * const result = generateJournalDraftFromDocument({ tenantId: 'tenant-demo', periodId: 'period-1', createdBy: 'actor-1', parsedDoc: { name: 'source.pdf', markdown: '2026-10-24', tables: [{ headers: ['項目', '金額'], rows: [['Service', '100']] }] }, mapping: { debitAccountId: 'account-debit', creditAccountId: 'account-credit' } });
 * console.log(result.draftEntry.status); // DRAFT
 * ```
 * @typeParam TContext - Host context type passed unchanged to the injected account resolver.
 * @throws If no positive whole minor-unit line amounts are found, balance validation fails, or the host mapping resolver throws.
 */
export function generateJournalDraftFromDocument<TContext = unknown>(
  request: GenerateJournalDraftRequest<TContext>
): {
  /**
   * Unposted balanced entry candidate without a persisted identifier.
   */
  draftEntry: Omit<ImmutableLedgerEntry, 'id'>
  /**
   * Reviewable UI proposal containing candidate values; no persistence is performed.
   */
  uiDraft: CoreAiDraft
} {
  const { tenantId, periodId, parsedDoc, mapping, context, createdBy } = request

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
    let amountIdx = table.headers.findIndex(h => /^(?:金額|小計|合計)$/u.test(h))
    if (amountIdx === -1) {
      amountIdx = table.headers.findIndex(h => /金額|小計/u.test(h) && !/単価/u.test(h))
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

  // Resolve accounts via provided mapping or resolver function
  const resolvedMapping: JournalDraftAccountMapping =
    typeof mapping === 'function' ? mapping(context as TContext) : mapping

  const lines: ImmutableLedgerLine[] = [
    {
      accountId: resolvedMapping.debitAccountId,
      side: 'D',
      amount: totalAmount,
    },
    {
      accountId: resolvedMapping.creditAccountId,
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
    createdBy,
    reverses: undefined,
    provenance: {
      createdBy,
      riskLevel: 2,
      aiGenerated: true,
      aiFields: ['lines', 'date', 'description', 'totalAmount'],
    },
  }

  const uiDraft: CoreAiDraft = {
    mode: 'create_journal',
    riskLevel: 2,
    summary: `${parsedDoc.name} から ${lineItems.length} 件の明細（合計 ${totalAmount}）を抽出しました。`,
    fieldMetadata: {
      date: {
        confidence: dateMatch ? 'high' : 'medium',
        reasoning: dateMatch ? '請求書テキストから抽出' : '本日日付で補完',
      },
      lines: {
        confidence: lineItems.length > 0 ? 'high' : 'low',
        reasoning: `表構造より${lineItems.length}行の金額明細を抽出`,
      },
    },
    simulation: {
      title: '財務インパクト試算',
      metrics: [
        { label: '借方合計', after: totalAmount },
        { label: '貸借差額', after: 0 },
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
