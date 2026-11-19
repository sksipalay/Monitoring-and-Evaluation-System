import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  ActivityComputed,
  MonthKey,
  PageOrientation,
  PaperSize,
  Program,
  ReportType,
  SystemSettings,
} from '../types/ppa';
import {
  MONTHS,
  computeDashboardSummary,
  computeGadComplianceSummary,
  formatPHP,
  formatPct,
} from './calculations';
import {
  REPORT_DEFINITIONS,
  buildReportTableData,
  buildTemplatePlaceholderContext,
  dataUrlToPngBytes,
  filterActivitiesForReport,
  formatFiscalYearDisplay,
  formatPhDate,
} from './templateEngine';

export { REPORT_DEFINITIONS };
export type { ReportType };

interface LoadedUnicodeFonts {
  regularBase64: string;
  boldBase64: string;
  regularBytes: Uint8Array;
  boldBytes: Uint8Array;
}

let cachedFontsPromise: Promise<LoadedUnicodeFonts | null> | null = null;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(bytes).toString('base64');
}

async function fetchBrowserUnicodeFonts(): Promise<LoadedUnicodeFonts | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  if (!cachedFontsPromise) {
    cachedFontsPromise = (async () => {
      try {
        const [regRes, boldRes] = await Promise.all([
          fetch('/fonts/DejaVuSans.ttf'),
          fetch('/fonts/DejaVuSans-Bold.ttf'),
        ]);
        if (!regRes.ok || !boldRes.ok) return null;
        const [regBuf, boldBuf] = await Promise.all([
          regRes.arrayBuffer(),
          boldRes.arrayBuffer(),
        ]);
        const regularBytes = new Uint8Array(regBuf);
        const boldBytes = new Uint8Array(boldBuf);
        return {
          regularBytes,
          boldBytes,
          regularBase64: uint8ToBase64(regularBytes),
          boldBase64: uint8ToBase64(boldBytes),
        };
      } catch {
        return null;
      }
    })();
  }
  return cachedFontsPromise;
}

function buildColumnWidths(
  headers: string[],
  alignments: ('left' | 'right' | 'center')[],
  usableWidth: number
): Record<number, { cellWidth?: number; halign?: 'left' | 'right' | 'center' }> {
  // Weight columns smartly so long descriptions/outputs/remarks wrap comfortably without overflowing
  const weights = headers.map((h) => {
    const low = h.toLowerCase();
    if (
      low.includes('description') ||
      low.includes('program title') ||
      low.includes('gad-attributed')
    ) {
      return 2.9;
    }
    if (low.includes('output') || low.includes('remark')) return 1.9;
    if (
      low.includes('approved') ||
      low.includes('revised') ||
      low.includes('expenditure') ||
      low.includes('remaining') ||
      low.includes('variance') ||
      low.includes('financial') ||
      low.includes('utilization')
    ) {
      return 1.75;
    }
    if (low.includes('office') || low.includes('source')) return 1.5;
    if (low.includes('ref')) return 1.3;
    if (low.includes('status')) return 1.3;
    if (
      low === 'ppas' ||
      low.includes('%') ||
      low === 'gf' ||
      low === 'ps' ||
      low === 'mooe' ||
      low === 'co'
    ) {
      return 1.15;
    }
    return 1.45;
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const minColWidth = headers.length >= 11 ? 10.5 : 12;
  const rawWidths = weights.map((w) => Math.max(minColWidth, (w / totalWeight) * usableWidth));
  const rawSum = rawWidths.reduce((a, b) => a + b, 0) || usableWidth;
  const scale = usableWidth / rawSum;
  const roundedWidths = rawWidths.map((w) => Math.round(w * scale * 100) / 100);

  // Absorb rounding residual into the widest text column so total matches usableWidth exactly
  const roundedSum = roundedWidths.reduce((a, b) => a + b, 0);
  const residual = Math.round((usableWidth - roundedSum) * 100) / 100;
  let widestIdx = 0;
  for (let i = 1; i < roundedWidths.length; i++) {
    if (roundedWidths[i] > roundedWidths[widestIdx]) widestIdx = i;
  }
  roundedWidths[widestIdx] = Math.round((roundedWidths[widestIdx] + residual) * 100) / 100;

  const styles: Record<number, { cellWidth?: number; halign?: 'left' | 'right' | 'center' }> = {};
  headers.forEach((_, idx) => {
    styles[idx] = {
      cellWidth: roundedWidths[idx],
      halign: alignments[idx] || 'left',
    };
  });
  return styles;
}

export async function generateReportPDFBytes(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
  paperSize?: PaperSize;
  orientation?: PageOrientation;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
  fontBytesOverride?: { regular: Uint8Array; bold: Uint8Array };
}): Promise<{ bytes: Uint8Array; fileName: string; pageCount: number }> {
  const {
    reportType,
    fiscalYear,
    monthKey,
    programs,
    activities,
    settings,
    paperSize = 'a4',
    orientation = 'landscape',
    templateBuffer,
    fontBytesOverride,
  } = options;

  const def = REPORT_DEFINITIONS.find((r) => r.id === reportType) || REPORT_DEFINITIONS[0];
  const monthObj = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];
  const filteredActivities = filterActivitiesForReport(reportType, activities);
  const summary = computeDashboardSummary(programs, filteredActivities);
  const tableData = buildReportTableData({
    reportType,
    fiscalYear,
    monthKey,
    programs,
    activities,
  });

  const unicodeFonts: LoadedUnicodeFonts | null = fontBytesOverride
    ? {
        regularBytes: fontBytesOverride.regular,
        boldBytes: fontBytesOverride.bold,
        regularBase64: uint8ToBase64(fontBytesOverride.regular),
        boldBase64: uint8ToBase64(fontBytesOverride.bold),
      }
    : await fetchBrowserUnicodeFonts();

  const hasUnicodeFont = Boolean(unicodeFonts);
  const normalizeText = (s: string) => (hasUnicodeFont ? s : s.replace(/₱/g, 'PHP '));
  const pdfMoney = (val: number) => normalizeText(formatPHP(val));

  // If official PDF template is provided, inspect its page geometry so continuation pages match
  let targetOrientation = orientation;
  let targetFormat: PaperSize | [number, number] = paperSize;
  let officialPdfDoc: PDFDocument | null = null;

  if (templateBuffer) {
    const tplBytes =
      templateBuffer instanceof Uint8Array ? templateBuffer : new Uint8Array(templateBuffer);
    officialPdfDoc = await PDFDocument.load(tplBytes, { ignoreEncryption: true });
    const firstPage = officialPdfDoc.getPages()[0];
    if (firstPage) {
      const { width, height } = firstPage.getSize();
      targetOrientation = width > height ? 'landscape' : 'portrait';
      // jsPDF expects [width, height] in mm when passing custom dimensions
      const ptToMm = 25.4 / 72;
      targetFormat = [width * ptToMm, height * ptToMm];
    }
  }

  const doc = new jsPDF({
    orientation: targetOrientation,
    unit: 'mm',
    format: targetFormat,
  });

  if (unicodeFonts) {
    doc.addFileToVFS('DejaVuSans.ttf', unicodeFonts.regularBase64);
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
    doc.addFileToVFS('DejaVuSans-Bold.ttf', unicodeFonts.boldBase64);
    doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
  }

  const activeFont = hasUnicodeFont ? 'DejaVuSans' : 'helvetica';
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const leftMargin = 10;
  const rightMargin = 10;
  const usableWidth = pageWidth - leftMargin - rightMargin;

  // Render Logo / Seal if available
  const logoBytes = await dataUrlToPngBytes(settings.appLogoDataUrl);
  let headerTopY = 11;
  if (logoBytes && !officialPdfDoc) {
    try {
      const b64Logo = `data:image/png;base64,${uint8ToBase64(logoBytes)}`;
      doc.addImage(b64Logo, 'PNG', leftMargin + 2, 7.5, 13, 13);
    } catch {
      // ignore invalid image decoding
    }
  }

  if (!officialPdfDoc) {
    // Official LGU Header
    doc.setFont(activeFont, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      normalizeText(
        `REPUBLIC OF THE PHILIPPINES  ·  ${settings.provinceName.toUpperCase()}  ·  ${settings.municipalityName.toUpperCase()}`
      ),
      pageWidth / 2,
      headerTopY,
      { align: 'center' }
    );

    doc.setFont(activeFont, 'bold');
    doc.setFontSize(targetOrientation === 'portrait' ? 11.5 : 13);
    doc.setTextColor(15, 41, 74);
    doc.text(def.title.toUpperCase(), pageWidth / 2, headerTopY + 6, { align: 'center' });

    doc.setFont(activeFont, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const subline =
      reportType === 'monthly_accomplishment'
        ? `${settings.officeTitle}  |  ${formatFiscalYearDisplay(fiscalYear)}  |  Month: ${monthObj.label}  |  ${formatPhDate()}`
        : `${settings.officeTitle}  |  ${formatFiscalYearDisplay(fiscalYear)}  |  Generated: ${formatPhDate()}`;
    doc.text(normalizeText(subline), pageWidth / 2, headerTopY + 11.5, { align: 'center' });
  } else {
    doc.setFont(activeFont, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 41, 74);
    doc.text(
      normalizeText(`${def.title} — ${formatFiscalYearDisplay(fiscalYear)} (System Data Schedule)`),
      leftMargin,
      12
    );
  }

  const summaryStartY = officialPdfDoc ? 16 : 27;

  // Executive Summary Strip Table
  autoTable(doc, {
    startY: summaryStartY,
    head: [
      [
        'Programs',
        'Activities',
        'Approved Budget',
        'Revised Budget',
        'Expenditure',
        'Remaining Budget',
        'Physical %',
        'Financial %',
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
      font: activeFont,
      fontSize: targetOrientation === 'portrait' ? 6.5 : 7.5,
      cellPadding: 1.6,
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
    margin: { left: leftMargin, right: rightMargin },
  });

  let summaryEndY =
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 40) + 4;

  if (reportType === 'gad_compliance') {
    const gad = computeGadComplianceSummary(programs, filteredActivities);
    autoTable(doc, {
      startY: summaryEndY,
      head: [
        [
          'Total LGU Approved Budget',
          'Mandatory 5% Floor',
          'GAD Attribution (Approved)',
          'GAD Share %',
          '5% Variance',
          'Compliance Status',
        ],
      ],
      body: [
        [
          pdfMoney(gad.totalBudgetApproved),
          pdfMoney(gad.mandatoryFivePctTarget),
          pdfMoney(gad.gadApprovedBudget),
          formatPct(gad.gadShareApprovedPct),
          `${gad.varianceFromTarget >= 0 ? '+' : ''}${pdfMoney(gad.varianceFromTarget)}`,
          gad.isCompliant ? 'COMPLIANT (>= 5.00%)' : 'BELOW 5.00% TARGET',
        ],
      ],
      styles: {
        font: activeFont,
        fontSize: targetOrientation === 'portrait' ? 6.5 : 7.5,
        cellPadding: 1.5,
        halign: 'center',
        lineColor: [203, 213, 225],
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [13, 148, 136],
        textColor: 255,
        fontStyle: 'bold',
      },
      bodyStyles: {
        fillColor: gad.isCompliant ? [236, 253, 245] : [255, 251, 235],
        fontStyle: 'bold',
        textColor: [15, 23, 42],
      },
      margin: { left: leftMargin, right: rightMargin },
    });
    summaryEndY =
      ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ??
        summaryEndY + 14) + 4;
  }

  const bodyRows =
    tableData.rows.length > 0
      ? tableData.rows.map((r) => r.map(normalizeText))
      : [
          [
            normalizeText(tableData.emptyMessage || 'No matching records.'),
            ...Array(Math.max(0, tableData.headers.length - 1)).fill(''),
          ],
        ];

  const baseFontSize =
    targetOrientation === 'portrait'
      ? tableData.headers.length > 9
        ? 5.6
        : 6.5
      : tableData.headers.length > 10
        ? 6.5
        : 7.4;

  const colStyles = buildColumnWidths(tableData.headers, tableData.alignments, usableWidth);

  autoTable(doc, {
    startY: summaryEndY,
    head: [tableData.headers.map(normalizeText)],
    body: bodyRows,
    foot: [tableData.foot.map(normalizeText)],
    showFoot: 'lastPage',
    styles: {
      font: activeFont,
      fontSize: baseFontSize,
      cellPadding:
        targetOrientation === 'portrait'
          ? { top: 1.1, bottom: 1.1, left: 0.7, right: 0.7 }
          : { top: 1.4, bottom: 1.4, left: 1.1, right: 1.1 },
      lineColor: [203, 213, 225],
      lineWidth: 0.1,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: [15, 41, 74],
      textColor: 255,
      fontStyle: 'bold',
      valign: 'middle',
    },
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 41, 74],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: colStyles,
    margin: { left: leftMargin, right: rightMargin, bottom: 16 },
  });

  // Signatory block with automatic page break check
  let sigY =
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 150) + 11;
  if (sigY > pageHeight - 32) {
    doc.addPage();
    sigY = 22;
  }

  const col1X = leftMargin + 4;
  const col2X = pageWidth / 2 - 25;
  const col3X = pageWidth - rightMargin - 65;

  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);

  doc.setFont(activeFont, 'normal');
  doc.text('Prepared by:', col1X, sigY);
  doc.setFont(activeFont, 'bold');
  doc.text(normalizeText(settings.preparedByName || ''), col1X, sigY + 9);
  doc.setFont(activeFont, 'normal');
  doc.text(normalizeText(settings.preparedByTitle || ''), col1X, sigY + 13.5);

  doc.text('Reviewed by:', col2X, sigY);
  doc.setFont(activeFont, 'bold');
  doc.text(normalizeText(settings.reviewedByName || ''), col2X, sigY + 9);
  doc.setFont(activeFont, 'normal');
  doc.text(normalizeText(settings.reviewedByTitle || ''), col2X, sigY + 13.5);

  doc.text('Approved by:', col3X, sigY);
  doc.setFont(activeFont, 'bold');
  doc.text(normalizeText(settings.approvedByName || ''), col3X, sigY + 9);
  doc.setFont(activeFont, 'normal');
  doc.text(normalizeText(settings.approvedByTitle || ''), col3X, sigY + 13.5);

  const fileName = `LGU_Bula_${reportType}_FY${fiscalYear}.pdf`;

  if (officialPdfDoc) {
    // 1) Populate AcroForm fields in official template if present
    const ctx = buildTemplatePlaceholderContext({
      reportType,
      fiscalYear,
      monthKey,
      programs,
      activities,
      settings,
    });
    officialPdfDoc.registerFontkit(fontkit);
    const pdfLibFont = unicodeFonts
      ? await officialPdfDoc.embedFont(unicodeFonts.regularBytes)
      : await officialPdfDoc.embedFont(StandardFonts.Helvetica);

    try {
      const form = officialPdfDoc.getForm();
      const fields = form.getFields();
      for (const field of fields) {
        const fname = field.getName();
        const keyLower = fname.toLowerCase().replace(/[^a-z0-9]/g, '');
        let valueToFill: string | undefined;

        for (const [ctxKey, ctxVal] of Object.entries(ctx)) {
          if (typeof ctxVal === 'string' || typeof ctxVal === 'number') {
            if (ctxKey.toLowerCase() === keyLower) {
              valueToFill = String(ctxVal);
              break;
            }
          }
        }
        // Support indexed row fields like ref_1, description_1, approved_1, status_1
        if (valueToFill === undefined) {
          const idxMatch = /^([a-z]+)[_-]?(\d+)$/i.exec(fname);
          if (idxMatch) {
            const propKey = idxMatch[1].toLowerCase();
            const rowIdx = Number(idxMatch[2]) - 1;
            const rec = ctx.records[rowIdx];
            if (rec) {
              if (propKey.includes('ref')) valueToFill = rec.referenceNumber;
              else if (propKey.includes('desc')) valueToFill = rec.description;
              else if (propKey.includes('office')) valueToFill = rec.officeName;
              else if (propKey.includes('approv')) valueToFill = rec.approvedBudget;
              else if (propKey.includes('revis')) valueToFill = rec.revisedBudget;
              else if (propKey.includes('exp')) valueToFill = rec.expenditure;
              else if (propKey.includes('rem')) valueToFill = rec.remainingBudget;
              else if (propKey.includes('stat')) valueToFill = rec.status;
              else if (propKey.includes('remar')) valueToFill = rec.remarks;
            }
          }
        }

        if (valueToFill !== undefined) {
          try {
            const textField = form.getTextField(fname);
            textField.setText(unicodeFonts ? valueToFill : valueToFill.replace(/₱/g, 'PHP '));
            textField.updateAppearances(pdfLibFont);
          } catch {
            // ignore non-text AcroForm fields (e.g., checkboxes/signatures left blank)
          }
        }
      }
    } catch {
      // No AcroForm dictionary or read-only flat PDF
    }

    // 2) Merge jsPDF generated schedule pages after the official template pages
    const generatedBuf = doc.output('arraybuffer');
    const generatedDoc = await PDFDocument.load(generatedBuf);
    const copiedPages = await officialPdfDoc.copyPages(generatedDoc, generatedDoc.getPageIndices());
    for (const cp of copiedPages) {
      officialPdfDoc.addPage(cp);
    }

    // 3) Stamp unified Page X of Y footer across all pages
    const allPages = officialPdfDoc.getPages();
    const totalPages = allPages.length;
    allPages.forEach((p, idx) => {
      const { width } = p.getSize();
      const footerText = normalizeText(
        `${settings.appName || 'LGU Bula PPA Monitoring System'} · ${def.title} · Page ${idx + 1} of ${totalPages}`
      );
      const textWidth = pdfLibFont.widthOfTextAtSize(footerText, 7.5);
      p.drawText(footerText, {
        x: Math.max(18, (width - textWidth) / 2),
        y: 12,
        size: 7.5,
        font: pdfLibFont,
        color: rgb(0.39, 0.45, 0.55),
      });
    });

    const finalBytes = await officialPdfDoc.save();
    return { bytes: finalBytes, fileName, pageCount: totalPages };
  }

  // Standard PDF: Page numbering footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont(activeFont, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      normalizeText(
        `${settings.appName || 'LGU Bula PPA Monitoring System'} · ${def.title} · Page ${p} of ${totalPages}`
      ),
      pageWidth / 2,
      pageHeight - 7,
      { align: 'center' }
    );
  }

  const outBytes = new Uint8Array(doc.output('arraybuffer'));
  return { bytes: outBytes, fileName, pageCount: totalPages };
}

export async function exportReportToPDF(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
  paperSize?: PaperSize;
  orientation?: PageOrientation;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
}): Promise<string> {
  const { bytes, fileName } = await generateReportPDFBytes(options);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/pdf',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
