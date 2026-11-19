import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import { PDFDocument } from 'pdf-lib';
import {
  ActivityComputed,
  DocumentTemplate,
  ExportValidationIssue,
  ExportValidationReport,
  MonthKey,
  PageOrientation,
  PaperSize,
  Program,
  ReportType,
  SystemSettings,
  TemplateAnalysisSummary,
  TemplateFormat,
  TemplateReportTarget,
} from '../types/ppa';
import {
  MONTHS,
  computeDashboardSummary,
  computeGadComplianceSummary,
  formatPHP,
  formatPct,
  formatQty,
  resolveActivityBudgetDisplay,
  round2,
  summarizeProgram,
} from './calculations';

export const REPORT_DEFINITIONS: {
  id: ReportType;
  title: string;
  description: string;
}[] = [
  {
    id: 'annual_ppa',
    title: 'Annual PPA Monitoring Report',
    description:
      'Comprehensive annual overview of budget, physical/financial accomplishments, and status.',
  },
  {
    id: 'monthly_accomplishment',
    title: 'Monthly Accomplishment Report',
    description: 'Month-specific physical and financial targets versus actual expenditures.',
  },
  {
    id: 'physical_accomplishment',
    title: 'Physical Accomplishment Report',
    description: 'Target outputs, annual physical targets, physical actuals, and accomplishment rates.',
  },
  {
    id: 'financial_accomplishment',
    title: 'Financial Accomplishment Report',
    description: 'Financial targets versus actual financial accomplishments and variance analysis.',
  },
  {
    id: 'budget_utilization',
    title: 'Budget Utilization Report',
    description:
      'GF, PS, MOOE, CO, Approved Budget, Revised Budget (PS Exempt; GF/CO/MOOE − 15%), Expenditure, and Remaining Budget.',
  },
  {
    id: 'program_level',
    title: 'Program-Level Monitoring Report',
    description: 'Aggregated budget and accomplishment summary grouped by LGU Program.',
  },
  {
    id: 'gad_compliance',
    title: 'GAD Fund & 5% Compliance Report',
    description:
      'Gender and Development (GAD) Fund attribution summary tracking mandatory 5% LGU budget threshold compliance.',
  },
  {
    id: 'completed_activities',
    title: 'Completed Activities Report',
    description: 'Listing of all completed programs, projects, and activities with final utilization.',
  },
  {
    id: 'pending_not_implemented',
    title: 'Pending & Not Implemented Activities Report',
    description: 'Action items for pending or deferred PPAs with remarks and unutilized balances.',
  },
];

export const TEMPLATE_TARGET_LABELS: Record<TemplateReportTarget, string> = {
  all_reports: 'All Reports (Global Official Form)',
  excel_monitoring: 'Monitoring Workbook (.xlsx Import/Export)',
  annual_ppa: 'Annual PPA Monitoring Report',
  monthly_accomplishment: 'Monthly Accomplishment Report',
  physical_accomplishment: 'Physical Accomplishment Report',
  financial_accomplishment: 'Financial Accomplishment Report',
  budget_utilization: 'Budget Utilization Report',
  program_level: 'Program-Level Monitoring Report',
  gad_compliance: 'GAD Fund & 5% Compliance Report',
  completed_activities: 'Completed Activities Report',
  pending_not_implemented: 'Pending & Not Implemented Activities Report',
};

export interface CanonicalReportTable {
  title: string;
  headers: string[];
  alignments: ('left' | 'right' | 'center')[];
  rows: string[][];
  foot: string[];
  emptyMessage?: string;
}

export function formatFiscalYearDisplay(fiscalYear: string): string {
  return fiscalYear === 'ALL' ? 'All Fiscal Years' : `FY ${fiscalYear}`;
}

export function formatPhDate(date = new Date()): string {
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function sanitizeCsvOrSpreadsheetText(raw: unknown): string {
  const val = String(raw ?? '').trim();
  if (!val) return '';
  if (/^-\d+(\.\d+)?$/.test(val)) return val;
  if (/^[=+\-@\t\r]/.test(val)) return `'${val}`;
  return val;
}

export function filterActivitiesForReport(
  reportType: ReportType,
  activities: ActivityComputed[]
): ActivityComputed[] {
  if (reportType === 'completed_activities') {
    return activities.filter((a) => a.status === 'COMPLETED');
  }
  if (reportType === 'pending_not_implemented') {
    return activities.filter((a) => a.status === 'PENDING' || a.status === 'NOT IMPLEMENTED');
  }
  return activities;
}

export function buildReportTableData(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
}): CanonicalReportTable {
  const { reportType, monthKey, programs, activities } = options;
  const def = REPORT_DEFINITIONS.find((r) => r.id === reportType) || REPORT_DEFINITIONS[0];
  const monthObj = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];
  const filteredActivities = filterActivitiesForReport(reportType, activities);
  const summary = computeDashboardSummary(programs, filteredActivities);

  if (reportType === 'program_level') {
    const rowsData = programs.map((p) => summarizeProgram(p, filteredActivities));
    const totApproved = round2(rowsData.reduce((acc, s) => acc + s.approvedBudget, 0));
    const totRevised = round2(rowsData.reduce((acc, s) => acc + s.revisedBudget, 0));
    const totUtilized = round2(rowsData.reduce((acc, s) => acc + s.annualFinancialActual, 0));
    const totRemaining = round2(rowsData.reduce((acc, s) => acc + s.remainingBudget, 0));

    return {
      title: def.title,
      headers: [
        'AIP Ref',
        'Program Title',
        'Source of Fund',
        'PPAs',
        'Approved Budget',
        'Revised Budget',
        'Expenditure',
        'Remaining Budget',
        'Physical %',
        'Financial %',
      ],
      alignments: [
        'left',
        'left',
        'left',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
      ],
      rows: rowsData.map((s) => [
        s.program.aipRefCode,
        s.program.title,
        s.program.sourceOfFund || '',
        String(s.activityCount),
        formatPHP(s.approvedBudget),
        formatPHP(s.revisedBudget),
        formatPHP(s.annualFinancialActual),
        formatPHP(s.remainingBudget),
        formatPct(s.physicalAccomplishmentPct),
        formatPct(s.financialAccomplishmentPct),
      ]),
      foot: [
        'TOTAL',
        `${rowsData.length} Program(s)`,
        '',
        String(rowsData.reduce((acc, s) => acc + s.activityCount, 0)),
        formatPHP(totApproved),
        formatPHP(totRevised),
        formatPHP(totUtilized),
        formatPHP(totRemaining),
        formatPct(summary.overallPhysicalPct),
        formatPct(summary.overallFinancialPct),
      ],
      emptyMessage: 'No programs match the selected fiscal year or filters.',
    };
  }

  if (reportType === 'gad_compliance') {
    const gad = computeGadComplianceSummary(programs, filteredActivities);
    return {
      title: def.title,
      headers: [
        'AIP Ref',
        'GAD-Attributed Program',
        'Implementing Office',
        'Source of Fund',
        'PPAs',
        'Approved Budget',
        'Revised Budget',
        'GAD Expenditure',
        'Remaining GAD Budget',
        'Share %',
      ],
      alignments: [
        'left',
        'left',
        'left',
        'left',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
      ],
      rows: gad.gadPrograms.map((s) => {
        const share =
          gad.totalBudgetApproved > 0
            ? round2((s.approvedBudget / gad.totalBudgetApproved) * 100)
            : 0;
        return [
          s.program.aipRefCode,
          s.program.title,
          s.program.officeName,
          s.program.sourceOfFund || '',
          String(s.activityCount),
          formatPHP(s.approvedBudget),
          formatPHP(s.revisedBudget),
          formatPHP(s.annualFinancialActual),
          formatPHP(s.remainingBudget),
          formatPct(share),
        ];
      }),
      foot: [
        'GAD TOTAL',
        `${gad.gadProgramCount} GAD Program(s) · 5% Target: ${formatPHP(gad.mandatoryFivePctTarget)}`,
        gad.isCompliant ? 'COMPLIANT (>= 5.00%)' : 'BELOW 5.00% TARGET',
        `Variance: ${gad.varianceFromTarget >= 0 ? '+' : ''}${formatPHP(gad.varianceFromTarget)}`,
        String(gad.gadActivityCount),
        formatPHP(gad.gadApprovedBudget),
        formatPHP(gad.gadRevisedBudget),
        formatPHP(gad.gadExpenditure),
        formatPHP(gad.gadRemainingBudget),
        formatPct(gad.gadShareApprovedPct),
      ],
      emptyMessage: 'No programs are currently marked as "GAD Fund: Yes" for this fiscal year.',
    };
  }

  if (reportType === 'monthly_accomplishment') {
    let totPT = 0;
    let totPA = 0;
    let totFT = 0;
    let totFA = 0;
    const rows = filteredActivities.map((a) => {
      const m = a.monthly[monthKey];
      totPT += m.physicalTarget;
      totPA += m.physicalActual;
      totFT += m.financialTarget;
      totFA += m.financialActual;
      return [
        a.referenceNumber,
        a.description,
        a.officeName,
        formatQty(m.physicalTarget),
        formatQty(m.physicalActual),
        formatPHP(m.financialTarget),
        formatPHP(m.financialActual),
        a.status,
      ];
    });
    return {
      title: def.title,
      headers: [
        'Ref Code',
        'Program / Project / Activity',
        'Office',
        `${monthObj.short} Phys. Target`,
        `${monthObj.short} Phys. Actual`,
        `${monthObj.short} Fin. Target`,
        `${monthObj.short} Fin. Actual`,
        'Status',
      ],
      alignments: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'left'],
      rows,
      foot: [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        monthObj.label,
        formatQty(totPT),
        formatQty(totPA),
        formatPHP(round2(totFT)),
        formatPHP(round2(totFA)),
        '',
      ],
      emptyMessage: 'No matching activities for the selected month and filters.',
    };
  }

  const programLookup = new Map(programs.map((p) => [p.id, p]));
  const programSumLookup = new Map(
    programs.map((p) => [p.id, summarizeProgram(p, filteredActivities)])
  );

  if (reportType === 'budget_utilization') {
    return {
      title: def.title,
      headers: [
        'Ref Code',
        'PPA Description',
        'GF',
        'PS',
        'MOOE',
        'CO',
        'Approved Budget',
        'Revised Budget',
        'Expenditure',
        'Remaining Budget',
        'Util %',
      ],
      alignments: [
        'left',
        'left',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
      ],
      rows: filteredActivities.map((a) => {
        const bd = resolveActivityBudgetDisplay(
          a,
          programLookup.get(a.programId),
          programSumLookup.get(a.programId)
        );
        return [
          a.referenceNumber,
          a.description,
          formatPHP(bd.gf),
          formatPHP(bd.ps),
          formatPHP(bd.mooe),
          formatPHP(bd.co),
          formatPHP(bd.approvedBudget),
          formatPHP(bd.revisedBudget),
          formatPHP(bd.expenditure),
          formatPHP(bd.remainingBudget),
          formatPct(bd.utilizationPct),
        ];
      }),
      foot: [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        formatPHP(summary.totalGF),
        formatPHP(summary.totalPS),
        formatPHP(summary.totalMOOE),
        formatPHP(summary.totalCO),
        formatPHP(summary.totalApprovedBudget),
        formatPHP(summary.totalRevisedBudget),
        formatPHP(summary.totalBudgetUtilized),
        formatPHP(summary.remainingBudget),
        formatPct(summary.budgetUtilizationPct),
      ],
      emptyMessage: 'No matching PPA records for budget utilization report.',
    };
  }

  if (reportType === 'physical_accomplishment') {
    return {
      title: def.title,
      headers: [
        'Ref Code',
        'PPA Description',
        'Target Outputs',
        'Office',
        'Annual Phys. Target',
        'Annual Phys. Actual',
        'Physical Accomp %',
        'Status',
      ],
      alignments: ['left', 'left', 'left', 'left', 'right', 'right', 'right', 'left'],
      rows: filteredActivities.map((a) => [
        a.referenceNumber,
        a.description,
        a.targetOutputs || '',
        a.officeName,
        formatQty(a.annualPhysicalTarget),
        formatQty(a.annualPhysicalActual),
        formatPct(a.physicalAccomplishmentPct),
        a.status,
      ]),
      foot: [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        '',
        '',
        formatQty(summary.totalPhysicalTarget),
        formatQty(summary.totalPhysicalActual),
        formatPct(summary.overallPhysicalPct),
        '',
      ],
      emptyMessage: 'No matching PPA records for physical accomplishment report.',
    };
  }

  if (reportType === 'financial_accomplishment') {
    return {
      title: def.title,
      headers: [
        'Ref Code',
        'PPA Description',
        'Office',
        'Revised Budget',
        'Annual Fin. Target',
        'Annual Fin. Actual',
        'Variance',
        'Fin. Accomp %',
        'Status',
      ],
      alignments: ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left'],
      rows: filteredActivities.map((a) => {
        const bd = resolveActivityBudgetDisplay(
          a,
          programLookup.get(a.programId),
          programSumLookup.get(a.programId)
        );
        return [
          a.referenceNumber,
          a.description,
          a.officeName,
          formatPHP(bd.revisedBudget),
          formatPHP(a.annualFinancialTarget),
          formatPHP(a.annualFinancialActual),
          formatPHP(round2(a.annualFinancialTarget - a.annualFinancialActual)),
          formatPct(a.financialAccomplishmentPct),
          a.status,
        ];
      }),
      foot: [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        '',
        formatPHP(summary.totalRevisedBudget),
        formatPHP(summary.totalFinancialTarget),
        formatPHP(summary.totalFinancialActual),
        formatPHP(round2(summary.totalFinancialTarget - summary.totalFinancialActual)),
        formatPct(summary.overallFinancialPct),
        '',
      ],
      emptyMessage: 'No matching PPA records for financial accomplishment report.',
    };
  }

  // annual_ppa, completed_activities, pending_not_implemented
  return {
    title: def.title,
    headers: [
      'Ref Code',
      'PPA Description',
      'Target Outputs',
      'Office',
      'Approved Budget',
      'Revised Budget',
      'Expenditure',
      'Remaining Budget',
      'Phys. %',
      'Fin. %',
      'Status',
      'Remarks',
    ],
    alignments: [
      'left',
      'left',
      'left',
      'left',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
      'left',
      'left',
    ],
    rows: filteredActivities.map((a) => {
      const bd = resolveActivityBudgetDisplay(
        a,
        programLookup.get(a.programId),
        programSumLookup.get(a.programId)
      );
      return [
        a.referenceNumber,
        a.description,
        a.targetOutputs || '',
        a.officeName,
        formatPHP(bd.approvedBudget),
        formatPHP(bd.revisedBudget),
        formatPHP(bd.expenditure),
        formatPHP(bd.remainingBudget),
        formatPct(a.physicalAccomplishmentPct),
        formatPct(a.financialAccomplishmentPct),
        a.status,
        a.remarks || '',
      ];
    }),
    foot: [
      'TOTAL',
      `${filteredActivities.length} Activity(ies)`,
      '',
      '',
      formatPHP(summary.totalApprovedBudget),
      formatPHP(summary.totalRevisedBudget),
      formatPHP(summary.totalBudgetUtilized),
      formatPHP(summary.remainingBudget),
      formatPct(summary.overallPhysicalPct),
      formatPct(summary.overallFinancialPct),
      '',
      '',
    ],
    emptyMessage: 'No matching records for this report filter.',
  };
}

export function estimateReportPageCount(options: {
  rowCount: number;
  paperSize: PaperSize;
  orientation: PageOrientation;
  hasSummary?: boolean;
}): number {
  const { rowCount, paperSize, orientation } = options;
  const rowsPerFirstPage =
    orientation === 'landscape'
      ? paperSize === 'legal'
        ? 15
        : 12
      : paperSize === 'legal'
        ? 26
        : 20;
  const rowsPerNextPage =
    orientation === 'landscape'
      ? paperSize === 'legal'
        ? 22
        : 18
      : paperSize === 'legal'
        ? 34
        : 28;
  if (rowCount <= rowsPerFirstPage) return 1;
  return 1 + Math.ceil((rowCount - rowsPerFirstPage) / rowsPerNextPage);
}

export function validateExportDataset(options: {
  reportType: ReportType;
  fiscalYear: string;
  programs: Program[];
  activities: ActivityComputed[];
  paperSize: PaperSize;
  orientation: PageOrientation;
  selectedTemplate?: DocumentTemplate | null;
}): ExportValidationReport {
  const { reportType, fiscalYear, programs, activities, paperSize, orientation, selectedTemplate } =
    options;
  const filteredActivities = filterActivitiesForReport(reportType, activities);
  const summary = computeDashboardSummary(programs, filteredActivities);
  const issues: ExportValidationIssue[] = [];

  const recordCount =
    reportType === 'program_level'
      ? programs.length
      : reportType === 'gad_compliance'
        ? programs.filter((p) => Boolean(p.gadFund)).length
        : filteredActivities.length;

  if (recordCount === 0) {
    issues.push({
      severity: 'warning',
      code: 'EMPTY_DATASET',
      message:
        'No matching records exist for the current report type and filters. Generated exports will show an empty table.',
    });
  }

  if (fiscalYear === 'ALL') {
    issues.push({
      severity: 'info',
      code: 'MULTI_YEAR_COMBINED',
      message:
        'Fiscal Year is set to All Years. Records from all fiscal years matching your filters are included.',
    });
  }

  let missingOptionalFieldsCount = 0;
  for (const a of filteredActivities) {
    if (!a.targetOutputs?.trim()) missingOptionalFieldsCount++;
    if (!a.remarks?.trim()) missingOptionalFieldsCount++;
  }
  if (missingOptionalFieldsCount > 0) {
    issues.push({
      severity: 'info',
      code: 'OPTIONAL_FIELDS_BLANK',
      message: `${missingOptionalFieldsCount} optional field value(s) (Target Outputs / Remarks) are empty and will remain blank in the exported document.`,
    });
  }

  const overspentCount = filteredActivities.filter((a) => a.remainingBudget < 0).length;
  if (overspentCount > 0) {
    issues.push({
      severity: 'warning',
      code: 'NEGATIVE_BALANCE',
      message: `${overspentCount} activity(ies) show negative remaining budget (expenditure exceeds revised allocation).`,
    });
  }

  if (selectedTemplate) {
    if (
      selectedTemplate.targetReport !== 'all_reports' &&
      selectedTemplate.targetReport !== reportType &&
      !(selectedTemplate.targetReport === 'excel_monitoring' && selectedTemplate.format === 'xlsx')
    ) {
      issues.push({
        severity: 'warning',
        code: 'TEMPLATE_TARGET_MISMATCH',
        message: `Selected template "${selectedTemplate.name}" is configured for "${TEMPLATE_TARGET_LABELS[selectedTemplate.targetReport]}" rather than this report.`,
      });
    }
    for (const w of selectedTemplate.analysis.warnings || []) {
      issues.push({
        severity: 'warning',
        code: 'TEMPLATE_STRUCTURE_WARNING',
        message: `Template notice: ${w}`,
      });
    }
  }

  return {
    valid: true,
    recordCount,
    programCount: programs.length,
    totalApprovedBudget: summary.totalApprovedBudget,
    totalRevisedBudget: summary.totalRevisedBudget,
    totalExpenditure: summary.totalBudgetUtilized,
    missingOptionalFieldsCount,
    estimatedPages: estimateReportPageCount({
      rowCount: Math.max(1, recordCount),
      paperSize,
      orientation,
    }),
    issues,
  };
}

export interface TemplateContextRow {
  index: number;
  referenceNumber: string;
  aipRefCode: string;
  description: string;
  programTitle: string;
  targetOutputs: string;
  officeName: string;
  sourceOfFund: string;
  budgetClassification: string;
  gf: string;
  ps: string;
  mooe: string;
  co: string;
  approvedBudget: string;
  revisedBudget: string;
  expenditure: string;
  remainingBudget: string;
  physicalTarget: string;
  physicalActual: string;
  physicalPct: string;
  financialTarget: string;
  financialActual: string;
  financialPct: string;
  utilizationPct: string;
  monthPhysicalTarget: string;
  monthPhysicalActual: string;
  monthFinancialTarget: string;
  monthFinancialActual: string;
  status: string;
  remarks: string;
}

export interface TemplatePlaceholderContext {
  municipalityName: string;
  provinceName: string;
  officeTitle: string;
  appName: string;
  reportTitle: string;
  reportType: string;
  fiscalYear: string;
  fiscalYearLabel: string;
  monitoringMonth: string;
  generatedDate: string;
  generatedDateTime: string;
  preparedByName: string;
  preparedByTitle: string;
  reviewedByName: string;
  reviewedByTitle: string;
  approvedByName: string;
  approvedByTitle: string;
  totalPrograms: number;
  totalActivities: number;
  totalGF: string;
  totalPS: string;
  totalMOOE: string;
  totalCO: string;
  totalApprovedBudget: string;
  totalRevisedBudget: string;
  totalExpenditure: string;
  remainingBudget: string;
  overallPhysicalPct: string;
  overallFinancialPct: string;
  budgetUtilizationPct: string;
  gadProgramCount: number;
  gadApprovedBudget: string;
  gadExpenditure: string;
  gadComplianceStatus: string;
  mandatoryFivePctTarget: string;
  records: TemplateContextRow[];
  activities: TemplateContextRow[];
  rows: TemplateContextRow[];
}

export function buildTemplatePlaceholderContext(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
}): TemplatePlaceholderContext {
  const { reportType, fiscalYear, monthKey, programs, activities, settings } = options;
  const def = REPORT_DEFINITIONS.find((r) => r.id === reportType) || REPORT_DEFINITIONS[0];
  const monthObj = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];
  const filteredActivities = filterActivitiesForReport(reportType, activities);
  const summary = computeDashboardSummary(programs, filteredActivities);
  const gad = computeGadComplianceSummary(programs, filteredActivities);

  const progMap = new Map(programs.map((p) => [p.id, p]));
  const progSumMap = new Map(
    programs.map((p) => [p.id, summarizeProgram(p, filteredActivities)])
  );

  const records: TemplateContextRow[] =
    reportType === 'program_level'
      ? programs.map((p, idx) => {
          const s = progSumMap.get(p.id) || summarizeProgram(p, filteredActivities);
          return {
            index: idx + 1,
            referenceNumber: p.aipRefCode,
            aipRefCode: p.aipRefCode,
            description: p.title,
            programTitle: p.title,
            targetOutputs: s.annualPhysicalTarget > 0 ? formatQty(s.annualPhysicalTarget) : '',
            officeName: p.officeName,
            sourceOfFund: p.sourceOfFund || '',
            budgetClassification: p.sourceOfFund || '',
            gf: formatPHP(s.gf),
            ps: formatPHP(s.ps),
            mooe: formatPHP(s.mooe),
            co: formatPHP(s.co),
            approvedBudget: formatPHP(s.approvedBudget),
            revisedBudget: formatPHP(s.revisedBudget),
            expenditure: formatPHP(s.annualFinancialActual),
            remainingBudget: formatPHP(s.remainingBudget),
            physicalTarget: formatQty(s.annualPhysicalTarget),
            physicalActual: formatQty(s.annualPhysicalActual),
            physicalPct: formatPct(s.physicalAccomplishmentPct),
            financialTarget: formatPHP(s.annualFinancialTarget),
            financialActual: formatPHP(s.annualFinancialActual),
            financialPct: formatPct(s.financialAccomplishmentPct),
            utilizationPct: formatPct(s.budgetUtilizationPct),
            monthPhysicalTarget: '',
            monthPhysicalActual: '',
            monthFinancialTarget: '',
            monthFinancialActual: '',
            status: s.budgetUtilizationPct >= 100 ? 'COMPLETED' : 'ON-GOING',
            remarks: '',
          };
        })
      : filteredActivities.map((a, idx) => {
          const prog = progMap.get(a.programId);
          const bd = resolveActivityBudgetDisplay(a, prog, progSumMap.get(a.programId));
          const m = a.monthly[monthKey];
          return {
            index: idx + 1,
            referenceNumber: a.referenceNumber,
            aipRefCode: prog?.aipRefCode || a.referenceNumber,
            description: a.description,
            programTitle: prog?.title || '',
            targetOutputs: a.targetOutputs || '',
            officeName: a.officeName,
            sourceOfFund: a.sourceOfFund || prog?.sourceOfFund || '',
            budgetClassification: a.budgetClassification,
            gf: formatPHP(bd.gf),
            ps: formatPHP(bd.ps),
            mooe: formatPHP(bd.mooe),
            co: formatPHP(bd.co),
            approvedBudget: formatPHP(bd.approvedBudget),
            revisedBudget: formatPHP(bd.revisedBudget),
            expenditure: formatPHP(bd.expenditure),
            remainingBudget: formatPHP(bd.remainingBudget),
            physicalTarget: formatQty(a.annualPhysicalTarget),
            physicalActual: formatQty(a.annualPhysicalActual),
            physicalPct: formatPct(a.physicalAccomplishmentPct),
            financialTarget: formatPHP(a.annualFinancialTarget),
            financialActual: formatPHP(a.annualFinancialActual),
            financialPct: formatPct(a.financialAccomplishmentPct),
            utilizationPct: formatPct(bd.utilizationPct),
            monthPhysicalTarget: formatQty(m.physicalTarget),
            monthPhysicalActual: formatQty(m.physicalActual),
            monthFinancialTarget: formatPHP(m.financialTarget),
            monthFinancialActual: formatPHP(m.financialActual),
            status: a.status,
            remarks: a.remarks || '',
          };
        });

  return {
    municipalityName: settings.municipalityName || '',
    provinceName: settings.provinceName || '',
    officeTitle: settings.officeTitle || '',
    appName: settings.appName || '',
    reportTitle: def.title,
    reportType,
    fiscalYear,
    fiscalYearLabel: formatFiscalYearDisplay(fiscalYear),
    monitoringMonth: monthObj.label,
    generatedDate: formatPhDate(),
    generatedDateTime: new Date().toLocaleString('en-PH'),
    preparedByName: settings.preparedByName || '',
    preparedByTitle: settings.preparedByTitle || '',
    reviewedByName: settings.reviewedByName || '',
    reviewedByTitle: settings.reviewedByTitle || '',
    approvedByName: settings.approvedByName || '',
    approvedByTitle: settings.approvedByTitle || '',
    totalPrograms: summary.totalPrograms,
    totalActivities: summary.totalActivities,
    totalGF: formatPHP(summary.totalGF),
    totalPS: formatPHP(summary.totalPS),
    totalMOOE: formatPHP(summary.totalMOOE),
    totalCO: formatPHP(summary.totalCO),
    totalApprovedBudget: formatPHP(summary.totalApprovedBudget),
    totalRevisedBudget: formatPHP(summary.totalRevisedBudget),
    totalExpenditure: formatPHP(summary.totalBudgetUtilized),
    remainingBudget: formatPHP(summary.remainingBudget),
    overallPhysicalPct: formatPct(summary.overallPhysicalPct),
    overallFinancialPct: formatPct(summary.overallFinancialPct),
    budgetUtilizationPct: formatPct(summary.budgetUtilizationPct),
    gadProgramCount: gad.gadProgramCount,
    gadApprovedBudget: formatPHP(gad.gadApprovedBudget),
    gadExpenditure: formatPHP(gad.gadExpenditure),
    gadComplianceStatus: gad.isCompliant ? 'COMPLIANT (>= 5.00%)' : 'BELOW 5.00% TARGET',
    mandatoryFivePctTarget: formatPHP(gad.mandatoryFivePctTarget),
    records,
    activities: records,
    rows: records,
  };
}

function excelCellToText(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    if ('result' in val && val.result !== undefined && val.result !== null) {
      return String(val.result).trim();
    }
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((r) => r.text).join('').trim();
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
    }
  }
  return '';
}

function extractXmlText(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<w:tc[^>]*>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractPlaceholderNames(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([#/]?[A-Za-z0-9_.-]+)\s*\}\}|\{\s*([#/]?[A-Za-z0-9_.-]+)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = (m[1] || m[2] || '').trim();
    if (token) found.add(token);
  }
  return Array.from(found);
}

export async function analyzeTemplateBuffer(
  _fileName: string,
  format: TemplateFormat,
  buffer: ArrayBuffer | Uint8Array
): Promise<TemplateAnalysisSummary> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const warnings: string[] = [];

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const sheetNames = wb.worksheets.map((s) => s.name);
    const primary = wb.worksheets[0];
    const placeholders = new Set<string>();
    const detectedColumns: string[] = [];
    let detectedHeaderRow = 1;
    let bestScore = -1;
    let detectedSignatureSection = false;
    let detectedLogoOrImages = false;

    for (const ws of wb.worksheets) {
      if (ws.getImages().length > 0) detectedLogoOrImages = true;
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          const txt = excelCellToText(cell.value);
          if (!txt) return;
          for (const ph of extractPlaceholderNames(txt)) placeholders.add(ph);
          const low = txt.toLowerCase();
          if (
            low.includes('prepared by') ||
            low.includes('reviewed by') ||
            low.includes('approved by')
          ) {
            detectedSignatureSection = true;
          }
        });
      });
    }

    if (primary) {
      const scanLimit = Math.min(primary.rowCount, 30);
      for (let r = 1; r <= scanLimit; r++) {
        const row = primary.getRow(r);
        let score = 0;
        const rowCols: string[] = [];
        row.eachCell((cell) => {
          const txt = excelCellToText(cell.value);
          if (!txt) return;
          rowCols.push(txt);
          const low = txt.toLowerCase();
          if (low.includes('description') || low.includes('ppa') || low.includes('program')) score += 3;
          if (low.includes('ref') || low.includes('aip')) score += 2;
          if (low === 'gf' || low === 'ps' || low === 'mooe' || low === 'co') score += 2;
          if (low.includes('budget') || low.includes('office') || low.includes('status')) score += 2;
        });
        if (score > bestScore && rowCols.length >= 2) {
          bestScore = score;
          detectedHeaderRow = r;
          detectedColumns.splice(0, detectedColumns.length, ...rowCols.slice(0, 40));
        }
      }
    }

    const ps = primary?.pageSetup;
    const orientation: PageOrientation =
      ps?.orientation === 'portrait' ? 'portrait' : 'landscape';
    const paperSize =
      ps?.paperSize === 1 ? 'letter' : ps?.paperSize === 5 ? 'legal' : 'a4';

    if (bestScore < 2 && placeholders.size === 0) {
      warnings.push(
        'No standard PPA table headers (e.g., Ref Code, Description, Budget) or {{placeholders}} were detected on the primary worksheet.'
      );
    }

    return {
      format: 'xlsx',
      pageCountOrSheets: sheetNames.length,
      sheetOrPageNames: sheetNames,
      paperSize,
      orientation,
      detectedPlaceholders: Array.from(placeholders),
      detectedColumns,
      detectedHeaderRow,
      detectedSignatureSection,
      detectedLogoOrImages,
      warnings,
    };
  }

  if (format === 'docx') {
    const zip = new PizZip(bytes);
    const xmlFiles = Object.keys(zip.files).filter(
      (name) =>
        name === 'word/document.xml' ||
        /^word\/header\d*\.xml$/.test(name) ||
        /^word\/footer\d*\.xml$/.test(name)
    );
    const placeholders = new Set<string>();
    let combinedText = '';
    for (const f of xmlFiles) {
      const content = zip.file(f)?.asText() || '';
      const plain = extractXmlText(content);
      combinedText += '\n' + plain;
      for (const ph of extractPlaceholderNames(plain)) {
        placeholders.add(ph);
      }
    }

    const docXml = zip.file('word/document.xml')?.asText() || '';
    const detectedLogoOrImages = Object.keys(zip.files).some((k) => k.startsWith('word/media/'));
    const hasLoop = Array.from(placeholders).some((p) => p.startsWith('#'));
    const pgSzMatch = /<w:pgSz\b([^>]*)\/>/.exec(docXml);
    let orientation: PageOrientation = 'portrait';
    let paperSize = 'a4';
    if (pgSzMatch) {
      const attrs = pgSzMatch[1];
      if (/w:orient="landscape"/i.test(attrs)) orientation = 'landscape';
      const wMatch = /w:w="(\d+)"/.exec(attrs);
      const hMatch = /w:h="(\d+)"/.exec(attrs);
      const longSide = Math.max(Number(wMatch?.[1] || 0), Number(hMatch?.[1] || 0));
      if (longSide > 18000) paperSize = 'legal';
      else if (longSide > 15500 && longSide < 16200) paperSize = 'letter';
    }

    // Extract candidate table headers from first row of first multi-column table
    const detectedColumns: string[] = [];
    const tblMatches = docXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
    for (const tbl of tblMatches) {
      const firstRowMatch = /<w:tr\b[\s\S]*?<\/w:tr>/.exec(tbl);
      if (!firstRowMatch) continue;
      const cells = firstRowMatch[0].match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
      if (cells.length >= 3) {
        for (const c of cells) {
          const text = extractXmlText(c).replace(/\s+/g, ' ').trim();
          if (text) detectedColumns.push(text);
        }
        if (detectedColumns.length >= 3) break;
      }
    }

    const lowCombined = combinedText.toLowerCase();
    const detectedSignatureSection =
      lowCombined.includes('prepared by') ||
      lowCombined.includes('reviewed by') ||
      lowCombined.includes('approved by');

    if (placeholders.size === 0 && detectedColumns.length === 0) {
      warnings.push(
        'No {{placeholders}} or multi-column tables detected in the .docx template. Populated report tables will be appended cleanly below existing document content.'
      );
    }

    return {
      format: 'docx',
      pageCountOrSheets: 1,
      sheetOrPageNames: ['Document'],
      paperSize,
      orientation,
      detectedPlaceholders: Array.from(placeholders),
      detectedColumns,
      hasRowLoopTag: hasLoop,
      detectedSignatureSection,
      detectedLogoOrImages,
      warnings,
    };
  }

  // PDF inspection via pdf-lib
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  let orientation: PageOrientation = 'portrait';
  let paperSize = 'a4';
  if (firstPage) {
    const { width, height } = firstPage.getSize();
    orientation = width > height ? 'landscape' : 'portrait';
    const maxDim = Math.max(width, height);
    if (maxDim > 900) paperSize = 'legal';
    else if (Math.abs(maxDim - 792) < 20) paperSize = 'letter';
  }
  const form = pdfDoc.getForm();
  const acroFields = form.getFields().map((f) => f.getName());
  if (acroFields.length === 0) {
    warnings.push(
      'This PDF does not contain fillable AcroForm fields. The official PDF cover/header layout will be preserved and paginated LGU report tables will be merged seamlessly.'
    );
  }

  return {
    format: 'pdf',
    pageCountOrSheets: pages.length,
    sheetOrPageNames: pages.map((_, idx) => `Page ${idx + 1}`),
    paperSize,
    orientation,
    detectedPlaceholders: acroFields,
    detectedColumns: [],
    hasAcroFormFields: acroFields.length > 0,
    acroFormFields: acroFields,
    detectedSignatureSection: true,
    detectedLogoOrImages: true,
    warnings,
  };
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export async function dataUrlToPngBytes(dataUrl?: string): Promise<Uint8Array | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

  if (dataUrl.startsWith('data:image/png;base64,')) {
    const b64 = dataUrl.slice('data:image/png;base64,'.length);
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  // Convert JPEG / WEBP / SVG to PNG via canvas in browser
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = 256;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          const scale = Math.min(size / (img.width || size), size / (img.height || size));
          const w = (img.width || size) * scale;
          const h = (img.height || size) * scale;
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          const pngUrl = canvas.toDataURL('image/png');
          const b64 = pngUrl.slice('data:image/png;base64,'.length);
          const bin = atob(b64);
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          resolve(out);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  return null;
}

export function buildReportCsvContent(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
}): string {
  const { reportType, fiscalYear, monthKey, programs, activities, settings } = options;
  const table = buildReportTableData({
    reportType,
    fiscalYear,
    monthKey,
    programs,
    activities,
  });

  const csvCell = (raw: unknown) => {
    const safe = sanitizeCsvOrSpreadsheetText(raw);
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const monthObj = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];
  const lines: string[] = [
    [
      `Republic of the Philippines - ${settings.provinceName} - ${settings.municipalityName}`,
    ]
      .map(csvCell)
      .join(','),
    [table.title].map(csvCell).join(','),
    [
      `${settings.officeTitle} | Fiscal Year: ${formatFiscalYearDisplay(fiscalYear)}${
        reportType === 'monthly_accomplishment' ? ` | Month: ${monthObj.label}` : ''
      } | Generated: ${formatPhDate()}`,
    ]
      .map(csvCell)
      .join(','),
    '',
    table.headers.map(csvCell).join(','),
    ...table.rows.map((r) => r.map(csvCell).join(',')),
    table.foot.map(csvCell).join(','),
    '',
    ['Prepared by:', settings.preparedByName || '', settings.preparedByTitle || '']
      .map(csvCell)
      .join(','),
    ['Reviewed by:', settings.reviewedByName || '', settings.reviewedByTitle || '']
      .map(csvCell)
      .join(','),
    ['Approved by:', settings.approvedByName || '', settings.approvedByTitle || '']
      .map(csvCell)
      .join(','),
  ];

  // Include UTF-8 BOM so Excel opens ₱ currency cleanly
  return '\uFEFF' + lines.join('\r\n');
}
