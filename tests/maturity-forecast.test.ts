import { describe, expect, it } from 'vitest';

import { parseForecastWorkbook } from '../src/lib/maturity-forecast';

describe('upcoming maturity workbook', () => {
  it('uses the manually completed MaturityAmount for the August sheet', () => {
    const parsed = parseForecastWorkbook([{
      name: 'August Maturity',
      rows: [
        ['AccountNo', 'Customer Name', 'MaturityDate', 'MaturityAmount', 'Current Maturity Amount'],
        ['1000', 'Faiz', new Date('2026-08-27'), 14500, { formula: '=D2*1.085', result: 15732.5 }],
      ],
    }]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      maturityOn: '2026-08-29',
      currentMaturityRupees: 14500,
    });
  });

  it('reads cached formula results and skips the footer total row', () => {
    const parsed = parseForecastWorkbook([{
      name: 'September Maturity',
      rows: [
        ['AccountNo', 'Customer Name', 'Introducer(Agent Name)', 'Plan', 'Total Deposit Amount', 'Date of Joining', 'MaturityDate', 'PlanName', 'Actual MaturityAmount', 'Current Maturity Amount', 'Tenure (Months)', '', 'Interest Rate'],
        ['1001', 'Asha', 'Agent One', 1000, 36000, new Date('2023-09-01'), new Date('2026-09-01'), '3 Years Monthly', { formula: '=D2*K2', result: 39060 }, { formula: '=E2*(1+$M$2)', result: 39060 }, { formula: '=36', result: 36 }, null, 0.085],
        [null, null, null, 1000, 36000, null, null, null, 39060, 39060, null, null, null],
      ],
    }]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      accountNumber: '1001',
      customerName: 'Asha',
      agentName: 'Agent One',
      maturityOn: '2026-09-01',
      currentMaturityRupees: 39060,
      tenureMonths: 36,
      interestRateBps: 850,
    });
  });
});
