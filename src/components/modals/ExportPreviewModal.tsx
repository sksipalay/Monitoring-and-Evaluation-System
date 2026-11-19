import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  Printer,
  Table as TableIcon,
  X,
} from 'lucide-react';
import {
  ActivityComputed,
  DocumentTemplate,
  MonthKey,
  PageOrientation,
  PaperSize,
  Program,
  ReportType,
  SystemSettings,
} from '../../types/ppa';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import {
  MONTHS,
  computeGadComplianceSummary,
  formatPHP,
  formatPct,
} from '../../utils/calculations';
import {
  REPORT_DEFINITIONS,
  TEMPLATE_TARGET_LABELS,
  buildReportTableData,
  formatFiscalYearDisplay,
  formatPaperSizeLabel,
  formatPhDate,
  validateExportDataset,
} from '../../utils/templateEngine';
import { generateReportPDFBytes } from '../../utils/pdfReportService';
import { dataService } from '../../services/dataService';
import { StatusBadge } from '../ui/StatusBadge';

export type PreviewExportFormat = 'pdf' | 'xlsx' | 'docx' | 'csv' | 'print';

interface ExportPreviewModalProps {
  open: boolean;
  onClose: () => void;
  reportType: ReportType;
  fiscalYear: string;
  monthKey: MonthKey;
  programs: Program[];
  activities: ActivityComputed[];
  settings: SystemSettings;
  templates: DocumentTemplate[];
  selectedTemplateId: string;
  onSelectTemplateId: (id: string) => void;
  paperSize: PaperSize;
  onChangePaperSize: (size: PaperSize) => void;
  orientation: PageOrientation;
  onChangeOrientation: (orientation: PageOrientation) => void;
  onConfirmExport: (format: PreviewExportFormat) => Promise<void>;
  exportingFormat: PreviewExportFormat | null;
  hideReportSpecificFormats?: boolean;
}

export function ExportPreviewModal({
  open,
  onClose,
  reportType,
  fiscalYear,
  monthKey,
  programs,
  activities,
  settings,
  templates,
  selectedTemplateId,
  onSelectTemplateId,
  paperSize,
  onChangePaperSize,
  orientation,
  onChangeOrientation,
  onConfirmExport,
  exportingFormat,
  hideReportSpecificFormats = false,
}: ExportPreviewModalProps) {
  const modalRef = useModalFocusTrap<HTMLDivElement>(open, onClose);
  const [previewMode, setPreviewMode] = useState<'formatted' | 'pdf'>('formatted');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [loadingPdfPreview, setLoadingPdfPreview] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const eligibleTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          t.isActive &&
          (t.targetReport === reportType ||
            t.targetReport === 'all_reports' ||
            (t.targetReport === 'excel_monitoring' && t.format === 'xlsx'))
      ),
    [templates, reportType]
  );

  const activeReport = useMemo(
    () => REPORT_DEFINITIONS.find((r) => r.id === reportType) || REPORT_DEFINITIONS[0],
    [reportType]
  );
  const activeMonth = useMemo(
    () => MONTHS.find((m) => m.key === monthKey) || MONTHS[0],
    [monthKey]
  );

  const tableData = useMemo(
    () =>
      buildReportTableData({
        reportType,
        fiscalYear,
        monthKey,
        programs,
        activities,
      }),
    [reportType, fiscalYear, monthKey, programs, activities]
  );

  const validation = useMemo(
    () =>
      validateExportDataset({
        reportType,
        fiscalYear,
        programs,
        activities,
        paperSize,
        orientation,
        selectedTemplate,
      }),
    [reportType, fiscalYear, programs, activities, paperSize, orientation, selectedTemplate]
  );

  const gadSummary = useMemo(
    () =>
      reportType === 'gad_compliance'
        ? computeGadComplianceSummary(programs, activities)
        : null,
    [reportType, programs, activities]
  );

  useEffect(() => {
    if (!open) {
      setPreviewMode('formatted');
      return;
    }
  }, [open]);

  // Generate Live PDF preview blob when user switches to 'pdf' preview tab
  useEffect(() => {
    if (!open || previewMode !== 'pdf') return;
    let cancelled = false;
    let createdUrl: string | null = null;

    const run = async () => {
      setLoadingPdfPreview(true);
      setPdfPreviewError(null);
      try {
        let tplBuf: ArrayBuffer | null = null;
        if (selectedTemplate && selectedTemplate.format === 'pdf') {
          tplBuf = await dataService.fetchTemplateBinary(selectedTemplate.id);
        }
        const { bytes, pageCount } = await generateReportPDFBytes({
          reportType,
          fiscalYear,
          monthKey,
          programs,
          activities,
          settings,
          paperSize,
          orientation,
          templateBuffer: tplBuf,
        });
        if (cancelled) return;
        const blob = new Blob(
          [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
          { type: 'application/pdf' }
        );
        createdUrl = URL.createObjectURL(blob);
        setPdfPreviewUrl(createdUrl);
        setPdfPageCount(pageCount);
      } catch (err) {
        if (!cancelled) {
          setPdfPreviewError(
            err instanceof Error ? err.message : 'Unable to generate PDF preview.'
          );
        }
      } finally {
        if (!cancelled) setLoadingPdfPreview(false);
      }
    };

    run();
    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [
    open,
    previewMode,
    reportType,
    fiscalYear,
    monthKey,
    programs,
    activities,
    settings,
    paperSize,
    orientation,
    selectedTemplate,
  ]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
    };
  }, [pdfPreviewUrl]);

  if (!open) return null;

  const statusColIndex = tableData.headers.findIndex((h) => h.toLowerCase() === 'status');
  const displayPageCount = pdfPageCount ?? validation.estimatedPages;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 dark:bg-slate-950/85 backdrop-blur-[2px] p-3 sm:p-5 overflow-y-auto no-print">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-preview-title"
        className="w-full max-w-6xl max-h-[94vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-fade-in"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4 bg-slate-50/80 dark:bg-slate-900">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-[#163A5F] dark:text-sky-400 shrink-0" aria-hidden="true" />
              <h2
                id="export-preview-title"
                className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate"
              >
                Export Preview &amp; Verification — {activeReport.title}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Review layout, paper geometry, page count, totals, and validation notices before downloading or printing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            aria-label="Close export preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="preview-paper-size"
                className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
              >
                Paper Size
              </label>
              <select
                id="preview-paper-size"
                value={paperSize}
                onChange={(e) => onChangePaperSize(e.target.value as PaperSize)}
                className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
              >
                <option value="a4">A4 (210 × 297 mm)</option>
                <option value="letter">Letter (8.5" × 11")</option>
                <option value="legal">Legal (8.5" × 14")</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="preview-orientation"
                className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
              >
                Orientation
              </label>
              <select
                id="preview-orientation"
                value={orientation}
                onChange={(e) => onChangeOrientation(e.target.value as PageOrientation)}
                className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="preview-template-select"
                className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
              >
                Official Blank Template
              </label>
              <select
                id="preview-template-select"
                value={selectedTemplateId}
                onChange={(e) => onSelectTemplateId(e.target.value)}
                className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 max-w-[280px] focus:border-[#2563EB] focus:outline-none"
              >
                <option value="">System Standard Official LGU Layout</option>
                {eligibleTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.format.toUpperCase()}] {t.name} (v{t.currentVersionNumber})
                    {t.isDefault ? ' ★ Default' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5"
            role="tablist"
            aria-label="Preview view mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={previewMode === 'formatted'}
              onClick={() => setPreviewMode('formatted')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                previewMode === 'formatted'
                  ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Formatted Document</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={previewMode === 'pdf'}
              onClick={() => setPreviewMode('pdf')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                previewMode === 'pdf'
                  ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Live PDF Render</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-100/80 dark:bg-slate-950/60">
          {/* Validation & Data Summary Strip */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <span>
                  <span className="text-slate-500 dark:text-slate-400">Records:</span>{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {validation.recordCount}
                  </strong>
                </span>
                <span>
                  <span className="text-slate-500 dark:text-slate-400">Approved:</span>{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {formatPHP(validation.totalApprovedBudget)}
                  </strong>
                </span>
                <span>
                  <span className="text-slate-500 dark:text-slate-400">Revised:</span>{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {formatPHP(validation.totalRevisedBudget)}
                  </strong>
                </span>
                <span>
                  <span className="text-slate-500 dark:text-slate-400">Expenditure:</span>{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {formatPHP(validation.totalExpenditure)}
                  </strong>
                </span>
                <span>
                  <span className="text-slate-500 dark:text-slate-400">Est. Pages:</span>{' '}
                  <strong className="font-mono text-[#163A5F] dark:text-sky-400">
                    {displayPageCount}
                  </strong>
                </span>
              </div>

              {selectedTemplate ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-2.5 py-1 text-[11px] font-semibold text-teal-800 dark:text-teal-300">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    Using Official {selectedTemplate.format.toUpperCase()} Template:{' '}
                    {selectedTemplate.name} (v{selectedTemplate.currentVersionNumber})
                  </span>
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Layout: {formatPaperSizeLabel(paperSize)} · {orientation === 'landscape' ? 'Landscape' : 'Portrait'}
                </span>
              )}
            </div>

            {selectedTemplate && (
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Assigned Scope:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {TEMPLATE_TARGET_LABELS[selectedTemplate.targetReport]}
                </strong>
                {' · '}
                Note: Official templates apply directly when exporting in their matching format (
                <span className="font-mono uppercase">.{selectedTemplate.format}</span>). Other export formats use the synchronized canonical LGU layout.
              </p>
            )}

            {validation.issues.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                {validation.issues.map((issue, idx) => (
                  <div
                    key={`${issue.code}-${idx}`}
                    className={`flex items-start gap-1.5 text-[11.5px] ${
                      issue.severity === 'warning' || issue.severity === 'error'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {issue.severity === 'warning' || issue.severity === 'error' ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                    )}
                    <span>{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview Stage */}
          {previewMode === 'pdf' ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden min-h-[480px] flex flex-col">
              {loadingPdfPreview ? (
                <div className="flex-1 flex flex-col items-center justify-center p-10 text-slate-500 dark:text-slate-400 gap-2">
                  <Loader2 className="h-7 w-7 animate-spin text-[#163A5F] dark:text-sky-400" />
                  <p className="text-xs font-medium">Rendering official PDF preview...</p>
                </div>
              ) : pdfPreviewError ? (
                <div className="flex-1 flex flex-col items-center justify-center p-10 text-red-600 dark:text-red-400 gap-2 text-center">
                  <AlertTriangle className="h-7 w-7" />
                  <p className="text-sm font-semibold">PDF Preview Error</p>
                  <p className="text-xs max-w-md">{pdfPreviewError}</p>
                </div>
              ) : pdfPreviewUrl ? (
                <iframe
                  title="Official PDF Export Preview"
                  src={pdfPreviewUrl}
                  className="w-full h-[540px] border-0 bg-slate-200 dark:bg-slate-800"
                />
              ) : null}
            </div>
          ) : (
            <div
              className={`mx-auto rounded-lg border border-slate-300 dark:border-slate-700 bg-white text-slate-900 shadow-md p-6 sm:p-8 space-y-5 transition-all ${
                orientation === 'portrait' ? 'max-w-[790px]' : 'max-w-full'
              }`}
            >
              {/* Paper Sheet Header */}
              <div className="text-center border-b border-slate-200 pb-4">
                {settings.appLogoDataUrl && (
                  <img
                    src={settings.appLogoDataUrl}
                    alt={`${settings.appName || settings.officeTitle} logo`}
                    className="mx-auto mb-2 h-12 w-12 object-contain"
                  />
                )}
                <p className="text-[11px] font-medium text-slate-600">
                  Republic of the Philippines · {settings.provinceName} · {settings.municipalityName}
                </p>
                {settings.appName && (
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                    {settings.appName}
                  </p>
                )}
                <h3 className="mt-1 text-lg font-bold text-[#163A5F]">{tableData.title}</h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  {settings.officeTitle} · {formatFiscalYearDisplay(fiscalYear)}
                  {reportType === 'monthly_accomplishment' ? ` · Month: ${activeMonth.label}` : ''} · Generated: {formatPhDate()}
                </p>
              </div>

              {gadSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <p className="text-slate-500">LGU Approved</p>
                    <p className="font-mono font-bold text-slate-900">{formatPHP(gadSummary.totalBudgetApproved)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <p className="text-slate-500">Mandatory 5%</p>
                    <p className="font-mono font-bold text-[#163A5F]">{formatPHP(gadSummary.mandatoryFivePctTarget)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <p className="text-slate-500">GAD Attribution</p>
                    <p className="font-mono font-bold text-slate-900">{formatPHP(gadSummary.gadApprovedBudget)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <p className="text-slate-500">GAD Expenditure</p>
                    <p className="font-mono font-bold text-slate-900">{formatPHP(gadSummary.gadExpenditure)}</p>
                  </div>
                  <div
                    className={`rounded-lg border p-2.5 ${
                      gadSummary.isCompliant
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <p>Compliance</p>
                    <p className="font-mono font-bold">
                      {formatPct(gadSummary.gadShareApprovedPct)} ({gadSummary.isCompliant ? 'COMPLIANT' : 'BELOW 5%'})
                    </p>
                  </div>
                </div>
              )}

              {/* Canonical Report Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#0F294A] text-white">
                      {tableData.headers.map((h, i) => (
                        <th
                          key={`${h}-${i}`}
                          className={`py-2 px-2.5 font-semibold border border-slate-700 ${
                            tableData.alignments[i] === 'right'
                              ? 'text-right'
                              : tableData.alignments[i] === 'center'
                                ? 'text-center'
                                : 'text-left'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {tableData.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={tableData.headers.length}
                          className="py-6 text-center text-slate-500 border border-slate-200"
                        >
                          {tableData.emptyMessage || 'No matching records for this report filter.'}
                        </td>
                      </tr>
                    ) : (
                      tableData.rows.map((row, rIdx) => (
                        <tr key={rIdx} className={rIdx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                          {row.map((cell, cIdx) => {
                            const align = tableData.alignments[cIdx] || 'left';
                            return (
                              <td
                                key={cIdx}
                                className={`py-1.5 px-2.5 border border-slate-200 align-top ${
                                  align === 'right'
                                    ? 'text-right font-mono tabular-nums whitespace-nowrap'
                                    : align === 'center'
                                      ? 'text-center'
                                      : 'text-left'
                                }`}
                              >
                                {cIdx === statusColIndex && cell ? (
                                  <StatusBadge
                                    status={
                                      cell as
                                        | 'COMPLETED'
                                        | 'ON-GOING'
                                        | 'PENDING'
                                        | 'NOT IMPLEMENTED'
                                    }
                                    compact
                                  />
                                ) : (
                                  cell
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-200/80 font-bold text-[#0F294A]">
                      {tableData.foot.map((f, idx) => (
                        <td
                          key={idx}
                          className={`py-2 px-2.5 border border-slate-300 ${
                            tableData.alignments[idx] === 'right'
                              ? 'text-right font-mono tabular-nums whitespace-nowrap'
                              : 'text-left'
                          }`}
                        >
                          {f}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Signatory Block */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-slate-200 text-xs">
                <div>
                  <p className="text-slate-500">Prepared by:</p>
                  <p className="mt-6 font-semibold text-slate-900">{settings.preparedByName}</p>
                  <p className="text-[11px] text-slate-600">{settings.preparedByTitle}</p>
                </div>
                <div>
                  <p className="text-slate-500">Reviewed by:</p>
                  <p className="mt-6 font-semibold text-slate-900">{settings.reviewedByName}</p>
                  <p className="text-[11px] text-slate-600">{settings.reviewedByTitle}</p>
                </div>
                <div>
                  <p className="text-slate-500">Approved by:</p>
                  <p className="mt-6 font-semibold text-slate-900">{settings.approvedByName}</p>
                  <p className="text-[11px] text-slate-600">{settings.approvedByTitle}</p>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10.5px] text-slate-500">
                <span>{settings.appName || 'LGU Bula PPA Monitoring System'}</span>
                <span>
                  {formatPaperSizeLabel(paperSize)} · {orientation === 'landscape' ? 'Landscape' : 'Portrait'} · Page 1 of {displayPageCount}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Export Actions */}
        <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Close Preview
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {!hideReportSpecificFormats && (
              <>
                <button
                  type="button"
                  disabled={Boolean(exportingFormat)}
                  onClick={() => onConfirmExport('print')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Print</span>
                </button>

                <button
                  type="button"
                  disabled={Boolean(exportingFormat)}
                  onClick={() => onConfirmExport('csv')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
                >
                  <TableIcon className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" aria-hidden="true" />
                  <span>{exportingFormat === 'csv' ? 'Exporting CSV...' : 'Download CSV'}</span>
                </button>

                <button
                  type="button"
                  disabled={Boolean(exportingFormat)}
                  onClick={() => onConfirmExport('docx')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{exportingFormat === 'docx' ? 'Generating Word...' : 'Download Word (.docx)'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              disabled={Boolean(exportingFormat)}
              onClick={() => onConfirmExport('xlsx')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{exportingFormat === 'xlsx' ? 'Exporting Excel...' : 'Download Excel (.xlsx)'}</span>
            </button>

            {!hideReportSpecificFormats && (
              <button
                type="button"
                disabled={Boolean(exportingFormat)}
                onClick={() => onConfirmExport('pdf')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60"
              >
                <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{exportingFormat === 'pdf' ? 'Generating PDF...' : 'Download PDF'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
