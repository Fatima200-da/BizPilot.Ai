import { parse } from 'csv-parse/sync';
import { ValidationError } from '../../common/errors/app-error';

/**
 * Business Data Analyzer FOUNDATION (Phase 15 Section 18) — explicitly
 * scoped down per that section's own permission: "If the repository is not
 * ready for the full analyzer, implement the cleanest production-quality
 * foundation and explicitly identify what remains." What this delivers:
 * CSV parsing and deterministic revenue/expense/category calculation —
 * the RAW DATA -> CALCULATED FACTS half of Section 18's required chain.
 * What is explicitly NOT implemented (see completion report Section L):
 * XLSX support, persistence of analysis runs, anomaly detection, and the
 * CALCULATED FACTS -> INTERPRETATION -> RECOMMENDATION half (the AI layer),
 * which correctly requires the same fact/interpretation/recommendation
 * labeling discipline as PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section
 * 11.2 and deserves its own dedicated implementation pass, not a rushed one
 * bolted onto this foundation.
 */

export interface ParsedRow {
  date?: string;
  category?: string;
  description?: string;
  type?: 'revenue' | 'expense';
  amount: number;
}

export interface CategoryBreakdown {
  category: string;
  total: number;
  transactionCount: number;
}

export interface RevenueExpenseSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  marginPercent: number | null;
  transactionCount: number;
  revenueByCategory: CategoryBreakdown[];
  expensesByCategory: CategoryBreakdown[];
  /** Explicit provenance label, mirroring PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 11.2's discipline. */
  source: 'CALCULATED_FACT';
}

const REQUIRED_COLUMNS = ['type', 'amount'] as const;

export function parseCsvBuffer(buffer: Buffer): ParsedRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  } catch (err) {
    throw new ValidationError([{ field: 'file', code: 'INVALID_CSV', message: `Could not parse CSV: ${(err as Error).message}` }]);
  }

  const firstRow = records[0];
  if (!firstRow) {
    throw new ValidationError([{ field: 'file', code: 'EMPTY_FILE', message: 'The uploaded file has no data rows.' }]);
  }

  const headerKeys = Object.keys(firstRow).map((h) => h.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((col) => !headerKeys.includes(col));
  if (missing.length > 0) {
    throw new ValidationError([
      { field: 'file', code: 'MISSING_COLUMNS', message: `CSV is missing required column(s): ${missing.join(', ')}. Expected at least: type, amount.` },
    ]);
  }

  return records.map((row, idx) => {
    const rowNumber = String(idx + 1);
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) normalized[k.toLowerCase()] = v;

    const amount = Number(normalized.amount);
    if (Number.isNaN(amount)) {
      throw new ValidationError([{ field: `row[${rowNumber}].amount`, code: 'INVALID_NUMBER', message: `Row ${rowNumber}: "amount" is not a valid number.` }]);
    }
    const type = normalized.type?.toLowerCase();
    if (type !== 'revenue' && type !== 'expense') {
      throw new ValidationError([
        {
          field: `row[${rowNumber}].type`,
          code: 'INVALID_ENUM_VALUE',
          message: `Row ${rowNumber}: "type" must be "revenue" or "expense", got "${normalized.type ?? ''}".`,
        },
      ]);
    }

    return {
      date: normalized.date,
      category: normalized.category || 'Uncategorized',
      description: normalized.description,
      type,
      amount: Math.abs(amount),
    };
  });
}

/** Pure, deterministic computation — never touches the AI provider (Section 20's "AI must not invent revenue/expenses"). */
export function computeSummary(rows: ParsedRow[]): RevenueExpenseSummary {
  const revenueRows = rows.filter((r) => r.type === 'revenue');
  const expenseRows = rows.filter((r) => r.type === 'expense');

  const totalRevenue = round2(revenueRows.reduce((sum, r) => sum + r.amount, 0));
  const totalExpenses = round2(expenseRows.reduce((sum, r) => sum + r.amount, 0));
  const netProfit = round2(totalRevenue - totalExpenses);

  return {
    totalRevenue,
    totalExpenses,
    netProfit,
    marginPercent: totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : null,
    transactionCount: rows.length,
    revenueByCategory: byCategory(revenueRows),
    expensesByCategory: byCategory(expenseRows),
    source: 'CALCULATED_FACT',
  };
}

function byCategory(rows: ParsedRow[]): CategoryBreakdown[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const key = row.category ?? 'Uncategorized';
    const entry = map.get(key) ?? { total: 0, count: 0 };
    entry.total += row.amount;
    entry.count += 1;
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({ category, total: round2(v.total), transactionCount: v.count }))
    .sort((a, b) => b.total - a.total);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
