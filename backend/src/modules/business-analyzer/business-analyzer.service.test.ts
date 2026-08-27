import { describe, expect, it } from 'vitest';
import { computeSummary, parseCsvBuffer } from './business-analyzer.service';
import { AppError } from '../../common/errors/app-error';

const VALID_CSV = `date,category,type,amount,description
2026-07-01,Sales,revenue,1200,July sales
2026-07-05,Marketing,expense,300,Instagram ads
2026-07-10,Sales,revenue,800,More sales
2026-07-12,Rent,expense,400,Studio rent
`;

describe('parseCsvBuffer', () => {
  it('parses valid rows with the required columns', () => {
    const rows = parseCsvBuffer(Buffer.from(VALID_CSV));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ category: 'Sales', type: 'revenue', amount: 1200 });
  });

  it('rejects a file with no data rows', () => {
    expect(() => parseCsvBuffer(Buffer.from('type,amount\n'))).toThrow(AppError);
  });

  it('rejects a file missing the required columns', () => {
    const csv = 'date,description\n2026-01-01,hello\n';
    expect(() => parseCsvBuffer(Buffer.from(csv))).toThrow(AppError);
  });

  it('rejects a row with a non-numeric amount', () => {
    const csv = 'type,amount\nrevenue,not-a-number\n';
    expect(() => parseCsvBuffer(Buffer.from(csv))).toThrow(AppError);
  });

  it('rejects a row with an invalid type value', () => {
    const csv = 'type,amount\nincome,100\n';
    expect(() => parseCsvBuffer(Buffer.from(csv))).toThrow(AppError);
  });

  it('defaults missing category to "Uncategorized"', () => {
    const csv = 'type,amount\nrevenue,100\n';
    const rows = parseCsvBuffer(Buffer.from(csv));
    expect(rows[0]?.category).toBe('Uncategorized');
  });
});

describe('computeSummary', () => {
  it('never fabricates values — every figure is a deterministic function of the input rows (Phase 15 Section 20)', () => {
    const rows = parseCsvBuffer(Buffer.from(VALID_CSV));
    const summary = computeSummary(rows);

    expect(summary.totalRevenue).toBe(2000);
    expect(summary.totalExpenses).toBe(700);
    expect(summary.netProfit).toBe(1300);
    expect(summary.marginPercent).toBe(65);
    expect(summary.source).toBe('CALCULATED_FACT');
  });

  it('produces a correct per-category breakdown, sorted descending by total', () => {
    const rows = parseCsvBuffer(Buffer.from(VALID_CSV));
    const summary = computeSummary(rows);

    expect(summary.revenueByCategory).toEqual([{ category: 'Sales', total: 2000, transactionCount: 2 }]);
    // Rent (400) > Marketing (300) — descending by total, per computeSummary's documented sort.
    expect(summary.expensesByCategory[0]).toMatchObject({ category: 'Rent', total: 400 });
    expect(summary.expensesByCategory[1]).toMatchObject({ category: 'Marketing', total: 300 });
  });

  it('returns null margin when there is no revenue, never divides by zero', () => {
    const rows = parseCsvBuffer(Buffer.from('type,amount\nexpense,50\n'));
    const summary = computeSummary(rows);
    expect(summary.marginPercent).toBeNull();
    expect(summary.totalRevenue).toBe(0);
  });

  it('is a pure function — same input always produces the same output', () => {
    const rows = parseCsvBuffer(Buffer.from(VALID_CSV));
    expect(computeSummary(rows)).toEqual(computeSummary(rows));
  });
});
