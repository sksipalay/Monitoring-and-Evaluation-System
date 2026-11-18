import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ActivityComputed, MonthKey, Program, SystemSettings } from '../types/ppa';
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

export type ReportType =
  | 'annual_ppa'
  | 'monthly_accomplishment'
  | 'physical_accomplishment'
  | 'financial_accomplishment'
  | 'budget_utilization'
  | 'program_level'
  | 'gad_compliance'
  | 'completed_activities'
  | 'pending_not_implemented';

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

function pdfMoney(val: number): string {
  // Use PHP prefix in PDF to ensure clean Helvetica/standard PDF font rendering
  return formatPHP(val).replace('₱', 'PHP ');
}

export function exportReportToPDF(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
}): string {
  const { reportType, fiscalYear, monthKey, programs, activities, settings } = options;
  const def = REPORT_DEFINITIONS.find((r) => r.id === reportType)!;
  const monthObj = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Official LGU Header
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `REPUBLIC OF THE PHILIPPINES  ·  ${settings.provinceName.toUpperCase()}  ·  ${settings.municipalityName.toUpperCase()}`,
    pageWidth / 2,
    12,
    { align: 'center' }
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 41, 74);
  doc.text(def.title.toUpperCase(), pageWidth / 2, 18, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const subline =
    reportType === 'monthly_accomplishment'
      ? `${settings.officeTitle}  |  Fiscal Year: ${fiscalYear}  |  Monitoring Month: ${monthObj.label}`
      : `${settings.officeTitle}  |  Fiscal Year: ${fiscalYear}  |  Generated: ${new Date().toLocaleDateString('en-PH')}`;
  doc.text(subline, pageWidth / 2, 23.5, { align: 'center' });

  const filteredActivities =
    reportType === 'completed_activities'
      ? activities.filter((a) => a.status === 'COMPLETED')
      : reportType === 'pending_not_implemented'
      ? activities.filter((a) => a.status === 'PENDING' || a.status === 'NOT IMPLEMENTED')
      : activities;

  const summary = computeDashboardSummary(programs, filteredActivities);

  // Executive Summary Strip Table
  autoTable(doc, {
    startY: 27,
    head: [
      [
        'Programs',
        'Activities',
        'Total Approved Budget',
        'Revised Budget',
        'Total Expenditure',
        'Remaining Budget',
        'Overall Physical %',
        'Overall Financial %',
      ],
    ],
    body: [
      [
        String(summary.totalPrograms),
        String(summary.totalActivities),
        pdfMoney(summary.totalApprovedBudget),
        pdfMoney(summary.totalRevisedBudget),
        pdfMoney(summary.totalBudgetUtilized),
        pdfMoney(summary.remainingBudget),
        formatPct(summary.overallPhysicalPct),
        formatPct(summary.overallFinancialPct),
      ],
    ],
    styles: {
      fontSize: 7.5,
      cellPadding: 1.8,
      halign: 'center',
      lineColor: [203, 213, 225],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [30, 58, 95],
      textColor: 255,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fillColor: [248, 250, 252],
      fontStyle: 'bold',
      textColor: [15, 23, 42],
    },
    margin: { left: 10, right: 10 },
  });

  const summaryEndY =
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 40) + 4;

  let head: string[][] = [];
  let body: (string | number)[][] = [];
  let foot: (string | number)[][] = [];

  if (reportType === 'program_level') {
    head = [
      [
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
    ];
    const rows = programs.map((p) => summarizeProgram(p, filteredActivities));
    body = rows.map((s) => [
      s.program.aipRefCode,
      s.program.title,
      s.program.sourceOfFund || '-',
      s.activityCount,
      pdfMoney(s.approvedBudget),
      pdfMoney(s.revisedBudget),
      pdfMoney(s.annualFinancialActual),
      pdfMoney(s.remainingBudget),
      formatPct(s.physicalAccomplishmentPct),
      formatPct(s.financialAccomplishmentPct),
    ]);

    const totApproved = round2(rows.reduce((acc, s) => acc + s.approvedBudget, 0));
    const totRevised = round2(rows.reduce((acc, s) => acc + s.revisedBudget, 0));
    const totUtilized = round2(rows.reduce((acc, s) => acc + s.annualFinancialActual, 0));
    const totRemaining = round2(rows.reduce((acc, s) => acc + s.remainingBudget, 0));
    foot = [
      [
        'TOTAL',
        `${rows.length} Program(s)`,
        '',
        rows.reduce((acc, s) => acc + s.activityCount, 0),
        pdfMoney(totApproved),
        pdfMoney(totRevised),
        pdfMoney(totUtilized),
        pdfMoney(totRemaining),
        formatPct(summary.overallPhysicalPct),
        formatPct(summary.overallFinancialPct),
      ],
    ];
  } else if (reportType === 'gad_compliance') {
    const gad = computeGadComplianceSummary(programs, filteredActivities);
    head = [
      [
        'AIP Ref',
        'GAD-Attributed Program',
        'Implementing Office',
        'Source of Fund',
        'PPAs',
        'Approved Budget',
        'Revised Budget',
        'GAD Expenditure',
        'Remaining GAD Budget',
        'Share of Total Budget',
      ],
    ];
    body = gad.gadPrograms.map((s) => {
      const share =
        gad.totalBudgetApproved > 0
          ? round2((s.approvedBudget / gad.totalBudgetApproved) * 100)
          : 0;
      return [
        s.program.aipRefCode,
        s.program.title,
        s.program.officeName,
        s.program.sourceOfFund || '-',
        s.activityCount,
        pdfMoney(s.approvedBudget),
        pdfMoney(s.revisedBudget),
        pdfMoney(s.annualFinancialActual),
        pdfMoney(s.remainingBudget),
        formatPct(share),
      ];
    });
    if (body.length === 0) {
      body = [
        [
          '—',
          'No programs currently flagged as GAD Fund (gadFund = Yes)',
          '',
          '',
          0,
          pdfMoney(0),
          pdfMoney(0),
          pdfMoney(0),
          pdfMoney(0),
          '0.00%',
        ],
      ];
    }
    foot = [
      [
        'GAD TOTAL',
        `${gad.gadProgramCount} GAD Program(s) · 5% Target: ${pdfMoney(gad.mandatoryFivePctTarget)}`,
        gad.isCompliant ? 'STATUS: COMPLIANT (>= 5.00%)' : 'STATUS: BELOW 5.00% TARGET',
        `Variance: ${pdfMoney(gad.varianceFromTarget)}`,
        gad.gadActivityCount,
        pdfMoney(gad.gadApprovedBudget),
        pdfMoney(gad.gadRevisedBudget),
        pdfMoney(gad.gadExpenditure),
        pdfMoney(gad.gadRemainingBudget),
        formatPct(gad.gadShareApprovedPct),
      ],
    ];
  } else if (reportType === 'monthly_accomplishment') {
    head = [
      [
        'Ref Code',
        'Program / Project / Activity',
        'Office',
        `${monthObj.short} Phys. Target`,
        `${monthObj.short} Phys. Actual`,
        `${monthObj.short} Fin. Target`,
        `${monthObj.short} Fin. Actual`,
        'Status',
      ],
    ];
    let totPT = 0;
    let totPA = 0;
    let totFT = 0;
    let totFA = 0;
    body = filteredActivities.map((a) => {
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
        pdfMoney(m.financialTarget),
        pdfMoney(m.financialActual),
        a.status,
      ];
    });
    foot = [
      [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        monthObj.label,
        formatQty(totPT),
        formatQty(totPA),
        pdfMoney(round2(totFT)),
        pdfMoney(round2(totFA)),
        '',
      ],
    ];
  } else if (reportType === 'budget_utilization') {
    head = [
      [
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
    ];
    const programLookup = new Map(programs.map((p) => [p.id, p]));
    const programSumLookup = new Map(
      programs.map((p) => [p.id, summarizeProgram(p, filteredActivities)])
    );
    body = filteredActivities.map((a) => {
      const bd = resolveActivityBudgetDisplay(
        a,
        programLookup.get(a.programId),
        programSumLookup.get(a.programId)
      );
      return [
        a.referenceNumber,
        a.description,
        pdfMoney(bd.gf),
        pdfMoney(bd.ps),
        pdfMoney(bd.mooe),
        pdfMoney(bd.co),
        pdfMoney(bd.approvedBudget),
        pdfMoney(bd.revisedBudget),
        pdfMoney(bd.expenditure),
        pdfMoney(bd.remainingBudget),
        formatPct(bd.utilizationPct),
      ];
    });
    foot = [
      [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        pdfMoney(summary.totalGF),
        pdfMoney(summary.totalPS),
        pdfMoney(summary.totalMOOE),
        pdfMoney(summary.totalCO),
        pdfMoney(summary.totalApprovedBudget),
        pdfMoney(summary.totalRevisedBudget),
        pdfMoney(summary.totalBudgetUtilized),
        pdfMoney(summary.remainingBudget),
        formatPct(summary.budgetUtilizationPct),
      ],
    ];
  } else if (reportType === 'physical_accomplishment') {
    head = [
      [
        'Ref Code',
        'PPA Description',
        'Target Outputs',
        'Office',
        'Annual Phys. Target',
        'Annual Phys. Actual',
        'Physical Accomp %',
        'Status',
      ],
    ];
    body = filteredActivities.map((a) => [
      a.referenceNumber,
      a.description,
      a.targetOutputs,
      a.officeName,
      formatQty(a.annualPhysicalTarget),
      formatQty(a.annualPhysicalActual),
      formatPct(a.physicalAccomplishmentPct),
      a.status,
    ]);
    foot = [
      [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        '',
        '',
        formatQty(summary.totalPhysicalTarget),
        formatQty(summary.totalPhysicalActual),
        formatPct(summary.overallPhysicalPct),
        '',
      ],
    ];
  } else if (reportType === 'financial_accomplishment') {
    const programLookup = new Map(programs.map((p) => [p.id, p]));
    const programSumLookup = new Map(
      programs.map((p) => [p.id, summarizeProgram(p, filteredActivities)])
    );
    head = [
      [
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
    ];
    body = filteredActivities.map((a) => {
      const bd = resolveActivityBudgetDisplay(
        a,
        programLookup.get(a.programId),
        programSumLookup.get(a.programId)
      );
      return [
        a.referenceNumber,
        a.description,
        a.officeName,
        pdfMoney(bd.revisedBudget),
        pdfMoney(a.annualFinancialTarget),
        pdfMoney(a.annualFinancialActual),
        pdfMoney(a.annualFinancialTarget - a.annualFinancialActual),
        formatPct(a.financialAccomplishmentPct),
        a.status,
      ];
    });
    foot = [
      [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        '',
        pdfMoney(summary.totalRevisedBudget),
        pdfMoney(summary.totalFinancialTarget),
        pdfMoney(summary.totalFinancialActual),
        pdfMoney(round2(summary.totalFinancialTarget - summary.totalFinancialActual)),
        formatPct(summary.overallFinancialPct),
        '',
      ],
    ];
  } else {
    const programLookup = new Map(programs.map((p) => [p.id, p]));
    const programSumLookup = new Map(
      programs.map((p) => [p.id, summarizeProgram(p, filteredActivities)])
    );
    head = [
      [
        'Ref Code',
        'PPA Description',
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
    ];
    body = filteredActivities.map((a) => {
      const bd = resolveActivityBudgetDisplay(
        a,
        programLookup.get(a.programId),
        programSumLookup.get(a.programId)
      );
      return [
        a.referenceNumber,
        a.description,
        a.officeName,
        pdfMoney(bd.approvedBudget),
        pdfMoney(bd.revisedBudget),
        pdfMoney(bd.expenditure),
        pdfMoney(bd.remainingBudget),
        formatPct(a.physicalAccomplishmentPct),
        formatPct(a.financialAccomplishmentPct),
        a.status,
        a.remarks || '-',
      ];
    });
    foot = [
      [
        'TOTAL',
        `${filteredActivities.length} Activity(ies)`,
        '',
        pdfMoney(summary.totalApprovedBudget),
        pdfMoney(summary.totalRevisedBudget),
        pdfMoney(summary.totalBudgetUtilized),
        pdfMoney(summary.remainingBudget),
        formatPct(summary.overallPhysicalPct),
        formatPct(summary.overallFinancialPct),
        '',
        '',
      ],
    ];
  }

  autoTable(doc, {
    startY: summaryEndY,
    head,
    body,
    foot,
    showFoot: 'lastPage',
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [15, 41, 74],
      textColor: 255,
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 41, 74],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 10, right: 10, bottom: 16 },
  });

  // Signatory block with automatic page break check
  let sigY =
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 150) + 12;
  if (sigY > pageHeight - 32) {
    doc.addPage();
    sigY = 25;
  }

  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.text('Prepared by:', 15, sigY);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.preparedByName, 15, sigY + 9);
  doc.setFont('helvetica', 'normal');
  doc.text(settings.preparedByTitle, 15, sigY + 13.5);

  doc.text('Reviewed by:', pageWidth / 2 - 30, sigY);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.reviewedByName, pageWidth / 2 - 30, sigY + 9);
  doc.setFont('helvetica', 'normal');
  doc.text(settings.reviewedByTitle, pageWidth / 2 - 30, sigY + 13.5);

  doc.text('Approved by:', pageWidth - 75, sigY);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.approvedByName, pageWidth - 75, sigY + 9);
  doc.setFont('helvetica', 'normal');
  doc.text(settings.approvedByTitle, pageWidth - 75, sigY + 13.5);

  // Page numbering footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `LGU Bula PPA Monitoring System · ${def.title} · Page ${p} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 7,
      { align: 'center' }
    );
  }

  const fileName = `LGU_Bula_${reportType}_FY${fiscalYear}.pdf`;
  doc.save(fileName);
  return fileName;
}
