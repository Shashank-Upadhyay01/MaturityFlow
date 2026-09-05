import { excelCellRaw, parseRegisterDate, parseRupeesNumber } from './excel-register';
import type { ISODate } from './working-days';

export interface ForecastSheetGrid {
  name: string;
  rows: unknown[][];
}

export interface ForecastImportRow {
  accountNumber: string;
  customerName: string;
  agentName: string;
  planRupees: number;
  totalDepositRupees: number;
  joinedOn: ISODate | null;
  maturityOn: ISODate;
  productName: string;
  planName: string;
  actualMaturityRupees: number;
  currentMaturityRupees: number;
  tenureMonths: number | null;
  interestRateBps: number | null;
  sourceSheet: string;
  sourceRow: number;
}

export interface ForecastParseResult {
  rows: ForecastImportRow[];
  errors: string[];
  warnings: string[];
}

const clean = (value: unknown): string => String(excelCellRaw(value) ?? '').trim();
const headerKey = (value: unknown): string => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

function column(header: string[], ...names: string[]): number {
  const keys = names.map(headerKey);
  return header.findIndex((value) => keys.includes(value));
}

export function parseForecastWorkbook(sheets: readonly ForecastSheetGrid[]): ForecastParseResult {
  const result: ForecastParseResult = { rows: [], errors: [], warnings: [] };

  for (const sheet of sheets) {
    if (sheet.rows.length < 2) continue;
    const header = sheet.rows[0].map(headerKey);
    const iAccount = column(header, 'AccountNo', 'Account Number');
    const iCustomer = column(header, 'Customer Name');
    const iAgent = column(header, 'Introducer(Agent Name)', 'Agent Name', 'Introducer');
    const iPlan = column(header, 'Plan');
    const iDeposit = column(header, 'Total Deposit Amount');
    const iJoined = column(header, 'Date of Joining');
    const iMaturity = column(header, 'MaturityDate', 'Maturity Date');
    const iProduct = column(header, 'ProductName', 'Product Name');
    const iPlanName = column(header, 'PlanName', 'Plan Name');
    const iActual = column(header, 'Actual MaturityAmount', 'Actual Maturity Amount');
    const iCurrent = column(header, 'Current Maturity Amount');
    const iFallbackAmount = column(header, 'MaturityAmount', 'Maturity Amount');
    const iTenure = column(header, 'Tenure (Months)', 'Tenure Months');
    const iRate = column(header, 'Interest Rate');

    if (iCustomer < 0 || iMaturity < 0 || (iCurrent < 0 && iActual < 0 && iFallbackAmount < 0)) {
      result.errors.push(`${sheet.name}: required Customer Name, MaturityDate and maturity amount columns were not found.`);
      continue;
    }

    // The supplied August register is a confirmed exception: its manually completed
    // MaturityAmount already includes the 8.50% interest. Later sheets use the
    // calculated Current Maturity Amount, with the existing fallbacks for older files.
    const selectedAmountColumn = /\baugust\b/i.test(sheet.name) && iFallbackAmount >= 0
      ? iFallbackAmount
      : iCurrent >= 0
        ? iCurrent
        : iActual >= 0
          ? iActual
          : iFallbackAmount;
    const useConfirmedAugustDate = /\baugust\b/i.test(sheet.name);

    for (let index = 1; index < sheet.rows.length; index += 1) {
      const line = sheet.rows[index] ?? [];
      const customerName = clean(line[iCustomer]);
      if (!customerName) continue; // totals/footer row
      const sourceMaturityOn = parseRegisterDate(excelCellRaw(line[iMaturity]));
      const maturityOn = useConfirmedAugustDate && sourceMaturityOn?.startsWith('2026-08')
        ? '2026-08-29'
        : sourceMaturityOn;
      const current = parseRupeesNumber(excelCellRaw(line[selectedAmountColumn]));
      if (!maturityOn || current <= 0) {
        result.errors.push(`${sheet.name} row ${index + 1} (${customerName}): maturity date or maturity amount is invalid.`);
        continue;
      }
      const rawRate = iRate >= 0 ? parseRupeesNumber(excelCellRaw(line[iRate])) : 0;
      const rawTenure = iTenure >= 0 ? parseRupeesNumber(excelCellRaw(line[iTenure])) : 0;
      result.rows.push({
        accountNumber: iAccount >= 0 ? clean(line[iAccount]) : '',
        customerName,
        agentName: iAgent >= 0 ? clean(line[iAgent]) : '',
        planRupees: iPlan >= 0 ? parseRupeesNumber(excelCellRaw(line[iPlan])) : 0,
        totalDepositRupees: iDeposit >= 0 ? parseRupeesNumber(excelCellRaw(line[iDeposit])) : 0,
        joinedOn: iJoined >= 0 ? parseRegisterDate(excelCellRaw(line[iJoined])) : null,
        maturityOn,
        productName: iProduct >= 0 ? clean(line[iProduct]) : '',
        planName: iPlanName >= 0 ? clean(line[iPlanName]) : '',
        actualMaturityRupees: iActual >= 0 ? parseRupeesNumber(excelCellRaw(line[iActual])) : 0,
        currentMaturityRupees: current,
        tenureMonths: rawTenure > 0 ? Math.round(rawTenure) : null,
        interestRateBps: rawRate > 0 ? Math.round((rawRate <= 1 ? rawRate * 100 : rawRate) * 100) : null,
        sourceSheet: sheet.name,
        sourceRow: index + 1,
      });
    }
  }

  return result;
}
