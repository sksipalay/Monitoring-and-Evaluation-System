import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageOrientation as DocxPageOrientation,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
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
  formatPHP,
  formatPct,
} from './calculations';
import {
  TemplateContextRow,
  buildReportTableData,
  buildTemplatePlaceholderContext,
  dataUrlToPngBytes,
  filterActivitiesForReport,
  formatFiscalYearDisplay,
  formatPhDate,
} from './templateEngine';

// Page dimensions in twips (1440 twips = 1 inch, 56.6929 twips = 1 mm)
function getPageSizeTwips(paperSize: PaperSize, orientation: PageOrientation) {
  const dims: Record<PaperSize, { w: number; h: number }> = {
    a4: { w: 11906, h: 16838 }, // 210mm x 297mm
    letter: { w: 12240, h: 15840 }, // 8.5in x 11in
    legal: { w: 12240, h: 20160 }, // 8.5in x 14in
  };
  const base = dims[paperSize] || dims.a4;
  return orientation === 'landscape'
    ? { width: base.h, height: base.w, orientation: DocxPageOrientation.LANDSCAPE }
    : { width: base.w, height: base.h, orientation: DocxPageOrientation.PORTRAIT };
}

function xmlEscape(val: string): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripXmlTags(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function mapHeaderToRowField(
  headerText: string,
  row: TemplateContextRow
): string | null {
  const h = headerText.toLowerCase().trim();
  if (!h) return null;
  if (h === '#' || h === 'no.' || h === 'no' || h.includes('item')) return String(row.index);
  if (h.includes('aip') || h.includes('ref')) return row.referenceNumber;
  if (h.includes('program') && !h.includes('description') && !h.includes('ppa')) {
    return row.programTitle || row.description;
  }
  if (h.includes('description') || h.includes('activity') || h === 'ppa' || h.includes('project')) {
    return row.description;
  }
  if (h.includes('output')) return row.targetOutputs;
  if (h.includes('office') || h.includes('implementing') || h.includes('unit')) return row.officeName;
  if (h.includes('source') || h.includes('fund')) return row.sourceOfFund;
  if (h === 'gf' || h.includes('general fund')) return row.gf;
  if (h === 'ps' || h.includes('personal service')) return row.ps;
  if (h === 'mooe' || h.includes('maintenance')) return row.mooe;
  if (h === 'co' || h.includes('capital')) return row.co;
  if (h.includes('approved')) return row.approvedBudget;
  if (h.includes('revised')) return row.revisedBudget;
  if (h.includes('expenditure') || h.includes('utilized') || h.includes('disbursement')) {
    return row.expenditure;
  }
  if (h.includes('remaining') || h.includes('balance') || h.includes('unutilized')) {
    return row.remainingBudget;
  }
  if (h.includes('phys') && h.includes('target')) return row.physicalTarget;
  if (h.includes('phys') && h.includes('actual')) return row.physicalActual;
  if (h.includes('phys') && (h.includes('%') || h.includes('rate') || h.includes('accomp'))) {
    return row.physicalPct;
  }
  if (h.includes('fin') && h.includes('target')) return row.financialTarget;
  if (h.includes('fin') && h.includes('actual')) return row.financialActual;
  if (h.includes('fin') && (h.includes('%') || h.includes('rate') || h.includes('accomp'))) {
    return row.financialPct;
  }
  if (h.includes('util')) return row.utilizationPct;
  if (h.includes('status')) return row.status;
  if (h.includes('remark') || h.includes('note')) return row.remarks;
  return null;
}

function setCellTextPreservingStyle(cellXml: string, newText: string): string {
  const escaped = xmlEscape(newText);
  // Extract first run properties <w:rPr>...</w:rPr> and paragraph properties <w:pPr>...</w:pPr> if present
  const tcPrMatch = /<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(cellXml);
  const pPrMatch = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(cellXml);
  const rPrMatch = /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(cellXml);

  const tcPr = tcPrMatch ? tcPrMatch[0] : '';
  const pPr = pPrMatch ? pPrMatch[0] : '';
  const rPr = rPrMatch ? rPrMatch[0] : '';

  return `<w:tc>${tcPr}<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r></w:p></w:tc>`;
}

function buildFallbackOoxmlTable(
  headers: string[],
  alignments: ('left' | 'right' | 'center')[],
  rows: string[][],
  foot: string[]
): string {
  const makeRow = (cells: string[], isHeader: boolean, isFoot: boolean) => {
    const bgFill = isHeader ? '163A5F' : isFoot ? 'E2E8F0' : 'FFFFFF';
    const textColor = isHeader ? 'FFFFFF' : '0F172A';
    const boldTag = isHeader || isFoot ? '<w:b/>' : '';
    const trPr = isHeader ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>';
    const cellXmls = cells.map((val, idx) => {
      const align = alignments[idx] || 'left';
      const jc = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
      return `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${bgFill}"/><w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr><w:r><w:rPr>${boldTag}<w:color w:val="${textColor}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t xml:space="preserve">${xmlEscape(val)}</w:t></w:r></w:p></w:tc>`;
    });
    return `<w:tr>${trPr}${cellXmls.join('')}</w:tr>`;
  };

  const borders =
    '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders>';

  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}</w:tblPr>${makeRow(
    headers,
    true,
    false
  )}${rows.map((r) => makeRow(r, false, false)).join('')}${makeRow(
    foot,
    false,
    true
  )}</w:tbl>`;
}

export async function populateOfficialDocxTemplate(options: {
  templateBuffer: ArrayBuffer | Uint8Array;
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
}): Promise<Uint8Array> {
  const { templateBuffer, reportType, fiscalYear, monthKey, programs, activities, settings } =
    options;
  const bytes =
    templateBuffer instanceof Uint8Array ? templateBuffer : new Uint8Array(templateBuffer);
  const zip = new PizZip(bytes);

  const ctx = buildTemplatePlaceholderContext({
    reportType,
    fiscalYear,
    monthKey,
    programs,
    activities,
    settings,
  });

  const docXmlBefore = zip.file('word/document.xml')?.asText() || '';
  const usesDoubleBraces = docXmlBefore.includes('{{');
  const hasLoopTag =
    /\{#(?:records|activities|rows)\}/.test(docXmlBefore) ||
    /\{\{#(?:records|activities|rows)\}\}/.test(docXmlBefore);

  // Step 1: Run docxtemplater if template contains tags (supports both {{tag}} and {tag})
  try {
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: usesDoubleBraces ? { start: '{{', end: '}}' } : { start: '{', end: '}' },
      nullGetter: () => '',
    });
    doc.render(ctx);
  } catch {
    // If docxtemplater encounters malformed partial tags inside raw official Word XML, fall back safely to string token replacement
    const xmlFiles = Object.keys(zip.files).filter(
      (name) =>
        name === 'word/document.xml' ||
        /^word\/header\d*\.xml$/.test(name) ||
        /^word\/footer\d*\.xml$/.test(name)
    );
    for (const fName of xmlFiles) {
      let xml = zip.file(fName)?.asText();
      if (!xml) continue;
      for (const [k, v] of Object.entries(ctx)) {
        if (typeof v === 'string' || typeof v === 'number') {
          const safeVal = xmlEscape(String(v));
          xml = xml
            .replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), safeVal)
            .replace(new RegExp(`\\{\\s*${k}\\s*\\}`, 'g'), safeVal);
        }
      }
      zip.file(fName, xml);
    }
  }

  // Step 2: If there was no explicit {#records} loop tag, populate the matching official table (or append structured table)
  if (!hasLoopTag) {
    let docXml = zip.file('word/document.xml')?.asText() || '';
    const tblRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
    let tablePopulated = false;

    const updatedDocXml = docXml.replace(tblRegex, (tblXml) => {
      if (tablePopulated) return tblXml;
      const rows = tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g);
      if (!rows || rows.length < 2) return tblXml;

      // Skip signatory-only tables (Prepared by / Reviewed by / Approved by)
      const fullTblText = stripXmlTags(tblXml).toLowerCase();
      if (
        fullTblText.includes('prepared by') &&
        fullTblText.includes('approved by') &&
        !fullTblText.includes('description') &&
        !fullTblText.includes('ref')
      ) {
        return tblXml;
      }

      const headerRowXml = rows[0];
      const headerCells = headerRowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
      if (headerCells.length < 3) return tblXml;
      const headerTexts = headerCells.map(stripXmlTags);

      // Verify at least 2 column headers map to PPA data fields
      const mappedCount =
        ctx.records.length > 0
          ? headerTexts.filter((h) => mapHeaderToRowField(h, ctx.records[0]) !== null).length
          : headerTexts.filter((h) => {
              const low = h.toLowerCase();
              return (
                low.includes('ref') ||
                low.includes('desc') ||
                low.includes('office') ||
                low.includes('budget') ||
                low.includes('status')
              );
            }).length;

      if (mappedCount < 2) return tblXml;

      // Identify template data row (row 1) and check if last row is a TOTAL row
      const templateRowXml = rows[1];
      const templateCells = templateRowXml.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
      const lastRowXml = rows[rows.length - 1];
      const lastRowText = stripXmlTags(lastRowXml).toLowerCase();
      const hasTotalFooter = rows.length >= 3 && lastRowText.includes('total');

      const populatedRowsXml = ctx.records.map((rec) => {
        const clonedCells = templateCells.map((cellXml, colIdx) => {
          const headerName = headerTexts[colIdx] || '';
          const mapped = mapHeaderToRowField(headerName, rec);
          if (mapped === null) return setCellTextPreservingStyle(cellXml, '');
          return setCellTextPreservingStyle(cellXml, mapped);
        });
        return templateRowXml.replace(
          /<w:tc\b[\s\S]*?<\/w:tc>(?=[\s\S]*<\/w:tr>)/,
          () => '__CELLS_PLACEHOLDER__'
        ) && (() => {
          // Rebuild <w:tr> keeping <w:trPr>
          const trPrMatch = /<w:trPr\b[\s\S]*?<\/w:trPr>/.exec(templateRowXml);
          return `<w:tr>${trPrMatch ? trPrMatch[0] : ''}${clonedCells.join('')}</w:tr>`;
        })();
      });

      const rebuiltRows = [
        headerRowXml,
        ...(populatedRowsXml.length > 0 ? populatedRowsXml : [templateRowXml]),
        ...(hasTotalFooter ? [lastRowXml] : []),
      ];

      tablePopulated = true;
      const tblPrMatch = /^<w:tbl\b[^>]*>([\s\S]*?)<w:tr\b/.exec(tblXml);
      const tblPrefix = tblPrMatch ? tblXml.slice(0, tblXml.indexOf('<w:tr')) : '<w:tbl>';
      return `${tblPrefix}${rebuiltRows.join('')}</w:tbl>`;
    });

    if (tablePopulated) {
      docXml = updatedDocXml;
    } else {
      // Official letterhead/cover template with no existing data table: insert canonical report table before <w:sectPr>
      const table = buildReportTableData({
        reportType,
        fiscalYear,
        monthKey,
        programs,
        activities,
      });
      const ooxmlTable = buildFallbackOoxmlTable(
        table.headers,
        table.alignments,
        table.rows,
        table.foot
      );
      if (docXml.includes('<w:sectPr')) {
        docXml = docXml.replace(
          /<w:sectPr\b/,
          `<w:p><w:r><w:t></w:t></w:r></w:p>${ooxmlTable}<w:p><w:r><w:t></w:t></w:r></w:p><w:sectPr`
        );
      } else if (docXml.includes('</w:body>')) {
        docXml = docXml.replace('</w:body>', `${ooxmlTable}</w:body>`);
      }
    }

    zip.file('word/document.xml', docXml);
  }

  return zip.generate({
    type: 'uint8array',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export async function generateStandardDocxReport(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
  paperSize?: PaperSize;
  orientation?: PageOrientation;
}): Promise<Uint8Array> {
  const {
    reportType,
    fiscalYear,
    monthKey,
    programs,
    activities,
    settings,
    paperSize = 'a4',
    orientation = 'landscape',
  } = options;

  const filteredActivities = filterActivitiesForReport(reportType, activities);
  const summary = computeDashboardSummary(programs, filteredActivities);
  const table = buildReportTableData({
    reportType,
    fiscalYear,
    monthKey,
    programs,
    activities,
  });
  const monthObj = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];
  const logoBytes = await dataUrlToPngBytes(settings.appLogoDataUrl);
  const pageSizeConfig = getPageSizeTwips(paperSize, orientation);

  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: 'CBD5E1',
  };
  const cellBorders = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  // Header Logo + Official LGU Title Block
  const headerChildren: Paragraph[] = [];
  if (logoBytes) {
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new ImageRun({
            type: 'png',
            data: logoBytes,
            transformation: { width: 46, height: 46 },
          }),
        ],
      })
    );
  }

  headerChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [
        new TextRun({
          text: `REPUBLIC OF THE PHILIPPINES  ·  ${settings.provinceName.toUpperCase()}  ·  ${settings.municipalityName.toUpperCase()}`,
          size: 18,
          color: '475569',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: table.title.toUpperCase(),
          bold: true,
          size: 26,
          color: '0F294A',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 140 },
      children: [
        new TextRun({
          text:
            reportType === 'monthly_accomplishment'
              ? `${settings.officeTitle}  |  Fiscal Year: ${formatFiscalYearDisplay(fiscalYear)}  |  Monitoring Month: ${monthObj.label}  |  Generated: ${formatPhDate()}`
              : `${settings.officeTitle}  |  Fiscal Year: ${formatFiscalYearDisplay(fiscalYear)}  |  Generated: ${formatPhDate()}`,
          size: 18,
          color: '334155',
          font: 'Calibri',
        }),
      ],
    })
  );

  // Executive KPI Summary Table
  const kpiHeaders = [
    'Programs',
    'Activities',
    'Approved Budget',
    'Revised Budget',
    'Expenditure',
    'Remaining Budget',
    'Physical %',
    'Financial %',
  ];
  const kpiValues = [
    String(summary.totalPrograms),
    String(summary.totalActivities),
    formatPHP(summary.totalApprovedBudget),
    formatPHP(summary.totalRevisedBudget),
    formatPHP(summary.totalBudgetUtilized),
    formatPHP(summary.remainingBudget),
    formatPct(summary.overallPhysicalPct),
    formatPct(summary.overallFinancialPct),
  ];

  const kpiTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        cantSplit: true,
        children: kpiHeaders.map(
          (h) =>
            new TableCell({
              borders: cellBorders,
              shading: { fill: '1E3A5F', type: ShadingType.CLEAR, color: 'auto' },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: h, bold: true, size: 15, color: 'FFFFFF', font: 'Calibri' }),
                  ],
                }),
              ],
            })
        ),
      }),
      new TableRow({
        cantSplit: true,
        children: kpiValues.map(
          (v) =>
            new TableCell({
              borders: cellBorders,
              shading: { fill: 'F8FAFC', type: ShadingType.CLEAR, color: 'auto' },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ text: v, bold: true, size: 16, color: '0F172A', font: 'Calibri' }),
                  ],
                }),
              ],
            })
        ),
      }),
    ],
  });

  const alignMap = {
    left: AlignmentType.LEFT,
    right: AlignmentType.RIGHT,
    center: AlignmentType.CENTER,
  };

  // Main Report Table
  const dataRows =
    table.rows.length > 0
      ? table.rows.map(
          (r, rowIdx) =>
            new TableRow({
              cantSplit: true,
              children: r.map(
                (val, colIdx) =>
                  new TableCell({
                    borders: cellBorders,
                    shading: {
                      fill: rowIdx % 2 === 1 ? 'F8FAFC' : 'FFFFFF',
                      type: ShadingType.CLEAR,
                      color: 'auto',
                    },
                    children: [
                      new Paragraph({
                        alignment: alignMap[table.alignments[colIdx] || 'left'],
                        children: [
                          new TextRun({
                            text: val,
                            size: 15,
                            color: '0F172A',
                            font: 'Calibri',
                          }),
                        ],
                      }),
                    ],
                  })
              ),
            })
        )
      : [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                columnSpan: table.headers.length,
                borders: cellBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: table.emptyMessage || 'No matching records.',
                        italics: true,
                        size: 16,
                        color: '64748B',
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ];

  const mainTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: table.headers.map(
          (h, idx) =>
            new TableCell({
              borders: cellBorders,
              shading: { fill: '0F294A', type: ShadingType.CLEAR, color: 'auto' },
              children: [
                new Paragraph({
                  alignment: alignMap[table.alignments[idx] || 'left'],
                  children: [
                    new TextRun({
                      text: h,
                      bold: true,
                      size: 15,
                      color: 'FFFFFF',
                      font: 'Calibri',
                    }),
                  ],
                }),
              ],
            })
        ),
      }),
      ...dataRows,
      new TableRow({
        cantSplit: true,
        children: table.foot.map(
          (f, idx) =>
            new TableCell({
              borders: cellBorders,
              shading: { fill: 'E2E8F0', type: ShadingType.CLEAR, color: 'auto' },
              children: [
                new Paragraph({
                  alignment: alignMap[table.alignments[idx] || 'left'],
                  children: [
                    new TextRun({
                      text: f,
                      bold: true,
                      size: 15,
                      color: '0F294A',
                      font: 'Calibri',
                    }),
                  ],
                }),
              ],
            })
        ),
      }),
    ],
  });

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const sigTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          { label: 'Prepared by:', name: settings.preparedByName || '', title: settings.preparedByTitle || '' },
          { label: 'Reviewed by:', name: settings.reviewedByName || '', title: settings.reviewedByTitle || '' },
          { label: 'Approved by:', name: settings.approvedByName || '', title: settings.approvedByTitle || '' },
        ].map(
          (sig) =>
            new TableCell({
              borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
              children: [
                new Paragraph({
                  spacing: { before: 180, after: 360 },
                  children: [new TextRun({ text: sig.label, size: 17, color: '475569' })],
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: sig.name, bold: true, size: 18, color: '0F172A' }),
                  ],
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: sig.title, size: 16, color: '475569' }),
                  ],
                }),
              ],
            })
        ),
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: pageSizeConfig,
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${settings.municipalityName} · ${table.title}`,
                    size: 14,
                    color: '94A3B8',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${settings.appName || 'LGU Bula PPA Monitoring System'} · Page `,
                    size: 15,
                    color: '64748B',
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 15, color: '64748B' }),
                  new TextRun({ text: ' of ', size: 15, color: '64748B' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: '64748B' }),
                ],
              }),
            ],
          }),
        },
        children: [
          ...headerChildren,
          kpiTable,
          new Paragraph({ spacing: { before: 120, after: 80 }, children: [] }),
          mainTable,
          new Paragraph({ spacing: { before: 160, after: 60 }, children: [] }),
          sigTable,
        ],
      },
    ],
  });

  return Packer.toUint8Array(doc);
}

export async function exportReportToDOCX(options: {
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
  paperSize?: PaperSize;
  orientation?: PageOrientation;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
}): Promise<{ fileName: string; bytes: Uint8Array }> {
  const bytes = options.templateBuffer
    ? await populateOfficialDocxTemplate({
        templateBuffer: options.templateBuffer,
        reportType: options.reportType,
        fiscalYear: options.fiscalYear,
        monthKey: options.monthKey,
        programs: options.programs,
        activities: options.activities,
        settings: options.settings,
      })
    : await generateStandardDocxReport(options);

  const fileName = `LGU_Bula_${options.reportType}_FY${options.fiscalYear}.docx`;
  return { fileName, bytes };
}
