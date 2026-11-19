import ExcelJS from 'exceljs';
import {
  Activity,
  ActivityComputed,
  BudgetClassification,
  ImplementationStatus,
  MonthKey,
  MonthlyMonitoringMap,
  Office,
  PageOrientation,
  PaperSize,
  Program,
  ReportType,
  SystemSettings,
} from '../types/ppa';
import {
  MONTHS,
  calculateRevisedBudgetByFund,
  computeActivityMetrics,
  createEmptyMonthlyData,
  isPersonnelServicesFund,
  round2,
  safeNum,
} from './calculations';
import {
  buildTemplatePlaceholderContext,
  filterActivitiesForReport,
  formatFiscalYearDisplay,
  formatPhDate,
} from './templateEngine';

export interface ParsedExcelRow {
  rowNumber: number;
  programTitle: string;
  programRefCode: string;
  referenceNumber: string;
  description: string;
  targetOutputs: string;
  officeName: string;
  budgetClassification: BudgetClassification;
  gf: number;
  ps: number;
  mooe: number;
  co: number;
  withheldAmount: number;
  supplementalBudget1: number;
  supplementalBudget2: number;
  supplementalBudget3: number;
  supplementalBudget4: number;
  supplementalBudget5: number;
  monthly: MonthlyMonitoringMap;
  status: ImplementationStatus;
  remarks: string;
  errors: string[];
  warnings: string[];
  duplicateOfId?: string;
  duplicateReason?: string;
}

export interface ExcelParseResult {
  fileName: string;
  fileSize: number;
  sheetNames: string[];
  selectedSheet: string;
  rows: ParsedExcelRow[];
  validCount: number;
  errorCount: number;
  duplicateCount: number;
  detectedHeaderRow: number;
}

export const MAX_EXCEL_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_EXCEL_DATA_ROWS = 1500;

function hasFormulaInjectionPrefix(val: string): boolean {
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (/^-\d+(\.\d+)?$/.test(trimmed)) return false;
  return /^[=+\-@\t\r]/.test(trimmed);
}

export function sanitizeSpreadsheetInputText(val: string): { text: string; neutralized: boolean } {
  const trimmed = val.trim();
  if (!trimmed) return { text: '', neutralized: false };
  if (hasFormulaInjectionPrefix(trimmed)) {
    return { text: `'${trimmed}`, neutralized: true };
  }
  return { text: trimmed, neutralized: false };
}

function escapeExcelExportText(val: string): string {
  const trimmed = (val || '').trim();
  if (!trimmed) return '';
  if (hasFormulaInjectionPrefix(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

function cellToString(cell: ExcelJS.CellValue): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell.trim();
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
  if (typeof cell === 'object') {
    if ('result' in cell && cell.result !== undefined && cell.result !== null) {
      return String(cell.result).trim();
    }
    if ('richText' in cell && Array.isArray(cell.richText)) {
      return cell.richText.map((r) => r.text).join('').trim();
    }
    if ('text' in cell && typeof cell.text === 'string') {
      return cell.text.trim();
    }
  }
  return '';
}

function cellToNumber(cell: ExcelJS.CellValue): { value: number; invalid: boolean } {
  if (cell === null || cell === undefined || cell === '') return { value: 0, invalid: false };
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? { value: cell, invalid: false } : { value: 0, invalid: true };
  }
  if (typeof cell === 'object' && 'result' in cell) {
    const res = cell.result;
    if (typeof res === 'number') return { value: res, invalid: false };
    if (typeof res === 'string') {
      const n = safeNum(res);
      return { value: n, invalid: false };
    }
    return { value: 0, invalid: false };
  }
  const str = cellToString(cell).replace(/[₱,\s]/g, '');
  if (!str || str === '-' || str === 'N/A') return { value: 0, invalid: false };
  const parsed = Number(str);
  if (!Number.isFinite(parsed)) return { value: 0, invalid: true };
  return { value: parsed, invalid: false };
}

function normalizeStatus(raw: string): ImplementationStatus {
  const s = raw.toUpperCase().trim();
  if (!s) return 'PENDING';
  if (s.includes('COMPLET') || s === 'DONE' || s === '100%') return 'COMPLETED';
  if (s.includes('ON-GOING') || s.includes('ONGOING') || s.includes('IN PROGRESS')) return 'ON-GOING';
  if (s.includes('NOT IMP') || s.includes('UNIMP') || s.includes('DEFER') || s.includes('CANCEL'))
    return 'NOT IMPLEMENTED';
  return 'PENDING';
}

function inferBudgetClass(
  gf: number,
  ps: number,
  mooe: number,
  co: number,
  raw: string
): BudgetClassification {
  const up = raw.toUpperCase().trim();
  if (
    up === 'GF' ||
    up === 'PS' ||
    up === 'MOOE' ||
    up === 'CO' ||
    up === 'PS / MOOE' ||
    up === 'MOOE / CO' ||
    up === 'PS / MOOE / CO'
  ) {
    return up as BudgetClassification;
  }
  const parts: string[] = [];
  if (ps > 0) parts.push('PS');
  if (mooe > 0) parts.push('MOOE');
  if (co > 0) parts.push('CO');
  if (parts.length > 0) return parts.join(' / ') as BudgetClassification;
  if (gf > 0) return 'GF';
  return 'MOOE';
}

function colLetter(colIdx1Based: number): string {
  let n = colIdx1Based;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function excelPaperSizeCode(paperSize: PaperSize): number {
  if (paperSize === 'letter') return 1;
  if (paperSize === 'legal') return 5;
  return 9; // A4
}

function estimateWrappedRowHeight(texts: string[], minHeight = 20): number {
  let maxLines = 1;
  for (const t of texts) {
    if (!t) continue;
    const lines = t.split('\n').reduce((acc, part) => acc + Math.max(1, Math.ceil(part.length / 42)), 0);
    if (lines > maxLines) maxLines = lines;
  }
  return Math.max(minHeight, Math.min(180, maxLines * 14 + 6));
}

function applyTokenReplacementToWorksheet(
  ws: ExcelJS.Worksheet,
  tokens: Record<string, string | number>
) {
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value !== 'string') return;
      let text = cell.value;
      if (!text.includes('{')) return;
      let changed = false;
      text = text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\{\s*([A-Za-z0-9_.-]+)\s*\}/g, (m, k1, k2) => {
        const key = (k1 || k2 || '').trim();
        if (key in tokens) {
          changed = true;
          return escapeExcelExportText(String(tokens[key] ?? ''));
        }
        return m;
      });
      if (changed) {
        cell.value = text;
      }
    });
  });
}

function cloneCellStyle(src: ExcelJS.Cell, dest: ExcelJS.Cell) {
  if (src.style) {
    dest.style = JSON.parse(JSON.stringify(src.style)) as Partial<ExcelJS.Style>;
  }
}

export async function populateOfficialExcelTemplate(options: {
  templateBuffer: ArrayBuffer | Uint8Array;
  fiscalYear: string;
  monthKey?: MonthKey;
  reportType?: ReportType;
  programs: Program[];
  activities: Activity[];
  settings: SystemSettings;
  blankTemplate?: boolean;
  paperSize?: PaperSize;
  orientation?: PageOrientation;
}): Promise<Blob> {
  const {
    templateBuffer,
    fiscalYear,
    monthKey = 'jan',
    reportType = 'annual_ppa',
    programs,
    activities,
    settings,
    blankTemplate = false,
    paperSize = 'a4',
    orientation = 'landscape',
  } = options;

  const bytes = templateBuffer instanceof Uint8Array ? templateBuffer : new Uint8Array(templateBuffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

  const fyPrograms = programs.filter((p) => fiscalYear === 'ALL' || p.fiscalYear === fiscalYear);
  const fyActivities = activities.filter((a) => fiscalYear === 'ALL' || a.fiscalYear === fiscalYear);
  const computedList = filterActivitiesForReport(
    reportType,
    fyActivities.map(computeActivityMetrics)
  );

  const ctx = buildTemplatePlaceholderContext({
    reportType,
    fiscalYear,
    monthKey,
    programs: fyPrograms,
    activities: computedList,
    settings,
  });

  const flatTokens: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === 'string' || typeof v === 'number') {
      flatTokens[k] = v;
    }
  }

  for (const ws of wb.worksheets) {
    applyTokenReplacementToWorksheet(ws, flatTokens);
  }

  const ws = wb.worksheets[0];
  if (ws && !blankTemplate) {
    // Detect data header row in official template
    let headerRowIdx = 0;
    let bestScore = -1;
    const scanMax = Math.min(ws.rowCount, 30);
    for (let r = 1; r <= scanMax; r++) {
      const row = ws.getRow(r);
      let score = 0;
      row.eachCell((cell) => {
        const txt = cellToString(cell.value).toLowerCase();
        if (!txt) return;
        if (txt.includes('description') || txt.includes('ppa') || txt.includes('activity')) score += 3;
        if (txt.includes('ref') || txt.includes('aip')) score += 2;
        if (txt.includes('output') || txt.includes('office')) score += 2;
        if (txt === 'gf' || txt === 'ps' || txt === 'mooe' || txt === 'co') score += 2;
        if (txt.includes('approved') || txt.includes('revised') || txt.includes('status')) score += 2;
      });
      if (score > bestScore) {
        bestScore = score;
        headerRowIdx = r;
      }
    }

    if (headerRowIdx > 0 && bestScore >= 3) {
      const hdrRow = ws.getRow(headerRowIdx);
      const superRow = headerRowIdx > 1 ? ws.getRow(headerRowIdx - 1) : null;
      const totalCols = Math.max(hdrRow.cellCount, superRow?.cellCount ?? 0);

      // Map columns to field names
      const colFieldMap: { col: number; field: string; monthKey?: MonthKey; monthProp?: 'pt' | 'ft' | 'pa' | 'fa' }[] = [];
      let lastSuperMonth: MonthKey | null = null;
      for (let c = 1; c <= totalCols; c++) {
        const rawSub = cellToString(hdrRow.getCell(c).value).toLowerCase();
        const rawSuper = superRow ? cellToString(superRow.getCell(c).value).toLowerCase() : '';
        for (const m of MONTHS) {
          if (rawSuper.includes(m.label.toLowerCase()) || rawSuper === m.short.toLowerCase()) {
            lastSuperMonth = m.key;
            break;
          }
        }
        if (rawSuper && (rawSuper.includes('annual') || rawSuper.includes('summary') || rawSuper.includes('budget'))) {
          lastSuperMonth = null;
        }

        let matchedMonth: MonthKey | null = null;
        for (const m of MONTHS) {
          if (rawSub.startsWith(m.short.toLowerCase() + ' ') || rawSub.includes(m.label.toLowerCase())) {
            matchedMonth = m.key;
            break;
          }
        }
        if (!matchedMonth && lastSuperMonth && (rawSub.includes('physical') || rawSub.includes('financial'))) {
          matchedMonth = lastSuperMonth;
        }

        if (matchedMonth && !`${rawSuper} ${rawSub}`.includes('annual')) {
          if (rawSub.includes('physical') && rawSub.includes('target')) {
            colFieldMap.push({ col: c, field: 'monthly', monthKey: matchedMonth, monthProp: 'pt' });
          } else if (rawSub.includes('financial') && rawSub.includes('target')) {
            colFieldMap.push({ col: c, field: 'monthly', monthKey: matchedMonth, monthProp: 'ft' });
          } else if (rawSub.includes('physical') && rawSub.includes('actual')) {
            colFieldMap.push({ col: c, field: 'monthly', monthKey: matchedMonth, monthProp: 'pa' });
          } else if (rawSub.includes('financial') && rawSub.includes('actual')) {
            colFieldMap.push({ col: c, field: 'monthly', monthKey: matchedMonth, monthProp: 'fa' });
          }
          continue;
        }

        if (rawSub.includes('aip') || rawSub.includes('ref')) colFieldMap.push({ col: c, field: 'ref' });
        else if (rawSub.includes('description') || rawSub === 'ppa' || rawSub.includes('project/activity')) colFieldMap.push({ col: c, field: 'description' });
        else if (rawSub === 'program' || rawSub.includes('program title')) colFieldMap.push({ col: c, field: 'program' });
        else if (rawSub.includes('output')) colFieldMap.push({ col: c, field: 'targetOutputs' });
        else if (rawSub.includes('office') || rawSub.includes('implementing') || rawSub.includes('unit')) colFieldMap.push({ col: c, field: 'office' });
        else if (rawSub.includes('source') || rawSub === 'fund') colFieldMap.push({ col: c, field: 'sourceOfFund' });
        else if (rawSub.includes('classif')) colFieldMap.push({ col: c, field: 'classification' });
        else if (rawSub === 'gf' || rawSub.includes('general fund')) colFieldMap.push({ col: c, field: 'gf' });
        else if (rawSub === 'ps' || rawSub.includes('personal service')) colFieldMap.push({ col: c, field: 'ps' });
        else if (rawSub === 'mooe' || rawSub.includes('maintenance')) colFieldMap.push({ col: c, field: 'mooe' });
        else if (rawSub === 'co' || rawSub.includes('capital outlay')) colFieldMap.push({ col: c, field: 'co' });
        else if (rawSub.includes('approved')) colFieldMap.push({ col: c, field: 'approved' });
        else if (rawSub.includes('withheld')) colFieldMap.push({ col: c, field: 'withheld' });
        else if (rawSub.includes('supplemental') && rawSub.includes('1')) colFieldMap.push({ col: c, field: 'supp1' });
        else if (rawSub.includes('supplemental') && rawSub.includes('2')) colFieldMap.push({ col: c, field: 'supp2' });
        else if (rawSub.includes('supplemental') && rawSub.includes('3')) colFieldMap.push({ col: c, field: 'supp3' });
        else if (rawSub.includes('supplemental') && rawSub.includes('4')) colFieldMap.push({ col: c, field: 'supp4' });
        else if (rawSub.includes('supplemental') && rawSub.includes('5')) colFieldMap.push({ col: c, field: 'supp5' });
        else if (rawSub.includes('revised')) colFieldMap.push({ col: c, field: 'revised' });
        else if (rawSub.includes('annual') && rawSub.includes('phys') && rawSub.includes('target')) colFieldMap.push({ col: c, field: 'annPT' });
        else if (rawSub.includes('annual') && rawSub.includes('phys') && rawSub.includes('actual')) colFieldMap.push({ col: c, field: 'annPA' });
        else if (rawSub.includes('phys') && (rawSub.includes('%') || rawSub.includes('accomp'))) colFieldMap.push({ col: c, field: 'physPct' });
        else if (rawSub.includes('annual') && rawSub.includes('fin') && rawSub.includes('target')) colFieldMap.push({ col: c, field: 'annFT' });
        else if (rawSub.includes('annual') && rawSub.includes('fin') && rawSub.includes('actual')) colFieldMap.push({ col: c, field: 'annFA' });
        else if (rawSub.includes('fin') && (rawSub.includes('%') || rawSub.includes('accomp'))) colFieldMap.push({ col: c, field: 'finPct' });
        else if (rawSub.includes('remaining') || rawSub.includes('balance')) colFieldMap.push({ col: c, field: 'remaining' });
        else if (rawSub.includes('util')) colFieldMap.push({ col: c, field: 'utilPct' });
        else if (rawSub.includes('status')) colFieldMap.push({ col: c, field: 'status' });
        else if (rawSub.includes('remark')) colFieldMap.push({ col: c, field: 'remarks' });
      }

      // Detect blank data zone end (before TOTAL or Signatory rows like "Prepared by")
      const templateDataStartRow = headerRowIdx + 1;
      let existingDataSlots = 0;
      for (let r = templateDataStartRow; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        let rowText = '';
        row.eachCell((c) => {
          rowText += ' ' + cellToString(c.value).toLowerCase();
        });
        if (
          rowText.includes('total') ||
          rowText.includes('prepared by') ||
          rowText.includes('reviewed by') ||
          rowText.includes('approved by')
        ) {
          break;
        }
        existingDataSlots++;
      }

      const styleTemplateRow = ws.getRow(templateDataStartRow);
      const progById = new Map(fyPrograms.map((p) => [p.id, p]));
      const neededRows = Math.max(1, computedList.length);

      // If we need more rows than blank slots before footer/signatories, splice blank rows down safely
      if (existingDataSlots > 0 && neededRows > existingDataSlots) {
        const extraCount = neededRows - existingDataSlots;
        const insertAt = templateDataStartRow + existingDataSlots;
        const emptyRowArrays = Array.from({ length: extraCount }, () => []);
        ws.spliceRows(insertAt, 0, ...emptyRowArrays);
      }

      computedList.forEach((act, idx) => {
        const rowNum = templateDataStartRow + idx;
        const targetRow = ws.getRow(rowNum);
        const prog = progById.get(act.programId);

        for (const mapping of colFieldMap) {
          const srcCell = styleTemplateRow.getCell(mapping.col);
          const destCell = targetRow.getCell(mapping.col);
          if (rowNum !== templateDataStartRow) {
            cloneCellStyle(srcCell, destCell);
          }

          let val: string | number = '';
          let numFmt: string | undefined;
          if (mapping.field === 'monthly' && mapping.monthKey && mapping.monthProp) {
            const mEntry = act.monthly[mapping.monthKey];
            if (mapping.monthProp === 'pt') {
              val = mEntry.physicalTarget;
              numFmt = '#,##0.##';
            } else if (mapping.monthProp === 'ft') {
              val = mEntry.financialTarget;
              numFmt = '₱#,##0.00';
            } else if (mapping.monthProp === 'pa') {
              val = mEntry.physicalActual;
              numFmt = '#,##0.##';
            } else {
              val = mEntry.financialActual;
              numFmt = '₱#,##0.00';
            }
          } else {
            switch (mapping.field) {
              case 'ref':
                val = escapeExcelExportText(act.referenceNumber);
                break;
              case 'description':
                val = escapeExcelExportText(act.description);
                break;
              case 'program':
                val = escapeExcelExportText(prog?.title || '');
                break;
              case 'targetOutputs':
                val = escapeExcelExportText(act.targetOutputs || '');
                break;
              case 'office':
                val = escapeExcelExportText(act.officeName);
                break;
              case 'sourceOfFund':
                val = escapeExcelExportText(act.sourceOfFund || prog?.sourceOfFund || '');
                break;
              case 'classification':
                val = escapeExcelExportText(act.budgetClassification);
                break;
              case 'gf':
                val = act.gf;
                numFmt = '₱#,##0.00';
                break;
              case 'ps':
                val = act.ps;
                numFmt = '₱#,##0.00';
                break;
              case 'mooe':
                val = act.mooe;
                numFmt = '₱#,##0.00';
                break;
              case 'co':
                val = act.co;
                numFmt = '₱#,##0.00';
                break;
              case 'approved':
                val = act.approvedBudget;
                numFmt = '₱#,##0.00';
                break;
              case 'withheld':
                val = act.withheldAmount;
                numFmt = '₱#,##0.00';
                break;
              case 'supp1':
                val = act.supplementalBudget1;
                numFmt = '₱#,##0.00';
                break;
              case 'supp2':
                val = act.supplementalBudget2;
                numFmt = '₱#,##0.00';
                break;
              case 'supp3':
                val = act.supplementalBudget3;
                numFmt = '₱#,##0.00';
                break;
              case 'supp4':
                val = act.supplementalBudget4;
                numFmt = '₱#,##0.00';
                break;
              case 'supp5':
                val = act.supplementalBudget5;
                numFmt = '₱#,##0.00';
                break;
              case 'revised':
                val = act.revisedBudget;
                numFmt = '₱#,##0.00';
                break;
              case 'annPT':
                val = act.annualPhysicalTarget;
                numFmt = '#,##0.##';
                break;
              case 'annPA':
                val = act.annualPhysicalActual;
                numFmt = '#,##0.##';
                break;
              case 'physPct':
                val = act.physicalAccomplishmentPct / 100;
                numFmt = '0.00%';
                break;
              case 'annFT':
                val = act.annualFinancialTarget;
                numFmt = '₱#,##0.00';
                break;
              case 'annFA':
                val = act.annualFinancialActual;
                numFmt = '₱#,##0.00';
                break;
              case 'finPct':
                val = act.financialAccomplishmentPct / 100;
                numFmt = '0.00%';
                break;
              case 'remaining':
                val = act.remainingBudget;
                numFmt = '₱#,##0.00';
                break;
              case 'utilPct':
                val = act.budgetUtilizationPct / 100;
                numFmt = '0.00%';
                break;
              case 'status':
                val = escapeExcelExportText(act.status);
                break;
              case 'remarks':
                val = escapeExcelExportText(act.remarks || '');
                break;
            }
          }
          destCell.value = val;
          if (numFmt && !destCell.numFmt) destCell.numFmt = numFmt;
          destCell.alignment = {
            ...(destCell.alignment || {}),
            wrapText: true,
            vertical: 'top',
          };
        }
        targetRow.height = estimateWrappedRowHeight([
          act.description,
          act.targetOutputs,
          act.remarks,
        ]);
      });

      // Update TOTAL row if present directly after data rows
      const totalRowCandidate = ws.getRow(templateDataStartRow + neededRows);
      const totalFirstCell = cellToString(totalRowCandidate.getCell(1).value).toUpperCase();
      const totalSecondCell = cellToString(totalRowCandidate.getCell(2).value).toUpperCase();
      if (totalFirstCell.includes('TOTAL') || totalSecondCell.includes('TOTAL')) {
        const endDataRow = templateDataStartRow + neededRows - 1;
        for (const mapping of colFieldMap) {
          if (
            ['gf', 'ps', 'mooe', 'co', 'approved', 'withheld', 'supp1', 'supp2', 'supp3', 'supp4', 'supp5', 'revised', 'annPT', 'annPA', 'annFT', 'annFA', 'remaining', 'monthly'].includes(
              mapping.field
            )
          ) {
            const cLet = colLetter(mapping.col);
            totalRowCandidate.getCell(mapping.col).value = {
              formula: `SUM(${cLet}${templateDataStartRow}:${cLet}${endDataRow})`,
            };
          }
        }
      }
    }

    ws.pageSetup = {
      ...(ws.pageSetup || {}),
      paperSize: excelPaperSizeCode(paperSize),
      orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  }

  const outBuf = await wb.xlsx.writeBuffer();
  return new Blob([outBuf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function exportMonitoringWorkbook(options: {
  fiscalYear: string;
  municipalityName: string;
  programs: Program[];
  activities: Activity[];
  blankTemplate?: boolean;
  settings?: SystemSettings;
  reportType?: ReportType;
  programFilterId?: string;
  statusFilter?: string;
  paperSize?: PaperSize;
  orientation?: PageOrientation;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
}): Promise<Blob> {
  const {
    fiscalYear,
    municipalityName,
    programs,
    activities,
    blankTemplate,
    settings,
    reportType,
    programFilterId = 'ALL',
    statusFilter = 'ALL',
    paperSize = 'a4',
    orientation = 'landscape',
    templateBuffer,
  } = options;

  if (templateBuffer) {
    return populateOfficialExcelTemplate({
      templateBuffer,
      fiscalYear,
      reportType: reportType || 'annual_ppa',
      programs: programs.filter((p) => programFilterId === 'ALL' || p.id === programFilterId),
      activities: activities.filter((a) => {
        if (programFilterId !== 'ALL' && a.programId !== programFilterId) return false;
        if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
        return true;
      }),
      settings: settings || {
        municipalityName,
        provinceName: 'Province of Camarines Sur',
        officeTitle: 'Municipal Planning and Development Office (MPDO)',
        defaultFiscalYear: fiscalYear === 'ALL' ? '2026' : fiscalYear,
        preparedByName: '',
        preparedByTitle: '',
        reviewedByName: '',
        reviewedByTitle: '',
        approvedByName: '',
        approvedByTitle: '',
        firebaseWebConfigJson: '',
      },
      blankTemplate,
      paperSize,
      orientation,
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = settings?.appName || 'LGU Bula PPA Monitoring System (MPDO)';
  wb.created = new Date();

  const fyLabel = formatFiscalYearDisplay(fiscalYear);
  const sheetTitle =
    fiscalYear === 'ALL' ? 'PPA Monitoring All Years' : `PPA Monitoring FY ${fiscalYear}`;

  const ws = wb.addWorksheet(sheetTitle, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 6 }],
    pageSetup: {
      paperSize: excelPaperSizeCode(paperSize),
      orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '5:6',
      margins: {
        left: 0.35,
        right: 0.35,
        top: 0.5,
        bottom: 0.5,
        header: 0.25,
        footer: 0.25,
      },
    },
  });

  // Cols:
  // 1: AIP Ref Code
  // 2: Program / Project / Activity Description
  // 3: Program Name / Parent Program
  // 4: Target Outputs
  // 5: Office / Implementing Unit
  // 6: Budget Classification
  // 7: GF
  // 8: PS
  // 9: MOOE
  // 10: CO
  // 11: Total Approved Budget = SUM(G:J)
  // 12: Withheld Amount
  // 13..17: Supplemental Budget 1..5
  // 18: Revised Total Budget
  // 19..66: 12 months * 4 cols (48 cols)
  // 67..76: Annual Summary & Status (10 cols) -> totalCols = 76
  const totalCols = 76;
  const lastColLet = colLetter(totalCols);

  const provinceUpper = (settings?.provinceName || 'Province of Camarines Sur').toUpperCase();
  const officeTitle =
    settings?.officeTitle || 'Municipal Planning and Development Office (MPDO)';

  ws.mergeCells(`A1:${lastColLet}1`);
  ws.getCell('A1').value = `REPUBLIC OF THE PHILIPPINES · ${provinceUpper} · ${municipalityName.toUpperCase()}`;
  ws.getCell('A1').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F294A' } };
  ws.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' };

  ws.mergeCells(`A2:${lastColLet}2`);
  ws.getCell('A2').value = `PROGRAM, PROJECT AND ACTIVITY (PPA) MONITORING REPORT — ${fyLabel.toUpperCase()}`;
  ws.getCell('A2').font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF0F294A' } };
  ws.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };

  ws.mergeCells(`A3:${lastColLet}3`);
  ws.getCell('A3').value = `${officeTitle} · Generated: ${formatPhDate()}`;
  ws.getCell('A3').font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };

  if (blankTemplate) {
    ws.mergeCells(`A4:${lastColLet}4`);
    ws.getCell('A4').value =
      'Blank Official Monitoring Template: Enter PPA rows starting at Row 7. Calculated total and annual summary columns compute automatically.';
    ws.getCell('A4').font = { name: 'Calibri', size: 9.5, color: { argb: 'FF1E3A5F' } };
  }

  const row5 = ws.getRow(5);
  const row6 = ws.getRow(6);

  const staticHeaders = [
    'AIP Ref Code',
    'Program / Project / Activity Description',
    'Program',
    'Target Outputs',
    'Office / Implementing Unit',
    'Classification',
    'GF',
    'PS',
    'MOOE',
    'CO',
    'Total Approved Budget',
    'Withheld Amount',
    'Supplemental Budget 1',
    'Supplemental Budget 2',
    'Supplemental Budget 3',
    'Supplemental Budget 4',
    'Supplemental Budget 5',
    'Revised Total Budget',
  ];

  staticHeaders.forEach((h, idx) => {
    row6.getCell(idx + 1).value = h;
  });

  ws.mergeCells(5, 1, 5, 6);
  row5.getCell(1).value = 'PPA IDENTIFICATION & CLASSIFICATION';

  ws.mergeCells(5, 7, 5, 18);
  row5.getCell(7).value = 'BUDGET ALLOCATION & ADJUSTMENTS (PHP)';

  let colCursor = 19;
  for (const m of MONTHS) {
    ws.mergeCells(5, colCursor, 5, colCursor + 3);
    row5.getCell(colCursor).value = m.label.toUpperCase();
    row6.getCell(colCursor).value = `${m.short} Physical Target`;
    row6.getCell(colCursor + 1).value = `${m.short} Financial Target`;
    row6.getCell(colCursor + 2).value = `${m.short} Physical Actual`;
    row6.getCell(colCursor + 3).value = `${m.short} Financial Actual`;
    colCursor += 4;
  }

  const annualStart = colCursor; // 67
  const summaryHeaders = [
    'Annual Physical Target',
    'Annual Physical Actual',
    'Physical Accomp %',
    'Annual Financial Target',
    'Annual Financial Actual',
    'Financial Accomp %',
    'Remaining Budget',
    'Budget Utilization %',
    'Accomplishment Status',
    'Remarks',
  ];
  ws.mergeCells(5, annualStart, 5, annualStart + summaryHeaders.length - 1);
  row5.getCell(annualStart).value = 'ANNUAL ACCOMPLISHMENT SUMMARY & STATUS';
  summaryHeaders.forEach((h, idx) => {
    row6.getCell(annualStart + idx).value = h;
  });

  // Style rows 5 & 6
  [row5, row6].forEach((r, rIdx) => {
    r.height = 24;
    for (let c = 1; c <= totalCols; c++) {
      const cell = r.getCell(c);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rIdx === 0 ? 'FF0F294A' : 'FF1E3A5F' },
      };
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF334155' } },
        bottom: { style: 'thin', color: { argb: 'FF334155' } },
        left: { style: 'thin', color: { argb: 'FF334155' } },
        right: { style: 'thin', color: { argb: 'FF334155' } },
      };
    }
  });

  let currentRow = 7;

  if (blankTemplate) {
    // Provide 15 clean, unpopulated official blank entry rows with non-intrusive guarded formulas
    const blankRowCount = 15;
    for (let i = 0; i < blankRowCount; i++) {
      const r = ws.getRow(currentRow);
      r.height = 22;
      r.getCell(11).value = {
        formula: `IF(COUNTA(G${currentRow}:J${currentRow})=0,"",SUM(G${currentRow}:J${currentRow}))`,
      };
      r.getCell(18).value = {
        formula: `IF(K${currentRow}="","",IF(UPPER(TRIM(F${currentRow}))="PS",K${currentRow},H${currentRow}+((G${currentRow}+I${currentRow}+J${currentRow})*0.85)))`,
      };

      const ptCols: string[] = [];
      const ftCols: string[] = [];
      const paCols: string[] = [];
      const faCols: string[] = [];
      let cIdx = 19;
      for (let mIdx = 0; mIdx < MONTHS.length; mIdx++) {
        ptCols.push(`${colLetter(cIdx)}${currentRow}`);
        ftCols.push(`${colLetter(cIdx + 1)}${currentRow}`);
        paCols.push(`${colLetter(cIdx + 2)}${currentRow}`);
        faCols.push(`${colLetter(cIdx + 3)}${currentRow}`);
        r.getCell(cIdx).numFmt = '#,##0.##';
        r.getCell(cIdx + 1).numFmt = '₱#,##0.00';
        r.getCell(cIdx + 2).numFmt = '#,##0.##';
        r.getCell(cIdx + 3).numFmt = '₱#,##0.00';
        cIdx += 4;
      }

      const cAnnPT = colLetter(annualStart);
      const cAnnPA = colLetter(annualStart + 1);
      const cAnnFT = colLetter(annualStart + 3);
      const cAnnFA = colLetter(annualStart + 4);
      r.getCell(annualStart).value = {
        formula: `IF(COUNTA(A${currentRow}:B${currentRow})=0,"",SUM(${ptCols.join(',')}))`,
      };
      r.getCell(annualStart + 1).value = {
        formula: `IF(COUNTA(A${currentRow}:B${currentRow})=0,"",SUM(${paCols.join(',')}))`,
      };
      r.getCell(annualStart + 2).value = {
        formula: `IF(${cAnnPT}${currentRow}="","",IF(${cAnnPT}${currentRow}=0,0,${cAnnPA}${currentRow}/${cAnnPT}${currentRow}))`,
      };
      r.getCell(annualStart + 3).value = {
        formula: `IF(COUNTA(A${currentRow}:B${currentRow})=0,"",SUM(${ftCols.join(',')}))`,
      };
      r.getCell(annualStart + 4).value = {
        formula: `IF(COUNTA(A${currentRow}:B${currentRow})=0,"",SUM(${faCols.join(',')}))`,
      };
      r.getCell(annualStart + 5).value = {
        formula: `IF(${cAnnFT}${currentRow}="","",IF(${cAnnFT}${currentRow}=0,0,${cAnnFA}${currentRow}/${cAnnFT}${currentRow}))`,
      };
      r.getCell(annualStart + 6).value = {
        formula: `IF(R${currentRow}="","",R${currentRow}-${cAnnFA}${currentRow})`,
      };
      r.getCell(annualStart + 7).value = {
        formula: `IF(R${currentRow}="","",IF(R${currentRow}=0,0,${cAnnFA}${currentRow}/R${currentRow}))`,
      };

      for (let c = 7; c <= 18; c++) r.getCell(c).numFmt = '₱#,##0.00';
      r.getCell(annualStart).numFmt = '#,##0.##';
      r.getCell(annualStart + 1).numFmt = '#,##0.##';
      r.getCell(annualStart + 2).numFmt = '0.00%';
      r.getCell(annualStart + 3).numFmt = '₱#,##0.00';
      r.getCell(annualStart + 4).numFmt = '₱#,##0.00';
      r.getCell(annualStart + 5).numFmt = '0.00%';
      r.getCell(annualStart + 6).numFmt = '₱#,##0.00';
      r.getCell(annualStart + 7).numFmt = '0.00%';

      for (let c = 1; c <= totalCols; c++) {
        r.getCell(c).alignment = {
          ...(r.getCell(c).alignment || {}),
          wrapText: true,
          vertical: 'top',
        };
        r.getCell(c).border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      }
      currentRow++;
    }
  } else {
    const fyPrograms = programs.filter(
      (p) =>
        (fiscalYear === 'ALL' || p.fiscalYear === fiscalYear) &&
        (programFilterId === 'ALL' || p.id === programFilterId)
    );
    const rawFyActivities = activities.filter((a) => {
      if (fiscalYear !== 'ALL' && a.fiscalYear !== fiscalYear) return false;
      if (programFilterId !== 'ALL' && a.programId !== programFilterId) return false;
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      return true;
    });
    const computedList = reportType
      ? filterActivitiesForReport(reportType, rawFyActivities.map(computeActivityMetrics))
      : rawFyActivities.map(computeActivityMetrics);

    const programMap = new Map(fyPrograms.map((p) => [p.id, p]));
    const orderedProgramIds = [
      ...fyPrograms.map((p) => p.id),
      ...Array.from(
        new Set(computedList.filter((a) => !programMap.has(a.programId)).map((a) => a.programId))
      ),
    ];

    const dataRowIndices: number[] = [];

    for (const progId of orderedProgramIds) {
      const prog = programMap.get(progId);
      const progActivities = computedList.filter((a) => a.programId === progId);
      if (!prog && progActivities.length === 0) continue;
      if (statusFilter !== 'ALL' && progActivities.length === 0) continue;

      const pRow = ws.getRow(currentRow);
      pRow.height = 22;
      pRow.getCell(1).value = escapeExcelExportText(prog?.aipRefCode || 'PROG');
      pRow.getCell(2).value = escapeExcelExportText(prog?.title || 'Unassigned Program');
      pRow.getCell(3).value = escapeExcelExportText(prog?.sector || '');
      pRow.getCell(5).value = escapeExcelExportText(prog?.officeName || '');
      if (prog && safeNum(prog.budget) > 0) {
        const progApp = round2(safeNum(prog.budget));
        const progRev = calculateRevisedBudgetByFund(progApp, prog.sourceOfFund);
        const progExp = round2(
          progActivities.reduce((sum, item) => sum + item.annualFinancialActual, 0)
        );
        pRow.getCell(11).value = progApp;
        pRow.getCell(11).numFmt = '₱#,##0.00';
        pRow.getCell(18).value = progRev;
        pRow.getCell(18).numFmt = '₱#,##0.00';
        pRow.getCell(annualStart + 4).value = progExp;
        pRow.getCell(annualStart + 4).numFmt = '₱#,##0.00';
        pRow.getCell(annualStart + 6).value = round2(progRev - progExp);
        pRow.getCell(annualStart + 6).numFmt = '₱#,##0.00';
      }
      for (let c = 1; c <= totalCols; c++) {
        const cell = pRow.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F294A' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
      }
      currentRow++;

      for (const act of progActivities) {
        const r = ws.getRow(currentRow);
        r.height = estimateWrappedRowHeight([
          act.description,
          act.targetOutputs,
          act.remarks,
        ]);
        r.getCell(1).value = escapeExcelExportText(act.referenceNumber);
        r.getCell(2).value = escapeExcelExportText(act.description);
        r.getCell(3).value = escapeExcelExportText(prog?.title || '');
        r.getCell(4).value = escapeExcelExportText(act.targetOutputs || '');
        r.getCell(5).value = escapeExcelExportText(act.officeName);
        r.getCell(6).value = escapeExcelExportText(act.budgetClassification);
        r.getCell(7).value = act.gf;
        r.getCell(8).value = act.ps;
        r.getCell(9).value = act.mooe;
        r.getCell(10).value = act.co;
        r.getCell(11).value = {
          formula: `SUM(G${currentRow}:J${currentRow})`,
          result: act.approvedBudget,
        };
        r.getCell(12).value = act.withheldAmount;
        r.getCell(13).value = act.supplementalBudget1;
        r.getCell(14).value = act.supplementalBudget2;
        r.getCell(15).value = act.supplementalBudget3;
        r.getCell(16).value = act.supplementalBudget4;
        r.getCell(17).value = act.supplementalBudget5;
        r.getCell(18).value = {
          formula:
            isPersonnelServicesFund(act.sourceOfFund || act.budgetClassification) &&
            act.gf === 0 &&
            act.mooe === 0 &&
            act.co === 0
              ? `K${currentRow}`
              : `H${currentRow}+((G${currentRow}+I${currentRow}+J${currentRow})*0.85)`,
          result: act.revisedBudget,
        };

        const ptCols: string[] = [];
        const ftCols: string[] = [];
        const paCols: string[] = [];
        const faCols: string[] = [];

        let cIdx = 19;
        for (const m of MONTHS) {
          const mData = act.monthly[m.key];
          r.getCell(cIdx).value = mData.physicalTarget;
          r.getCell(cIdx + 1).value = mData.financialTarget;
          r.getCell(cIdx + 2).value = mData.physicalActual;
          r.getCell(cIdx + 3).value = mData.financialActual;

          ptCols.push(`${colLetter(cIdx)}${currentRow}`);
          ftCols.push(`${colLetter(cIdx + 1)}${currentRow}`);
          paCols.push(`${colLetter(cIdx + 2)}${currentRow}`);
          faCols.push(`${colLetter(cIdx + 3)}${currentRow}`);

          r.getCell(cIdx).numFmt = '#,##0.##';
          r.getCell(cIdx + 1).numFmt = '₱#,##0.00';
          r.getCell(cIdx + 2).numFmt = '#,##0.##';
          r.getCell(cIdx + 3).numFmt = '₱#,##0.00';

          cIdx += 4;
        }

        const cAnnPT = colLetter(annualStart);
        const cAnnPA = colLetter(annualStart + 1);
        const cAnnFT = colLetter(annualStart + 3);
        const cAnnFA = colLetter(annualStart + 4);

        r.getCell(annualStart).value = {
          formula: ptCols.join('+'),
          result: act.annualPhysicalTarget,
        };
        r.getCell(annualStart + 1).value = {
          formula: paCols.join('+'),
          result: act.annualPhysicalActual,
        };
        r.getCell(annualStart + 2).value = {
          formula: `IF(${cAnnPT}${currentRow}=0,0,${cAnnPA}${currentRow}/${cAnnPT}${currentRow})`,
          result: act.physicalAccomplishmentPct / 100,
        };
        r.getCell(annualStart + 3).value = {
          formula: ftCols.join('+'),
          result: act.annualFinancialTarget,
        };
        r.getCell(annualStart + 4).value = {
          formula: faCols.join('+'),
          result: act.annualFinancialActual,
        };
        r.getCell(annualStart + 5).value = {
          formula: `IF(${cAnnFT}${currentRow}=0,0,${cAnnFA}${currentRow}/${cAnnFT}${currentRow})`,
          result: act.financialAccomplishmentPct / 100,
        };
        r.getCell(annualStart + 6).value = {
          formula: `R${currentRow}-${cAnnFA}${currentRow}`,
          result: act.remainingBudget,
        };
        r.getCell(annualStart + 7).value = {
          formula: `IF(R${currentRow}=0,0,${cAnnFA}${currentRow}/R${currentRow})`,
          result: act.budgetUtilizationPct / 100,
        };
        r.getCell(annualStart + 8).value = escapeExcelExportText(act.status);
        r.getCell(annualStart + 9).value = escapeExcelExportText(act.remarks || '');

        for (let c = 7; c <= 18; c++) r.getCell(c).numFmt = '₱#,##0.00';
        r.getCell(annualStart).numFmt = '#,##0.##';
        r.getCell(annualStart + 1).numFmt = '#,##0.##';
        r.getCell(annualStart + 2).numFmt = '0.00%';
        r.getCell(annualStart + 3).numFmt = '₱#,##0.00';
        r.getCell(annualStart + 4).numFmt = '₱#,##0.00';
        r.getCell(annualStart + 5).numFmt = '0.00%';
        r.getCell(annualStart + 6).numFmt = '₱#,##0.00';
        r.getCell(annualStart + 7).numFmt = '0.00%';

        for (let c = 1; c <= totalCols; c++) {
          r.getCell(c).alignment = {
            ...(r.getCell(c).alignment || {}),
            wrapText: true,
            vertical: 'top',
          };
          r.getCell(c).border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
        }

        dataRowIndices.push(currentRow);
        currentRow++;
      }
    }

    if (dataRowIndices.length > 0) {
      const gt = ws.getRow(currentRow);
      gt.height = 24;
      gt.getCell(1).value = 'TOTAL';
      gt.getCell(2).value = `GRAND TOTAL (${dataRowIndices.length} Projects & Activities)`;

      const sumCells = (colIdx: number) =>
        dataRowIndices.map((rIdx) => `${colLetter(colIdx)}${rIdx}`).join('+');

      for (let c = 7; c <= 18; c++) {
        gt.getCell(c).value = { formula: sumCells(c) };
        gt.getCell(c).numFmt = '₱#,##0.00';
      }
      for (let c = 19; c <= 66; c++) {
        gt.getCell(c).value = { formula: sumCells(c) };
        const offset = (c - 19) % 4;
        gt.getCell(c).numFmt = offset === 1 || offset === 3 ? '₱#,##0.00' : '#,##0.##';
      }

      gt.getCell(annualStart).value = { formula: sumCells(annualStart) };
      gt.getCell(annualStart).numFmt = '#,##0.##';
      gt.getCell(annualStart + 1).value = { formula: sumCells(annualStart + 1) };
      gt.getCell(annualStart + 1).numFmt = '#,##0.##';
      gt.getCell(annualStart + 2).value = {
        formula: `IF(${colLetter(annualStart)}${currentRow}=0,0,${colLetter(annualStart + 1)}${currentRow}/${colLetter(annualStart)}${currentRow})`,
      };
      gt.getCell(annualStart + 2).numFmt = '0.00%';

      gt.getCell(annualStart + 3).value = { formula: sumCells(annualStart + 3) };
      gt.getCell(annualStart + 3).numFmt = '₱#,##0.00';
      gt.getCell(annualStart + 4).value = { formula: sumCells(annualStart + 4) };
      gt.getCell(annualStart + 4).numFmt = '₱#,##0.00';
      gt.getCell(annualStart + 5).value = {
        formula: `IF(${colLetter(annualStart + 3)}${currentRow}=0,0,${colLetter(annualStart + 4)}${currentRow}/${colLetter(annualStart + 3)}${currentRow})`,
      };
      gt.getCell(annualStart + 5).numFmt = '0.00%';
      gt.getCell(annualStart + 6).value = { formula: sumCells(annualStart + 6) };
      gt.getCell(annualStart + 6).numFmt = '₱#,##0.00';
      gt.getCell(annualStart + 7).value = {
        formula: `IF(R${currentRow}=0,0,${colLetter(annualStart + 4)}${currentRow}/R${currentRow})`,
      };
      gt.getCell(annualStart + 7).numFmt = '0.00%';

      for (let c = 1; c <= totalCols; c++) {
        const cell = gt.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F294A' } };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      }
      currentRow++;
    }
  }

  // Official Signatory Block below table
  const sigStart = currentRow + 2;
  ws.getCell(sigStart, 1).value = 'Prepared by:';
  ws.getCell(sigStart, 1).font = { name: 'Calibri', size: 10, color: { argb: 'FF475569' } };
  ws.getCell(sigStart + 2, 1).value = settings?.preparedByName || '';
  ws.getCell(sigStart + 2, 1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
  ws.getCell(sigStart + 3, 1).value = settings?.preparedByTitle || '';
  ws.getCell(sigStart + 3, 1).font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };

  ws.getCell(sigStart, 3).value = 'Reviewed by:';
  ws.getCell(sigStart, 3).font = { name: 'Calibri', size: 10, color: { argb: 'FF475569' } };
  ws.getCell(sigStart + 2, 3).value = settings?.reviewedByName || '';
  ws.getCell(sigStart + 2, 3).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
  ws.getCell(sigStart + 3, 3).value = settings?.reviewedByTitle || '';
  ws.getCell(sigStart + 3, 3).font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };

  ws.getCell(sigStart, 5).value = 'Approved by:';
  ws.getCell(sigStart, 5).font = { name: 'Calibri', size: 10, color: { argb: 'FF475569' } };
  ws.getCell(sigStart + 2, 5).value = settings?.approvedByName || '';
  ws.getCell(sigStart + 2, 5).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
  ws.getCell(sigStart + 3, 5).value = settings?.approvedByTitle || '';
  ws.getCell(sigStart + 3, 5).font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };

  // Column widths
  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 44;
  ws.getColumn(3).width = 30;
  ws.getColumn(4).width = 32;
  ws.getColumn(5).width = 32;
  ws.getColumn(6).width = 14;
  for (let c = 7; c <= totalCols; c++) {
    ws.getColumn(c).width = 16;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function parseMonitoringWorkbook(
  file: File,
  existingActivities: Activity[],
  fiscalYear: string,
  targetSheetName?: string
): Promise<ExcelParseResult> {
  if (file.size > MAX_EXCEL_FILE_BYTES) {
    throw new Error(
      `Workbook exceeds the 10 MB upload limit (${(file.size / (1024 * 1024)).toFixed(2)} MB). Split into smaller workbooks before importing.`
    );
  }
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheetNames = wb.worksheets.map((s) => s.name);
  const selectedSheet =
    targetSheetName && sheetNames.includes(targetSheetName)
      ? targetSheetName
      : sheetNames[0] || 'Sheet1';

  const ws = wb.getWorksheet(selectedSheet);
  if (!ws) {
    return {
      fileName: file.name,
      fileSize: file.size,
      sheetNames,
      selectedSheet,
      rows: [],
      validCount: 0,
      errorCount: 0,
      duplicateCount: 0,
      detectedHeaderRow: 1,
    };
  }

  let headerRowIdx = 1;
  let bestScore = -1;
  const maxScan = Math.min(ws.rowCount, 20);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    let score = 0;
    row.eachCell((cell) => {
      const txt = cellToString(cell.value).toLowerCase();
      if (!txt) return;
      if (txt.includes('description') || txt.includes('ppa') || txt.includes('activity')) score += 3;
      if (txt.includes('ref') || txt.includes('aip')) score += 2;
      if (txt.includes('target output') || txt.includes('output')) score += 2;
      if (txt === 'gf' || txt.includes('general fund')) score += 2;
      if (txt === 'ps' || txt.includes('personal service')) score += 2;
      if (txt === 'mooe' || txt.includes('maintenance')) score += 2;
      if (txt === 'co' || txt.includes('capital outlay')) score += 2;
      if (txt.includes('status') || txt.includes('remarks')) score += 1;
      if (txt.includes('physical target') || txt.includes('financial target')) score += 2;
    });
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  const colMap: Record<string, number> = {};
  const monthCols: Record<
    MonthKey,
    { pt?: number; ft?: number; pa?: number; fa?: number }
  > = {
    jan: {},
    feb: {},
    mar: {},
    apr: {},
    may: {},
    jun: {},
    jul: {},
    aug: {},
    sep: {},
    oct: {},
    nov: {},
    dec: {},
  };

  const superRow = headerRowIdx > 1 ? ws.getRow(headerRowIdx - 1) : null;
  const hdrRow = ws.getRow(headerRowIdx);
  const colCount = Math.max(hdrRow.cellCount, superRow?.cellCount ?? 0);

  let lastSuperMonth: MonthKey | null = null;

  for (let c = 1; c <= colCount; c++) {
    const rawSub = cellToString(hdrRow.getCell(c).value).toLowerCase();
    const rawSuper = superRow ? cellToString(superRow.getCell(c).value).toLowerCase() : '';

    for (const m of MONTHS) {
      if (rawSuper.includes(m.label.toLowerCase()) || rawSuper === m.short.toLowerCase()) {
        lastSuperMonth = m.key;
        break;
      }
    }
    if (
      rawSuper &&
      !MONTHS.some((m) => rawSuper.includes(m.label.toLowerCase()) || rawSuper === m.short.toLowerCase()) &&
      (rawSuper.includes('annual') || rawSuper.includes('summary') || rawSuper.includes('budget'))
    ) {
      lastSuperMonth = null;
    }

    const combined = `${rawSuper} ${rawSub}`.trim();

    if (colMap.ref === undefined && (rawSub.includes('aip') || rawSub.includes('ref'))) {
      colMap.ref = c;
    } else if (
      colMap.description === undefined &&
      (rawSub.includes('description') || rawSub === 'ppa' || rawSub.includes('project/activity'))
    ) {
      colMap.description = c;
    } else if (colMap.program === undefined && rawSub === 'program') {
      colMap.program = c;
    } else if (colMap.targetOutputs === undefined && rawSub.includes('output')) {
      colMap.targetOutputs = c;
    } else if (
      colMap.office === undefined &&
      (rawSub.includes('office') || rawSub.includes('implementing') || rawSub.includes('department'))
    ) {
      colMap.office = c;
    } else if (colMap.classification === undefined && rawSub.includes('classif')) {
      colMap.classification = c;
    } else if (colMap.gf === undefined && (rawSub === 'gf' || rawSub.includes('general fund'))) {
      colMap.gf = c;
    } else if (colMap.ps === undefined && (rawSub === 'ps' || rawSub.includes('personal service'))) {
      colMap.ps = c;
    } else if (colMap.mooe === undefined && (rawSub === 'mooe' || rawSub.includes('maintenance'))) {
      colMap.mooe = c;
    } else if (colMap.co === undefined && (rawSub === 'co' || rawSub.includes('capital outlay'))) {
      colMap.co = c;
    } else if (colMap.withheld === undefined && rawSub.includes('withheld')) {
      colMap.withheld = c;
    } else if (colMap.supp1 === undefined && rawSub.includes('supplemental') && rawSub.includes('1')) {
      colMap.supp1 = c;
    } else if (colMap.supp2 === undefined && rawSub.includes('supplemental') && rawSub.includes('2')) {
      colMap.supp2 = c;
    } else if (colMap.supp3 === undefined && rawSub.includes('supplemental') && rawSub.includes('3')) {
      colMap.supp3 = c;
    } else if (colMap.supp4 === undefined && rawSub.includes('supplemental') && rawSub.includes('4')) {
      colMap.supp4 = c;
    } else if (colMap.supp5 === undefined && rawSub.includes('supplemental') && rawSub.includes('5')) {
      colMap.supp5 = c;
    } else if (colMap.status === undefined && rawSub.includes('status')) {
      colMap.status = c;
    } else if (colMap.remarks === undefined && rawSub.includes('remark')) {
      colMap.remarks = c;
    }

    let matchedMonth: MonthKey | null = null;
    for (const m of MONTHS) {
      if (
        rawSub.startsWith(m.short.toLowerCase() + ' ') ||
        rawSub.includes(m.label.toLowerCase()) ||
        rawSuper.includes(m.label.toLowerCase())
      ) {
        matchedMonth = m.key;
        break;
      }
    }
    if (!matchedMonth && lastSuperMonth && (rawSub.includes('physical') || rawSub.includes('financial'))) {
      matchedMonth = lastSuperMonth;
    }

    if (matchedMonth && !combined.includes('annual')) {
      if (rawSub.includes('physical') && rawSub.includes('target')) {
        monthCols[matchedMonth].pt = c;
      } else if (rawSub.includes('financial') && rawSub.includes('target')) {
        monthCols[matchedMonth].ft = c;
      } else if (rawSub.includes('physical') && rawSub.includes('actual')) {
        monthCols[matchedMonth].pa = c;
      } else if (rawSub.includes('financial') && rawSub.includes('actual')) {
        monthCols[matchedMonth].fa = c;
      }
    }
  }

  const existingByRef = new Map<string, Activity>();
  const existingByDesc = new Map<string, Activity>();
  for (const a of existingActivities) {
    if (a.fiscalYear === fiscalYear) {
      if (a.referenceNumber) existingByRef.set(a.referenceNumber.toLowerCase(), a);
      existingByDesc.set(a.description.toLowerCase(), a);
    }
  }

  const parsedRows: ParsedExcelRow[] = [];
  let currentProgramTitle = 'General Program';
  let currentProgramRef = '1000-001';

  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    if (parsedRows.length >= MAX_EXCEL_DATA_ROWS) {
      throw new Error(
        `Workbook exceeds the maximum allowed ${MAX_EXCEL_DATA_ROWS} PPA data rows per import batch.`
      );
    }
    const row = ws.getRow(r);
    const rawRefVal = colMap.ref ? cellToString(row.getCell(colMap.ref).value) : '';
    const rawDescVal = colMap.description ? cellToString(row.getCell(colMap.description).value) : '';
    const rawProgColVal = colMap.program ? cellToString(row.getCell(colMap.program).value) : '';
    const rawOutputsVal = colMap.targetOutputs
      ? cellToString(row.getCell(colMap.targetOutputs).value)
      : '';
    const rawOfficeVal = colMap.office ? cellToString(row.getCell(colMap.office).value) : '';

    const refSan = sanitizeSpreadsheetInputText(rawRefVal);
    const descSan = sanitizeSpreadsheetInputText(rawDescVal);
    const progSan = sanitizeSpreadsheetInputText(rawProgColVal);
    const outputsSan = sanitizeSpreadsheetInputText(rawOutputsVal);
    const officeSan = sanitizeSpreadsheetInputText(rawOfficeVal);

    const refVal = refSan.text;
    const descVal = descSan.text;
    const progColVal = progSan.text;
    const outputsVal = outputsSan.text;
    const officeVal = officeSan.text;

    if (!refVal && !descVal) continue;
    const upperRef = refVal.toUpperCase();
    const upperDesc = descVal.toUpperCase();
    if (
      upperRef === 'TOTAL' ||
      upperRef.startsWith('PREPARED BY') ||
      upperRef.startsWith('REVIEWED BY') ||
      upperRef.startsWith('APPROVED BY') ||
      upperDesc.startsWith('GRAND TOTAL') ||
      upperDesc === 'TOTAL'
    ) {
      continue;
    }

    const gfCheck = colMap.gf ? cellToNumber(row.getCell(colMap.gf).value) : { value: 0, invalid: false };
    const psCheck = colMap.ps ? cellToNumber(row.getCell(colMap.ps).value) : { value: 0, invalid: false };
    const mooeCheck = colMap.mooe
      ? cellToNumber(row.getCell(colMap.mooe).value)
      : { value: 0, invalid: false };
    const coCheck = colMap.co ? cellToNumber(row.getCell(colMap.co).value) : { value: 0, invalid: false };

    const isProgramHeader =
      !outputsVal &&
      !progColVal &&
      gfCheck.value === 0 &&
      psCheck.value === 0 &&
      mooeCheck.value === 0 &&
      coCheck.value === 0 &&
      descVal.length > 0 &&
      (!colMap.status || !cellToString(row.getCell(colMap.status).value));

    if (isProgramHeader) {
      currentProgramTitle = descVal;
      currentProgramRef = refVal || currentProgramRef;
      continue;
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!descVal) {
      errors.push('Missing Program/Project/Activity Description.');
    }

    if (gfCheck.invalid || psCheck.invalid || mooeCheck.invalid || coCheck.invalid) {
      errors.push('Invalid numeric value in GF, PS, MOOE, or CO column.');
    }
    if (gfCheck.value < 0 || psCheck.value < 0 || mooeCheck.value < 0 || coCheck.value < 0) {
      errors.push('GF, PS, MOOE, and CO values cannot be negative.');
    }

    const withheldCheck = colMap.withheld
      ? cellToNumber(row.getCell(colMap.withheld).value)
      : { value: 0, invalid: false };
    const s1 = colMap.supp1 ? cellToNumber(row.getCell(colMap.supp1).value).value : 0;
    const s2 = colMap.supp2 ? cellToNumber(row.getCell(colMap.supp2).value).value : 0;
    const s3 = colMap.supp3 ? cellToNumber(row.getCell(colMap.supp3).value).value : 0;
    const s4 = colMap.supp4 ? cellToNumber(row.getCell(colMap.supp4).value).value : 0;
    const s5 = colMap.supp5 ? cellToNumber(row.getCell(colMap.supp5).value).value : 0;

    if (withheldCheck.invalid) {
      errors.push('Invalid numeric value in Withheld Amount.');
    }

    const monthly = createEmptyMonthlyData();
    for (const m of MONTHS) {
      const cols = monthCols[m.key];
      if (cols.pt) {
        const res = cellToNumber(row.getCell(cols.pt).value);
        if (res.invalid) errors.push(`Invalid ${m.short} Physical Target.`);
        monthly[m.key].physicalTarget = res.value;
      }
      if (cols.ft) {
        const res = cellToNumber(row.getCell(cols.ft).value);
        if (res.invalid) errors.push(`Invalid ${m.short} Financial Target.`);
        monthly[m.key].financialTarget = round2(res.value);
      }
      if (cols.pa) {
        const res = cellToNumber(row.getCell(cols.pa).value);
        if (res.invalid) errors.push(`Invalid ${m.short} Physical Actual.`);
        monthly[m.key].physicalActual = res.value;
      }
      if (cols.fa) {
        const res = cellToNumber(row.getCell(cols.fa).value);
        if (res.invalid) errors.push(`Invalid ${m.short} Financial Actual.`);
        monthly[m.key].financialActual = round2(res.value);
      }
    }

    const rawStatus = colMap.status ? cellToString(row.getCell(colMap.status).value) : '';
    const status = normalizeStatus(rawStatus);
    const rawRemarks = colMap.remarks ? cellToString(row.getCell(colMap.remarks).value) : '';
    const remarksSan = sanitizeSpreadsheetInputText(rawRemarks);
    const remarks = remarksSan.text;
    const rawClass = colMap.classification
      ? cellToString(row.getCell(colMap.classification).value)
      : '';

    if (
      refSan.neutralized ||
      descSan.neutralized ||
      progSan.neutralized ||
      outputsSan.neutralized ||
      officeSan.neutralized ||
      remarksSan.neutralized
    ) {
      warnings.push(
        'Potential spreadsheet formula prefix (=, +, -, @) was neutralized for security.'
      );
    }

    const finalRef = refVal || `IMP-${r}`;
    if (!refVal) {
      warnings.push(`Missing AIP Reference Number; assigned ${finalRef}.`);
    }

    const dupByRef = refVal ? existingByRef.get(refVal.toLowerCase()) : undefined;
    const dupByDesc = descVal ? existingByDesc.get(descVal.toLowerCase()) : undefined;
    const dupMatch = dupByRef || dupByDesc;

    parsedRows.push({
      rowNumber: r,
      programTitle: progColVal || currentProgramTitle,
      programRefCode: currentProgramRef,
      referenceNumber: finalRef,
      description: descVal,
      targetOutputs: outputsVal,
      officeName: officeVal || 'Municipal Planning and Development Office',
      budgetClassification: inferBudgetClass(
        gfCheck.value,
        psCheck.value,
        mooeCheck.value,
        coCheck.value,
        rawClass
      ),
      gf: round2(gfCheck.value),
      ps: round2(psCheck.value),
      mooe: round2(mooeCheck.value),
      co: round2(coCheck.value),
      withheldAmount: round2(withheldCheck.value),
      supplementalBudget1: round2(s1),
      supplementalBudget2: round2(s2),
      supplementalBudget3: round2(s3),
      supplementalBudget4: round2(s4),
      supplementalBudget5: round2(s5),
      monthly,
      status,
      remarks,
      errors,
      warnings,
      duplicateOfId: dupMatch?.id,
      duplicateReason: dupByRef
        ? `Matches Reference Number "${dupByRef.referenceNumber}"`
        : dupByDesc
        ? `Matches Description "${dupByDesc.description}"`
        : undefined,
    });
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    sheetNames,
    selectedSheet,
    rows: parsedRows,
    validCount: parsedRows.filter((r) => r.errors.length === 0).length,
    errorCount: parsedRows.filter((r) => r.errors.length > 0).length,
    duplicateCount: parsedRows.filter((r) => Boolean(r.duplicateOfId)).length,
    detectedHeaderRow: headerRowIdx,
  };
}

export function materializeImportedRecords(options: {
  rows: ParsedExcelRow[];
  fiscalYear: string;
  existingPrograms: Program[];
  existingOffices: Office[];
  existingActivities: Activity[];
  duplicateMode: 'skip' | 'update' | 'create';
  userUid: string;
}) {
  const {
    rows,
    fiscalYear,
    existingPrograms,
    existingOffices,
    existingActivities,
    duplicateMode,
    userUid,
  } = options;

  const now = new Date().toISOString();
  const newPrograms: Program[] = [];
  const newOffices: Office[] = [];
  const newActivities: Activity[] = [];
  const updatedActivities: Activity[] = [];

  const progByTitle = new Map<string, Program>();
  for (const p of existingPrograms) {
    if (p.fiscalYear === fiscalYear) {
      progByTitle.set(p.title.toLowerCase(), p);
    }
  }

  const officeByName = new Map<string, Office>();
  for (const o of existingOffices) {
    officeByName.set(o.name.toLowerCase(), o);
    officeByName.set(o.code.toLowerCase(), o);
  }

  const actById = new Map(existingActivities.map((a) => [a.id, a]));

  for (const row of rows) {
    if (row.errors.length > 0) continue;
    if (row.duplicateOfId && duplicateMode === 'skip') continue;

    let office = officeByName.get(row.officeName.toLowerCase());
    if (!office) {
      const code = row.officeName
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 8) || 'OFF';
      office = {
        id: `off-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        code,
        name: row.officeName,
        headName: 'Department Head',
        createdAt: now,
      };
      officeByName.set(office.name.toLowerCase(), office);
      newOffices.push(office);
    }

    let program = progByTitle.get(row.programTitle.toLowerCase());
    if (!program) {
      program = {
        id: `prog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fiscalYear,
        aipRefCode: row.programRefCode || '1000-001',
        title: row.programTitle,
        sector: 'General Public Services',
        officeId: office.id,
        officeName: office.name,
        parentProgramId: null,
        orderIndex: existingPrograms.length + newPrograms.length + 1,
        createdAt: now,
        updatedAt: now,
      };
      progByTitle.set(program.title.toLowerCase(), program);
      newPrograms.push(program);
    }

    if (row.duplicateOfId && duplicateMode === 'update' && actById.has(row.duplicateOfId)) {
      const existing = actById.get(row.duplicateOfId)!;
      updatedActivities.push({
        ...existing,
        programId: program.id,
        referenceNumber: row.referenceNumber,
        description: row.description,
        targetOutputs: row.targetOutputs,
        officeId: office.id,
        officeName: office.name,
        budgetClassification: row.budgetClassification,
        gf: row.gf,
        ps: row.ps,
        mooe: row.mooe,
        co: row.co,
        withheldAmount: row.withheldAmount,
        supplementalBudget1: row.supplementalBudget1,
        supplementalBudget2: row.supplementalBudget2,
        supplementalBudget3: row.supplementalBudget3,
        supplementalBudget4: row.supplementalBudget4,
        supplementalBudget5: row.supplementalBudget5,
        monthly: row.monthly,
        status: row.status,
        remarks: row.remarks,
        updatedBy: userUid,
        updatedAt: now,
      });
    } else {
      newActivities.push({
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        programId: program.id,
        subprogramId: null,
        fiscalYear,
        referenceNumber: row.referenceNumber,
        description: row.description,
        targetOutputs: row.targetOutputs,
        officeId: office.id,
        officeName: office.name,
        budgetClassification: row.budgetClassification,
        gf: row.gf,
        ps: row.ps,
        mooe: row.mooe,
        co: row.co,
        withheldAmount: row.withheldAmount,
        supplementalBudget1: row.supplementalBudget1,
        supplementalBudget2: row.supplementalBudget2,
        supplementalBudget3: row.supplementalBudget3,
        supplementalBudget4: row.supplementalBudget4,
        supplementalBudget5: row.supplementalBudget5,
        monthly: row.monthly,
        status: row.status,
        remarks: row.remarks,
        createdBy: userUid,
        updatedBy: userUid,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return { newPrograms, newOffices, newActivities, updatedActivities };
}

export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function summarizeComputedForExport(activities: Activity[]): ActivityComputed[] {
  return activities.map(computeActivityMetrics);
}

export function buildValidationErrorCsvBlob(result: ExcelParseResult): Blob {
  const csvCell = (raw: string | number) => {
    const str = escapeExcelExportText(String(raw ?? ''));
    return `"${str.replace(/"/g, '""')}"`;
  };
  const header = ['Row Number', 'Severity', 'Reference Code', 'Program', 'Description', 'Issues / Warnings'];
  const lines = [header.map(csvCell).join(',')];

  for (const row of result.rows) {
    if (row.errors.length === 0 && row.warnings.length === 0 && !row.duplicateOfId) continue;
    const severity = row.errors.length > 0 ? 'ERROR' : row.duplicateOfId ? 'DUPLICATE' : 'WARNING';
    const notes = [...row.errors, ...row.warnings, row.duplicateReason].filter(Boolean).join(' | ');
    lines.push(
      [
        row.rowNumber,
        severity,
        row.referenceNumber,
        row.programTitle,
        row.description || '(Empty)',
        notes,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  return new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
}

