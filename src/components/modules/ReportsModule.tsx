import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  Printer,
  Table as TableIcon,
} from 'lucide-react';
import {
  ActivityComputed,
  DocumentTemplate,
  FiscalYear,
  ImplementationStatus,
  MonthKey,
  PageOrientation,
  PaperSize,
  Program,
  ReportType,
  SystemSettings,
} from '../../types/ppa';
import {
  MONTHS,
  STATUS_OPTIONS,
  computeGadComplianceSummary,
  formatPHP,
  formatPct,
} from '../../utils/calculations';
import { REPORT_DEFINITIONS, exportReportToPDF } from '../../utils/pdfReportService';
import { exportReportToDOCX } from '../../utils/docxReportService';
import { triggerBlobDownload } from '../../utils/excelService';
import {
  TEMPLATE_TARGET_LABELS,
  buildReportCsvContent,
  buildReportTableData,
  formatFiscalYearDisplay,
  formatPhDate,
  resolveDefaultTemplate,
  validateExportDataset,
} from '../../utils/templateEngine';
import { dataService } from '../../services/dataService';
import { StatusBadge } from '../ui/StatusBadge';
import { ExportPreviewModal, PreviewExportFormat } from '../modals/ExportPreviewModal';

export interface ReportExcelExportOptions {
  reportType?: ReportType;
  monthKey?: MonthKey;
  programFilterId?: string;
  statusFilter?: string;
  paperSize?: PaperSize;
  orientation?: PageOrientation;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
}

interface ReportsModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  fiscalYears: FiscalYear[];
  settings: SystemSettings;
  selectedFiscalYear: string;
  onExportExcel: (fiscalYear: string, options?: ReportExcelExportOptions) => Promise<void>;
  onLogReportExport: (
    reportTitle: string,
    format: 'PDF' | 'EXCEL' | 'DOCX' | 'CSV' | 'PRINT'
  ) => Promise<void>;
  onNotify?: (type: 'success' | 'error', msg: string) => void;
}

export function ReportsModule({
  programs,
  activities,
  fiscalYears,
  settings,
  selectedFiscalYear,
  onExportExcel,
  onLogReportExport,
  onNotify,
}: ReportsModuleProps) {
  const [reportType, setReportType] = useState<ReportType>('annual_ppa');
  const [fyFilter, setFyFilter] = useState<string>(
    selectedFiscalYear === 'ALL' ? 'ALL' : selectedFiscalYear
  );
  const [programFilter, setProgramFilter] = useState<string>('ALL');
  const [monthKey, setMonthKey] = useState<MonthKey>('jan');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [orientation, setOrientation] = useState<PageOrientation>('landscape');
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<PreviewExportFormat | null>(null);

  useEffect(() => {
    setFyFilter(selectedFiscalYear === 'ALL' ? 'ALL' : selectedFiscalYear);
  }, [selectedFiscalYear]);

  // Load official templates on mount
  useEffect(() => {
    let active = true;
    dataService
      .listTemplates()
      .then((res) => {
        if (!active) return;
        const list = res.templates || [];
        setTemplates(list);
        const defTpl = resolveDefaultTemplate(list, 'annual_ppa');
        if (defTpl) {
          setSelectedTemplateId(defTpl.id);
          const ps = defTpl.analysis?.paperSize;
          if (ps === 'a4' || ps === 'letter' || ps === 'legal') setPaperSize(ps);
          if (defTpl.analysis?.orientation) setOrientation(defTpl.analysis.orientation);
        }
      })
      .catch(() => {
        /* Fallback silently to standard LGU official layout when offline */
      });
    return () => {
      active = false;
    };
  }, []);

  const fyPrograms = useMemo(
    () => programs.filter((p) => fyFilter === 'ALL' || p.fiscalYear === fyFilter),
    [programs, fyFilter]
  );

  useEffect(() => {
    if (programFilter !== 'ALL' && !fyPrograms.some((p) => p.id === programFilter)) {
      setProgramFilter('ALL');
    }
  }, [fyPrograms, programFilter]);

  const programMap = useMemo(
    () => new Map(programs.map((p) => [p.id, p])),
    [programs]
  );

  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      if (fyFilter !== 'ALL' && a.fiscalYear !== fyFilter) return false;
      if (programFilter !== 'ALL' && a.programId !== programFilter) return false;
      const effStatus = programMap.get(a.programId)?.status || a.status || 'PENDING';
      if (statusFilter !== 'ALL' && effStatus !== statusFilter) return false;
      if (reportType === 'completed_activities' && effStatus !== 'COMPLETED') return false;
      if (
        reportType === 'pending_not_implemented' &&
        effStatus !== 'PENDING' &&
        effStatus !== 'NOT IMPLEMENTED'
      ) {
        return false;
      }
      return true;
    });
  }, [activities, programMap, fyFilter, programFilter, statusFilter, reportType]);

  const scopedProgramsForReport = useMemo(
    () =>
      reportType === 'gad_compliance'
        ? fyPrograms
        : fyPrograms.filter((p) => {
            if (programFilter !== 'ALL' && p.id !== programFilter) return false;
            const progStatus = p.status || 'PENDING';
            if (statusFilter !== 'ALL' && progStatus !== statusFilter) return false;
            if (reportType === 'completed_activities' && progStatus !== 'COMPLETED') return false;
            if (
              reportType === 'pending_not_implemented' &&
              progStatus !== 'PENDING' &&
              progStatus !== 'NOT IMPLEMENTED'
            ) {
              return false;
            }
            return true;
          }),
    [reportType, fyPrograms, programFilter, statusFilter]
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

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  // Sync default template when switching report type
  const handleSelectReportType = (nextType: ReportType) => {
    setReportType(nextType);
    const current = templates.find((t) => t.id === selectedTemplateId);
    const currentStillEligible =
      current &&
      current.isActive &&
      (current.targetReport === nextType ||
        current.targetReport === 'all_reports' ||
        (current.targetReport === 'excel_monitoring' && current.format === 'xlsx'));

    if (!currentStillEligible) {
      const def = resolveDefaultTemplate(templates, nextType);
      setSelectedTemplateId(def?.id || '');
      const ps = def?.analysis?.paperSize;
      if (ps === 'a4' || ps === 'letter' || ps === 'legal') setPaperSize(ps);
      if (def?.analysis?.orientation) setOrientation(def.analysis.orientation);
    }
  };

  const handleSelectTemplateId = (id: string) => {
    setSelectedTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    const ps = tpl?.analysis?.paperSize;
    if (ps === 'a4' || ps === 'letter' || ps === 'legal') setPaperSize(ps);
    if (tpl?.analysis?.orientation) setOrientation(tpl.analysis.orientation);
  };

  const activeReport = REPORT_DEFINITIONS.find((r) => r.id === reportType) || REPORT_DEFINITIONS[0];
  const activeMonth = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];

  const tableData = useMemo(
    () =>
      buildReportTableData({
        reportType,
        fiscalYear: fyFilter,
        monthKey,
        programs: scopedProgramsForReport,
        activities: filteredActivities,
      }),
    [reportType, fyFilter, monthKey, scopedProgramsForReport, filteredActivities]
  );

  const validation = useMemo(
    () =>
      validateExportDataset({
        reportType,
        fiscalYear: fyFilter,
        programs: scopedProgramsForReport,
        activities: filteredActivities,
        paperSize,
        orientation,
        selectedTemplate,
      }),
    [
      reportType,
      fyFilter,
      scopedProgramsForReport,
      filteredActivities,
      paperSize,
      orientation,
      selectedTemplate,
    ]
  );

  const gadSummary = useMemo(
    () =>
      reportType === 'gad_compliance'
        ? computeGadComplianceSummary(fyPrograms, filteredActivities)
        : null,
    [reportType, fyPrograms, filteredActivities]
  );

  const fetchMatchingTemplateBinary = async (
    expectedFormat: 'pdf' | 'xlsx' | 'docx'
  ): Promise<ArrayBuffer | null> => {
    if (!selectedTemplate) return null;
    if (selectedTemplate.format === expectedFormat) {
      return dataService.fetchTemplateBinary(selectedTemplate.id);
    }
    const fallbackSameFormat = resolveDefaultTemplate(templates, reportType, expectedFormat);
    if (fallbackSameFormat) {
      return dataService.fetchTemplateBinary(fallbackSameFormat.id);
    }
    return null;
  };

  const executeExport = async (format: PreviewExportFormat) => {
    if (format === 'print') {
      window.print();
      onLogReportExport(activeReport.title, 'PRINT').catch(() => {});
      return;
    }

    setExportingFormat(format);
    try {
      if (format === 'pdf') {
        const templateBuffer = await fetchMatchingTemplateBinary('pdf');
        const exportedName = await exportReportToPDF({
          reportType,
          fiscalYear: fyFilter,
          monthKey,
          programs: scopedProgramsForReport,
          activities: filteredActivities,
          settings,
          paperSize,
          orientation,
          templateBuffer,
        });
        await onLogReportExport(activeReport.title, 'PDF').catch(() => {});
        onNotify?.('success', `Generated PDF report: ${exportedName}`);
      } else if (format === 'xlsx') {
        const templateBuffer = await fetchMatchingTemplateBinary('xlsx');
        await onExportExcel(fyFilter, {
          reportType,
          monthKey,
          programFilterId: programFilter,
          statusFilter,
          paperSize,
          orientation,
          templateBuffer,
        });
        await onLogReportExport(activeReport.title, 'EXCEL').catch(() => {});
      } else if (format === 'docx') {
        const templateBuffer = await fetchMatchingTemplateBinary('docx');
        const { fileName, bytes } = await exportReportToDOCX({
          reportType,
          fiscalYear: fyFilter,
          monthKey,
          programs: scopedProgramsForReport,
          activities: filteredActivities,
          settings,
          paperSize,
          orientation,
          templateBuffer,
        });
        const blob = new Blob(
          [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
          {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }
        );
        triggerBlobDownload(blob, fileName);
        await onLogReportExport(activeReport.title, 'DOCX').catch(() => {});
        onNotify?.('success', `Generated Word document: ${fileName}`);
      } else if (format === 'csv') {
        const csvContent = buildReportCsvContent({
          reportType,
          fiscalYear: fyFilter,
          monthKey,
          programs: scopedProgramsForReport,
          activities: filteredActivities,
          settings,
        });
        const fileName = `LGU_Bula_${reportType}_FY${fyFilter}.csv`;
        triggerBlobDownload(
          new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
          fileName
        );
        await onLogReportExport(activeReport.title, 'CSV').catch(() => {});
        onNotify?.('success', `Exported CSV file: ${fileName}`);
      }
    } catch (err) {
      onNotify?.(
        'error',
        err instanceof Error ? err.message : `${format.toUpperCase()} export failed.`
      );
    } finally {
      setExportingFormat(null);
    }
  };

  const statusColIndex = tableData.headers.findIndex((h) => h.toLowerCase() === 'status');
  const warningIssues = validation.issues.filter((i) => i.severity === 'warning');

  return (
    <div className="space-y-5">
      {/* Dynamic Print Page Size & Orientation */}
      <style media="print">{`@page { size: ${paperSize} ${orientation}; margin: 10mm; }`}</style>

      {/* Report Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 no-print">
        {REPORT_DEFINITIONS.map((rep) => {
          const active = rep.id === reportType;
          return (
            <button
              key={rep.id}
              type="button"
              onClick={() => handleSelectReportType(rep.id)}
              className={`text-left rounded-xl border p-4 transition-all ${
                active
                  ? 'border-[#163A5F] dark:border-[#2563EB] bg-[#163A5F] dark:bg-[#2563EB] text-white shadow-sm'
                  : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/70 dark:hover:bg-slate-800/60'
              }`}
            >
              <p className="font-display text-[15px] font-semibold tracking-tight">{rep.title}</p>
              <p
                className={`mt-1.5 text-xs leading-snug ${
                  active ? 'text-blue-100 dark:text-sky-100' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {rep.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters, Page Setup, Official Template & Export Toolbar */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
              Fiscal Year
            </label>
            <select
              value={fyFilter}
              onChange={(e) => setFyFilter(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
            >
              <option value="ALL">All Years</option>
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.year}>
                  {fy.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
              Program
            </label>
            <select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm max-w-[230px] focus:border-[#2563EB] focus:outline-none transition-colors"
            >
              <option value="ALL">All Programs</option>
              {fyPrograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.aipRefCode} · {p.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
              Month
            </label>
            <select
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value as MonthKey)}
              className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
            >
              {MONTHS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
            >
              <option value="ALL">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
              Paper Size
            </label>
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSize)}
              className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="legal">Legal</option>
            </select>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
              Orientation
            </label>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as PageOrientation)}
              className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>

          <div className="min-w-[220px] flex-1">
            <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
              Official Blank Template
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleSelectTemplateId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
            >
              <option value="">Standard LGU Official Layout (System Default)</option>
              {eligibleTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (v{t.currentVersionNumber} · {t.format.toUpperCase()}
                  {t.isDefault ? ' · Default' : ''})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-800 dark:text-slate-200">{validation.recordCount}</span>{' '}
            record(s) · Est.{' '}
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
              {validation.estimatedPages}
            </span>{' '}
            page(s)
            {selectedTemplate && (
              <>
                {' '}
                · Active Template:{' '}
                <span className="font-semibold text-[#163A5F] dark:text-sky-400">
                  {selectedTemplate.name} ({selectedTemplate.format.toUpperCase()} ·{' '}
                  {TEMPLATE_TARGET_LABELS[selectedTemplate.targetReport]})
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#163A5F]/40 dark:border-sky-500/40 bg-blue-50/70 dark:bg-sky-950/40 px-3.5 py-2 text-xs font-semibold text-[#163A5F] dark:text-sky-300 hover:bg-blue-100/80 dark:hover:bg-sky-950/70 transition-colors whitespace-nowrap"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              <span>Export Preview</span>
            </button>
            <button
              type="button"
              onClick={() => executeExport('print')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span>Print</span>
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => executeExport('csv')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              <TableIcon className="h-4 w-4" aria-hidden="true" />
              <span>{exportingFormat === 'csv' ? 'Exporting...' : 'CSV'}</span>
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => executeExport('docx')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60 whitespace-nowrap"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span>{exportingFormat === 'docx' ? 'Generating...' : 'Word (.docx)'}</span>
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => executeExport('xlsx')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              <span>{exportingFormat === 'xlsx' ? 'Exporting...' : 'Excel (.xlsx)'}</span>
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => executeExport('pdf')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60 whitespace-nowrap"
            >
              <FileDown className="h-4 w-4" aria-hidden="true" />
              <span>{exportingFormat === 'pdf' ? 'Generating PDF...' : 'PDF'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Pre-Export Validation Warnings */}
      {warningIssues.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/35 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 space-y-1 no-print">
          {warningIssues.map((issue, idx) => (
            <p key={idx} className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>{issue.message}</span>
            </p>
          ))}
        </div>
      )}

      {/* Printable Official Government Report Preview */}
      <div className="print-sheet rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-6 text-slate-900 dark:text-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-center border-b border-slate-200 dark:border-slate-800 pb-4">
          {settings.appLogoDataUrl && (
            <img
              src={settings.appLogoDataUrl}
              alt={`${settings.appName || settings.officeTitle} logo`}
              className="mx-auto mb-2 h-12 w-12 object-contain rounded-lg"
            />
          )}
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Republic of the Philippines · {settings.provinceName} · {settings.municipalityName}
          </p>
          {settings.appName && (
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              {settings.appName}
            </p>
          )}
          <h3 className="mt-1 text-[20px] font-semibold text-[#163A5F] dark:text-sky-400">
            {activeReport.title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            {settings.officeTitle} · {formatFiscalYearDisplay(fyFilter)}
            {reportType === 'monthly_accomplishment' ? ` · Month: ${activeMonth.label}` : ''} ·
            Generated: {formatPhDate()}
          </p>
        </div>

        {/* GAD 5% Mandatory Compliance Scorecard */}
        {reportType === 'gad_compliance' && gadSummary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 p-3.5">
              <p className="text-slate-500 dark:text-slate-400">Total LGU Approved Budget</p>
              <p className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatPHP(gadSummary.totalBudgetApproved)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 p-3.5">
              <p className="text-slate-500 dark:text-slate-400">Mandatory 5% Target</p>
              <p className="mt-1 font-mono text-sm font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                {formatPHP(gadSummary.mandatoryFivePctTarget)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 p-3.5">
              <p className="text-slate-500 dark:text-slate-400">Total GAD Attribution</p>
              <p className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatPHP(gadSummary.gadApprovedBudget)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {gadSummary.gadProgramCount} program(s) · {gadSummary.gadActivityCount} PPA(s)
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 p-3.5">
              <p className="text-slate-500 dark:text-slate-400">GAD Expenditure / Util.</p>
              <p className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {formatPHP(gadSummary.gadExpenditure)}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {formatPct(gadSummary.gadUtilizationPct)} of GAD Revised
              </p>
            </div>
            <div
              className={`rounded-lg border p-3.5 ${
                gadSummary.isCompliant
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40'
                  : 'border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40'
              }`}
            >
              <p className="text-slate-600 dark:text-slate-300">5% Statutory Compliance</p>
              <p
                className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                  gadSummary.isCompliant
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {formatPct(gadSummary.gadShareApprovedPct)} —{' '}
                {gadSummary.isCompliant ? 'COMPLIANT' : 'BELOW 5% TARGET'}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                Variance: {gadSummary.varianceFromTarget >= 0 ? '+' : ''}
                {formatPHP(gadSummary.varianceFromTarget)}
              </p>
            </div>
          </div>
        )}

        {/* Canonical Parity Report Table (matches PDF, DOCX, Excel Summary, CSV, & Print 1:1) */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-[12px] font-semibold text-slate-800 dark:text-slate-200">
                {tableData.headers.map((header, idx) => (
                  <th
                    key={idx}
                    className={`py-2.5 px-2.5 ${
                      tableData.alignments[idx] === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {tableData.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={tableData.headers.length}
                    className="py-6 text-center text-slate-500 dark:text-slate-400"
                  >
                    {tableData.emptyMessage}
                  </td>
                </tr>
              ) : (
                tableData.rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((cell, cIdx) => {
                      const alignRight = tableData.alignments[cIdx] === 'right';
                      const isStatusCol =
                        cIdx === statusColIndex &&
                        STATUS_OPTIONS.includes(cell as ImplementationStatus);
                      return (
                        <td
                          key={cIdx}
                          className={`py-2 px-2.5 align-top ${
                            alignRight ? 'text-right font-mono tabular-nums whitespace-nowrap' : ''
                          } ${cIdx === 0 ? 'font-mono whitespace-nowrap' : ''} ${
                            cIdx === 1 ? 'font-medium' : ''
                          }`}
                        >
                          {isStatusCol ? (
                            <StatusBadge status={cell as ImplementationStatus} compact />
                          ) : (
                            cell || <span className="text-slate-400">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
            {tableData.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/80 font-semibold text-slate-900 dark:text-slate-100">
                  {tableData.foot.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`py-2.5 px-2.5 ${
                        tableData.alignments[cIdx] === 'right'
                          ? 'text-right font-mono tabular-nums whitespace-nowrap'
                          : 'text-left'
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Signatory Block */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-slate-200 dark:border-slate-800 text-[13px] print-avoid-break">
          <div>
            <p className="text-slate-500 dark:text-slate-400">Prepared by:</p>
            <p className="mt-6 font-semibold text-slate-900 dark:text-slate-100">
              {settings.preparedByName}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {settings.preparedByTitle}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Reviewed by:</p>
            <p className="mt-6 font-semibold text-slate-900 dark:text-slate-100">
              {settings.reviewedByName}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {settings.reviewedByTitle}
            </p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Approved by:</p>
            <p className="mt-6 font-semibold text-slate-900 dark:text-slate-100">
              {settings.approvedByName}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {settings.approvedByTitle}
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Export Preview Modal */}
      <ExportPreviewModal
        open={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        reportType={reportType}
        fiscalYear={fyFilter}
        monthKey={monthKey}
        programs={scopedProgramsForReport}
        activities={filteredActivities}
        settings={settings}
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplateId={handleSelectTemplateId}
        paperSize={paperSize}
        onChangePaperSize={setPaperSize}
        orientation={orientation}
        onChangeOrientation={setOrientation}
        onConfirmExport={async (fmt) => {
          await executeExport(fmt);
          setPreviewModalOpen(false);
        }}
        exportingFormat={exportingFormat}
      />
    </div>
  );
}
