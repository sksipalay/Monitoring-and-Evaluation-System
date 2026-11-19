import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  Activity,
  DocumentTemplate,
  FiscalYear,
  Office,
  PageOrientation,
  PaperSize,
  Program,
  SystemSettings,
  UploadedDocument,
  UserAccount,
} from '../../types/ppa';
import {
  ExcelParseResult,
  buildValidationErrorCsvBlob,
  exportMonitoringWorkbook,
  materializeImportedRecords,
  parseMonitoringWorkbook,
  triggerBlobDownload,
} from '../../utils/excelService';
import {
  computeActivityMetrics,
  computeDashboardSummary,
  formatPHP,
} from '../../utils/calculations';
import { resolveDefaultTemplate } from '../../utils/templateEngine';
import { dataService } from '../../services/dataService';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ExportPreviewModal, PreviewExportFormat } from '../modals/ExportPreviewModal';
import { isAdminRole } from '../../utils/rbac';

interface ExcelImportExportModuleProps {
  programs: Program[];
  activities: Activity[];
  offices: Office[];
  fiscalYears: FiscalYear[];
  uploadedDocuments: UploadedDocument[];
  selectedFiscalYear: string;
  municipalityName: string;
  settings?: SystemSettings;
  currentUser: UserAccount;
  onCommitImport: (payload: {
    newPrograms: Program[];
    newActivities: Activity[];
    updatedActivities: Activity[];
    newOffices: Office[];
    uploadedDocument: UploadedDocument;
  }) => Promise<void>;
  onLogExport: (fileName: string) => Promise<void>;
  onNotify: (type: 'success' | 'error', msg: string) => void;
}

export function ExcelImportExportModule({
  programs,
  activities,
  offices,
  fiscalYears,
  uploadedDocuments,
  selectedFiscalYear,
  municipalityName,
  settings,
  currentUser,
  onCommitImport,
  onLogExport,
  onNotify,
}: ExcelImportExportModuleProps) {
  const canImport = isAdminRole(currentUser.role);
  const defaultFy =
    selectedFiscalYear === 'ALL' ? fiscalYears[0]?.year || '2026' : selectedFiscalYear;

  const [importFy, setImportFy] = useState<string>(defaultFy);
  const [exportFy, setExportFy] = useState<string>(defaultFy);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ExcelParseResult | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update' | 'create'>('skip');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [paperSize, setPaperSize] = useState<PaperSize>('a4');
  const [orientation, setOrientation] = useState<PageOrientation>('landscape');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  useEffect(() => {
    const nextFy =
      selectedFiscalYear === 'ALL' ? fiscalYears[0]?.year || '2026' : selectedFiscalYear;
    setImportFy(nextFy);
    setExportFy(nextFy);
  }, [selectedFiscalYear, fiscalYears]);

  useEffect(() => {
    let active = true;
    dataService
      .listTemplates()
      .then((res) => {
        if (!active) return;
        const xlsxTemplates = (res.templates || []).filter(
          (t) =>
            t.isActive &&
            t.format === 'xlsx' &&
            (t.targetReport === 'excel_monitoring' || t.targetReport === 'all_reports')
        );
        setTemplates(xlsxTemplates);
        const defTpl = resolveDefaultTemplate(xlsxTemplates, 'excel_monitoring', 'xlsx');
        if (defTpl) {
          setSelectedTemplateId(defTpl.id);
          const ps = defTpl.analysis?.paperSize;
          if (ps === 'a4' || ps === 'letter' || ps === 'legal') setPaperSize(ps);
          if (defTpl.analysis?.orientation) setOrientation(defTpl.analysis.orientation);
        }
      })
      .catch(() => {
        /* Fallback silently when offline */
      });
    return () => {
      active = false;
    };
  }, []);

  const effectiveSettings: SystemSettings = useMemo(
    () =>
      settings || {
        municipalityName,
        provinceName: 'Province of Camarines Sur',
        officeTitle: 'Municipal Planning and Development Office (MPDO)',
        defaultFiscalYear: exportFy === 'ALL' ? '2026' : exportFy,
        preparedByName: currentUser.displayName,
        preparedByTitle: 'Planning Officer',
        reviewedByName: '',
        reviewedByTitle: '',
        approvedByName: '',
        approvedByTitle: '',
        firebaseWebConfigJson: '',
      },
    [settings, municipalityName, exportFy, currentUser]
  );

  const exportPrograms = useMemo(
    () => programs.filter((p) => exportFy === 'ALL' || p.fiscalYear === exportFy),
    [programs, exportFy]
  );

  const exportComputedActivities = useMemo(
    () =>
      activities
        .filter((a) => exportFy === 'ALL' || a.fiscalYear === exportFy)
        .map(computeActivityMetrics),
    [activities, exportFy]
  );

  const exportSummary = useMemo(
    () => computeDashboardSummary(exportPrograms, exportComputedActivities),
    [exportPrograms, exportComputedActivities]
  );

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const handleFilePick = async (file: File, sheetName?: string) => {
    setParsing(true);
    try {
      setSelectedFile(file);
      const res = await parseMonitoringWorkbook(file, activities, importFy, sheetName);
      setParseResult(res);
      if (res.rows.length === 0) {
        onNotify(
          'error',
          `No PPA rows detected on sheet "${res.selectedSheet}". Verify column headers or switch worksheet.`
        );
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Failed to parse Excel workbook.'
      );
    } finally {
      setParsing(false);
    }
  };

  const handleSheetSwitch = async (sheet: string) => {
    if (!selectedFile) return;
    await handleFilePick(selectedFile, sheet);
  };

  const handleCommit = async () => {
    if (!parseResult) return;
    setConfirmImportOpen(false);
    setImporting(true);
    try {
      const materialized = materializeImportedRecords({
        rows: parseResult.rows,
        fiscalYear: importFy,
        existingPrograms: programs,
        existingOffices: offices,
        existingActivities: activities,
        duplicateMode,
        userUid: currentUser.uid,
      });

      const totalCount =
        materialized.newActivities.length + materialized.updatedActivities.length;

      const docRecord: UploadedDocument = {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fileName: parseResult.fileName,
        fileSize: parseResult.fileSize,
        fiscalYear: importFy,
        recordsImported: totalCount,
        uploadedByUid: currentUser.uid,
        uploadedByName: currentUser.displayName,
        uploadedAt: new Date().toISOString(),
        notes: `Sheet: ${parseResult.selectedSheet} · New: ${materialized.newActivities.length}, Updated: ${materialized.updatedActivities.length}, Duplicate policy: ${duplicateMode}`,
      };

      await onCommitImport({
        ...materialized,
        uploadedDocument: docRecord,
      });

      onNotify(
        'success',
        `Imported ${materialized.newActivities.length} new and ${materialized.updatedActivities.length} updated PPA records.`
      );
      setParseResult(null);
      setSelectedFile(null);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Failed to commit Excel import.'
      );
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async (blankTemplate: boolean) => {
    setExporting(true);
    try {
      let templateBuffer: ArrayBuffer | null = null;
      if (selectedTemplate) {
        templateBuffer = await dataService.fetchTemplateBinary(selectedTemplate.id);
      }

      if (blankTemplate && templateBuffer && selectedTemplate) {
        const blob = new Blob([templateBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const cleanName = selectedTemplate.fileName || `${selectedTemplate.name}.xlsx`;
        triggerBlobDownload(blob, cleanName);
        await onLogExport(cleanName);
        onNotify('success', `Downloaded official blank template ${cleanName}.`);
        return;
      }

      const blob = await exportMonitoringWorkbook({
        fiscalYear: exportFy,
        municipalityName,
        programs,
        activities,
        blankTemplate,
        settings: effectiveSettings,
        paperSize,
        orientation,
        templateBuffer,
      });
      const fileName = blankTemplate
        ? `Monitoring_Template_Blank_FY${exportFy}.xlsx`
        : `LGU_Bula_Monitoring_Template_FY${exportFy}.xlsx`;
      triggerBlobDownload(blob, fileName);
      await onLogExport(fileName);
      onNotify('success', `Exported ${fileName} successfully.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Excel export failed.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Card */}
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                Import Monitoring Template (.xlsx)
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Upload your LGU Bula Monitoring Template.xlsx file. Records are validated and checked for duplicates before saving.
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#163A5F]/10 text-[#163A5F] dark:bg-[#2563EB]/15 dark:text-sky-400 shrink-0">
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Target Fiscal Year
              </label>
              <select
                value={importFy}
                onChange={(e) => setImportFy(e.target.value)}
                disabled={!canImport}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.year}>
                    {fy.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Duplicate Handling Policy
              </label>
              <select
                value={duplicateMode}
                onChange={(e) =>
                  setDuplicateMode(e.target.value as 'skip' | 'update' | 'create')
                }
                disabled={!canImport}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
              >
                <option value="skip">Skip Duplicate Records (Recommended)</option>
                <option value="update">Overwrite / Update Matching Records</option>
                <option value="create">Import All as New Records</option>
              </select>
            </div>
          </div>

          {canImport ? (
            <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-6 text-center cursor-pointer hover:border-[#2563EB] dark:hover:border-sky-500 hover:bg-blue-50/40 dark:hover:bg-sky-950/30 transition-all">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[#163A5F] dark:text-sky-400 shadow-xs">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {parsing
                  ? 'Reading workbook...'
                  : selectedFile
                  ? selectedFile.name
                  : 'Click to select Monitoring Template.xlsx'}
              </span>
              <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Supports .xlsx workbooks with PS, MOOE, CO, Supplemental, and Jan–Dec monitoring columns
              </span>
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) handleFilePick(file);
                }}
              />
            </label>
          ) : (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-xs text-amber-800 dark:text-amber-300">
              Excel import is restricted to Administrators. Contact the MPDO System Administrator to upload workbooks.
            </div>
          )}
        </section>

        {/* Export Card */}
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                Export Monitoring Workbook (.xlsx)
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Generate an Excel workbook matching the LGU Bula Monitoring Template structure with live Excel formulas and latest totals.
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0D9488]/10 text-[#0D9488] dark:bg-teal-900/30 dark:text-teal-400 shrink-0">
              <Download className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Fiscal Year to Export
              </label>
              <select
                value={exportFy}
                onChange={(e) => setExportFy(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.year}>
                    {fy.label}
                  </option>
                ))}
                <option value="ALL">All Fiscal Years Combined</option>
              </select>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Official Excel Template
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedTemplateId(nextId);
                  const tpl = templates.find((t) => t.id === nextId);
                  const ps = tpl?.analysis?.paperSize;
                  if (ps === 'a4' || ps === 'letter' || ps === 'legal') setPaperSize(ps);
                  if (tpl?.analysis?.orientation) setOrientation(tpl.analysis.orientation);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
              >
                <option value="">System Standard 76-Column Template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.currentVersionNumber}
                    {t.isDefault ? ' · Default' : ''})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[12.5px] font-medium text-slate-700 dark:text-slate-300">
                Page Size
              </label>
              <select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
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
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
              >
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
            <span>
              <strong className="text-slate-900 dark:text-slate-100">{exportPrograms.length}</strong>{' '}
              Program(s) ·{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {exportComputedActivities.length}
              </strong>{' '}
              PPA(s)
            </span>
            <span className="font-mono tabular-nums">
              Revised: <strong>{formatPHP(exportSummary.totalRevisedBudget)}</strong>
            </span>
          </div>

          <div className="pt-1 space-y-2.5">
            <button
              type="button"
              onClick={() => setPreviewModalOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-[#163A5F]/40 dark:border-sky-500/40 bg-blue-50/70 dark:bg-sky-950/40 px-4 py-2 text-sm font-semibold text-[#163A5F] dark:text-sky-300 hover:bg-blue-100/80 dark:hover:bg-sky-950/70 transition-colors"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              <span>Preview Workbook Data Before Download</span>
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleExport(false)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2.5 text-sm font-semibold text-white transition-colors shadow-xs disabled:opacity-60"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              <span>
                {exporting
                  ? 'Preparing Workbook...'
                  : 'Export Populated Monitoring Workbook (.xlsx)'}
              </span>
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => handleExport(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Download Blank Official Template (.xlsx)</span>
            </button>
          </div>
        </section>
      </div>

      {/* Import Validation & Preview Panel */}
      {parseResult && (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div>
              <h3 className="text-[17px] font-semibold text-slate-900 dark:text-slate-100">
                Pre-Import Validation &amp; Duplicate Check — {parseResult.fileName}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Header detected at Row {parseResult.detectedHeaderRow} · Valid:{' '}
                <span className="font-semibold text-[#16A34A] dark:text-emerald-400">{parseResult.validCount}</span> ·
                Errors:{' '}
                <span className="font-semibold text-[#DC2626] dark:text-red-400">{parseResult.errorCount}</span> ·
                Duplicates:{' '}
                <span className="font-semibold text-[#F59E0B] dark:text-amber-400">{parseResult.duplicateCount}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {parseResult.sheetNames.length > 1 && (
                <select
                  value={parseResult.selectedSheet}
                  onChange={(e) => handleSheetSwitch(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs font-medium focus:border-[#2563EB] focus:outline-none transition-colors"
                >
                  {parseResult.sheetNames.map((s) => (
                    <option key={s} value={s}>
                      Sheet: {s}
                    </option>
                  ))}
                </select>
              )}

              {(parseResult.errorCount > 0 ||
                parseResult.duplicateCount > 0 ||
                parseResult.rows.some((r) => r.warnings.length > 0)) && (
                <button
                  type="button"
                  onClick={() => {
                    const csvBlob = buildValidationErrorCsvBlob(parseResult);
                    const safeBase = parseResult.fileName.replace(/\.xlsx$/i, '');
                    triggerBlobDownload(csvBlob, `${safeBase}_Validation_Report.csv`);
                    onNotify('success', 'Validation & duplicate error report (.csv) downloaded.');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/70 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Download Error Report (.csv)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setParseResult(null);
                  setSelectedFile(null);
                }}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={importing || parseResult.validCount === 0}
                onClick={() => setConfirmImportOpen(true)}
                className="rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-1.5 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-50"
              >
                {importing ? 'Importing...' : `Confirm & Import ${parseResult.validCount} Valid Rows`}
              </button>
            </div>
          </div>

          {(parseResult.errorCount > 0 || parseResult.rows.some((r) => r.warnings.length > 0)) && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/70 dark:bg-red-950/40 p-4 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-red-800 dark:text-red-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Validation Diagnostics: {parseResult.errorCount} row(s) blocked by errors ·{' '}
                    {parseResult.rows.filter((r) => r.warnings.length > 0).length} row(s) with security or field warnings
                  </span>
                </p>
              </div>
              <ul className="max-h-36 overflow-y-auto space-y-1 pl-5 list-disc text-red-700 dark:text-red-300/90">
                {parseResult.rows
                  .filter((r) => r.errors.length > 0 || r.warnings.length > 0)
                  .slice(0, 25)
                  .map((r) => (
                    <li key={r.rowNumber}>
                      <span className="font-mono font-semibold">Row {r.rowNumber}</span> ({r.referenceNumber}):{' '}
                      {[...r.errors, ...r.warnings].join(' · ')}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                  <th className="py-2 px-3">Row</th>
                  <th className="py-2 px-3">Validation</th>
                  <th className="py-2 px-3">Ref No.</th>
                  <th className="py-2 px-3">Program</th>
                  <th className="py-2 px-3">Activity Description</th>
                  <th className="py-2 px-3 text-right">Approved Budget</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Notes / Duplicate Info</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {parseResult.rows.map((r) => {
                  const approved = r.ps + r.mooe + r.co;
                  return (
                    <tr key={r.rowNumber} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">{r.rowNumber}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {r.errors.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 font-semibold">
                            <XCircle className="h-3.5 w-3.5" /> Error
                          </span>
                        ) : r.duplicateOfId ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
                            <AlertTriangle className="h-3.5 w-3.5" /> Duplicate
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono">{r.referenceNumber}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{r.programTitle}</td>
                      <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">{r.description}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {formatPHP(approved)}
                      </td>
                      <td className="py-2 px-3">{r.status}</td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                        {[...r.errors, ...r.warnings, r.duplicateReason]
                          .filter(Boolean)
                          .join(' · ') || 'Valid'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Uploaded Documents History */}
      <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">Import History Log</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-2.5 px-4">File Name</th>
                <th className="py-2.5 px-4">Fiscal Year</th>
                <th className="py-2.5 px-4 text-right">Records Imported</th>
                <th className="py-2.5 px-4">Uploaded By</th>
                <th className="py-2.5 px-4">Date &amp; Time</th>
                <th className="py-2.5 px-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {uploadedDocuments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500 dark:text-slate-400">
                    No Excel workbooks imported yet.
                  </td>
                </tr>
              ) : (
                uploadedDocuments.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">{d.fileName}</td>
                    <td className="py-2.5 px-4 font-mono">FY {d.fiscalYear}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold">
                      {d.recordsImported}
                    </td>
                    <td className="py-2.5 px-4">{d.uploadedByName}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">
                      {new Date(d.uploadedAt).toLocaleString('en-PH')}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">{d.notes}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={confirmImportOpen}
        title="Confirm Excel Import"
        message={
          duplicateMode === 'update'
            ? `Import ${parseResult?.validCount ?? 0} validated records into FY ${importFy}? Matching duplicate activities will be overwritten with spreadsheet values.`
            : `Import ${parseResult?.validCount ?? 0} validated records into FY ${importFy} using policy "${duplicateMode}"? Existing non-matching records will be preserved.`
        }
        confirmLabel="Proceed with Import"
        destructive={duplicateMode === 'update'}
        onCancel={() => setConfirmImportOpen(false)}
        onConfirm={handleCommit}
      />

      <ExportPreviewModal
        open={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        reportType="annual_ppa"
        fiscalYear={exportFy}
        monthKey="jan"
        programs={exportPrograms}
        activities={exportComputedActivities}
        settings={effectiveSettings}
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplateId={(nextId) => {
          setSelectedTemplateId(nextId);
          const tpl = templates.find((t) => t.id === nextId);
          const ps = tpl?.analysis?.paperSize;
          if (ps === 'a4' || ps === 'letter' || ps === 'legal') setPaperSize(ps);
          if (tpl?.analysis?.orientation) setOrientation(tpl.analysis.orientation);
        }}
        paperSize={paperSize}
        onChangePaperSize={setPaperSize}
        orientation={orientation}
        onChangeOrientation={setOrientation}
        onConfirmExport={async (_fmt: PreviewExportFormat) => {
          await handleExport(false);
          setPreviewModalOpen(false);
        }}
        exportingFormat={exporting ? 'xlsx' : null}
        hideReportSpecificFormats={true}
      />
    </div>
  );
}
