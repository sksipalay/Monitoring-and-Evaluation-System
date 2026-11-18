import { useEffect, useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import {
  ActivityComputed,
  FiscalYear,
  MonthKey,
  Program,
  SystemSettings,
} from '../../types/ppa';
import {
  MONTHS,
  STATUS_OPTIONS,
  computeGadComplianceSummary,
  formatPHP,
  formatPct,
  formatQty,
  resolveActivityBudgetDisplay,
  round2,
  summarizeProgram,
} from '../../utils/calculations';
import {
  REPORT_DEFINITIONS,
  ReportType,
  exportReportToPDF,
} from '../../utils/pdfReportService';
import { StatusBadge } from '../ui/StatusBadge';

interface ReportsModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  fiscalYears: FiscalYear[];
  settings: SystemSettings;
  selectedFiscalYear: string;
  onExportExcel: (fiscalYear: string) => Promise<void>;
  onLogReportExport: (reportTitle: string, format: 'PDF' | 'EXCEL' | 'PRINT') => Promise<void>;
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

  useEffect(() => {
    setFyFilter(selectedFiscalYear === 'ALL' ? 'ALL' : selectedFiscalYear);
  }, [selectedFiscalYear]);

  const fyPrograms = useMemo(
    () => programs.filter((p) => fyFilter === 'ALL' || p.fiscalYear === fyFilter),
    [programs, fyFilter]
  );

  useEffect(() => {
    if (programFilter !== 'ALL' && !fyPrograms.some((p) => p.id === programFilter)) {
      setProgramFilter('ALL');
    }
  }, [fyPrograms, programFilter]);

  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      if (fyFilter !== 'ALL' && a.fiscalYear !== fyFilter) return false;
      if (programFilter !== 'ALL' && a.programId !== programFilter) return false;
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (reportType === 'completed_activities' && a.status !== 'COMPLETED') return false;
      if (
        reportType === 'pending_not_implemented' &&
        a.status !== 'PENDING' &&
        a.status !== 'NOT IMPLEMENTED'
      ) {
        return false;
      }
      return true;
    });
  }, [activities, fyFilter, programFilter, statusFilter, reportType]);

  const activeReport = REPORT_DEFINITIONS.find((r) => r.id === reportType) || REPORT_DEFINITIONS[0];
  const activeMonth = MONTHS.find((m) => m.key === monthKey) || MONTHS[0];

  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const gadSummary = useMemo(
    () => computeGadComplianceSummary(fyPrograms, filteredActivities),
    [fyPrograms, filteredActivities]
  );

  const handlePrint = async () => {
    window.print();
    onLogReportExport(activeReport.title, 'PRINT').catch(() => {});
  };

  const handlePDF = async () => {
    setExportingPdf(true);
    try {
      exportReportToPDF({
        reportType,
        fiscalYear: fyFilter,
        monthKey,
        programs:
          reportType === 'gad_compliance'
            ? fyPrograms
            : fyPrograms.filter((p) => programFilter === 'ALL' || p.id === programFilter),
        activities: filteredActivities,
        settings,
      });
      await onLogReportExport(activeReport.title, 'PDF').catch(() => {});
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExcel = async () => {
    setExportingExcel(true);
    try {
      await onExportExcel(fyFilter);
      await onLogReportExport(activeReport.title, 'EXCEL').catch(() => {});
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Excel export failed.');
    } finally {
      setExportingExcel(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Report Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 no-print">
        {REPORT_DEFINITIONS.map((rep) => {
          const active = rep.id === reportType;
          return (
            <button
              key={rep.id}
              type="button"
              onClick={() => setReportType(rep.id)}
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

      {/* Filters & Export Toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Fiscal Year</label>
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
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Program</label>
            <select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm max-w-[240px] focus:border-[#2563EB] focus:outline-none transition-colors"
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
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Month</label>
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
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Status</label>
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <Printer className="h-4 w-4" />
            <span>Print Report</span>
          </button>
          <button
            type="button"
            disabled={exportingExcel}
            onClick={handleExcel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D9488] hover:bg-[#0F766E] px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>{exportingExcel ? 'Exporting...' : 'Export Excel'}</span>
          </button>
          <button
            type="button"
            disabled={exportingPdf}
            onClick={handlePDF}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-60 whitespace-nowrap"
          >
            <FileDown className="h-4 w-4" />
            <span>{exportingPdf ? 'Generating PDF...' : 'Export PDF'}</span>
          </button>
        </div>
      </div>

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
            {settings.officeTitle} · Fiscal Year: {fyFilter}
            {reportType === 'monthly_accomplishment' ? ` · Month: ${activeMonth.label}` : ''}
          </p>
        </div>

        <div className="overflow-x-auto">
          {reportType === 'gad_compliance' ? (
            <div className="space-y-5">
              {/* GAD 5% Mandatory Compliance Scorecard */}
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

              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-y border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
                    <th className="py-2.5 px-3">AIP Ref</th>
                    <th className="py-2.5 px-3">GAD-Attributed Program</th>
                    <th className="py-2.5 px-3">Office</th>
                    <th className="py-2.5 px-3 text-right">PPAs</th>
                    <th className="py-2.5 px-3 text-right">Approved Budget</th>
                    <th className="py-2.5 px-3 text-right">Revised Budget</th>
                    <th className="py-2.5 px-3 text-right">GAD Expenditure</th>
                    <th className="py-2.5 px-3 text-right">Remaining Budget</th>
                    <th className="py-2.5 px-3 text-right">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {gadSummary.gadPrograms.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-slate-500 dark:text-slate-400">
                        No programs are currently marked as &ldquo;GAD Fund: Yes&rdquo; for this fiscal year.
                      </td>
                    </tr>
                  ) : (
                    gadSummary.gadPrograms.map((s) => {
                      const share =
                        gadSummary.totalBudgetApproved > 0
                          ? round2((s.approvedBudget / gadSummary.totalBudgetApproved) * 100)
                          : 0;
                      return (
                        <tr key={s.program.id}>
                          <td className="py-2 px-3 font-mono">{s.program.aipRefCode}</td>
                          <td className="py-2 px-3 font-medium">{s.program.title}</td>
                          <td className="py-2 px-3">{s.program.officeName}</td>
                          <td className="py-2 px-3 text-right font-mono">{s.activityCount}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {formatPHP(s.approvedBudget)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                            {formatPHP(s.revisedBudget)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {formatPHP(s.annualFinancialActual)}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-mono font-semibold tabular-nums ${
                              s.remainingBudget < 0 ? 'text-red-600 dark:text-red-400' : ''
                            }`}
                          >
                            {formatPHP(s.remainingBudget)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {formatPct(share)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : reportType === 'program_level' ? (
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
                  <th className="py-2.5 px-3">AIP Ref</th>
                  <th className="py-2.5 px-3">Program Title</th>
                  <th className="py-2.5 px-3 text-right">PPAs</th>
                  <th className="py-2.5 px-3 text-right">Approved Budget</th>
                  <th className="py-2.5 px-3 text-right">Revised Budget</th>
                  <th className="py-2.5 px-3 text-right">Expenditure</th>
                  <th className="py-2.5 px-3 text-right">Remaining Budget</th>
                  <th className="py-2.5 px-3 text-right">Phys %</th>
                  <th className="py-2.5 px-3 text-right">Fin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {fyPrograms
                  .filter((p) => programFilter === 'ALL' || p.id === programFilter)
                  .map((p) => {
                    const s = summarizeProgram(p, filteredActivities);
                    return (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-mono">{p.aipRefCode}</td>
                        <td className="py-2 px-3 font-medium">{p.title}</td>
                        <td className="py-2 px-3 text-right font-mono">{s.activityCount}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatPHP(s.approvedBudget)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                          {formatPHP(s.revisedBudget)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatPHP(s.annualFinancialActual)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatPHP(s.remainingBudget)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatPct(s.physicalAccomplishmentPct)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {formatPct(s.financialAccomplishmentPct)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : reportType === 'monthly_accomplishment' ? (
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
                  <th className="py-2.5 px-3">Ref Code</th>
                  <th className="py-2.5 px-3">PPA Description</th>
                  <th className="py-2.5 px-3">Office</th>
                  <th className="py-2.5 px-3 text-right">{activeMonth.short} Phys. Target</th>
                  <th className="py-2.5 px-3 text-right">{activeMonth.short} Phys. Actual</th>
                  <th className="py-2.5 px-3 text-right">{activeMonth.short} Fin. Target</th>
                  <th className="py-2.5 px-3 text-right">{activeMonth.short} Fin. Actual</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredActivities.map((a) => {
                  const m = a.monthly[monthKey];
                  return (
                    <tr key={a.id}>
                      <td className="py-2 px-3 font-mono">{a.referenceNumber}</td>
                      <td className="py-2 px-3 font-medium">{a.description}</td>
                      <td className="py-2 px-3">{a.officeName}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatQty(m.physicalTarget)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {formatQty(m.physicalActual)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{formatPHP(m.financialTarget)}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {formatPHP(m.financialActual)}
                      </td>
                      <td className="py-2 px-3">
                        <StatusBadge status={a.status} compact />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-y border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
                  <th className="py-2.5 px-3">Ref Code</th>
                  <th className="py-2.5 px-3">PPA Description</th>
                  <th className="py-2.5 px-3">Target Outputs</th>
                  <th className="py-2.5 px-3">Office</th>
                  <th className="py-2.5 px-3 text-right">Approved Budget</th>
                  <th className="py-2.5 px-3 text-right">Revised Budget</th>
                  <th className="py-2.5 px-3 text-right">Expenditure</th>
                  <th className="py-2.5 px-3 text-right">Remaining Budget</th>
                  <th className="py-2.5 px-3 text-right">Phys. %</th>
                  <th className="py-2.5 px-3 text-right">Fin. %</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredActivities.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-6 text-center text-slate-500 dark:text-slate-400">
                      No matching records for this report filter.
                    </td>
                  </tr>
                ) : (
                  filteredActivities.map((a) => {
                    const parentProg = fyPrograms.find((p) => p.id === a.programId);
                    const progSum = parentProg
                      ? summarizeProgram(
                          parentProg,
                          filteredActivities.filter((item) => item.programId === parentProg.id)
                        )
                      : undefined;
                    const bd = resolveActivityBudgetDisplay(a, parentProg, progSum);
                    return (
                    <tr key={a.id}>
                      <td className="py-2 px-3 font-mono">{a.referenceNumber}</td>
                      <td className="py-2 px-3 font-medium">{a.description}</td>
                      <td className="py-2 px-3">{a.targetOutputs}</td>
                      <td className="py-2 px-3">{a.officeName}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {formatPHP(bd.approvedBudget)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                        {formatPHP(bd.revisedBudget)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {formatPHP(bd.expenditure)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                        {formatPHP(bd.remainingBudget)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {formatPct(a.physicalAccomplishmentPct)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {formatPct(a.financialAccomplishmentPct)}
                      </td>
                      <td className="py-2 px-3">
                        <StatusBadge status={a.status} compact />
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Signatory Block */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-slate-200 dark:border-slate-800 text-[13px]">
          <div>
            <p className="text-slate-500 dark:text-slate-400">Prepared by:</p>
            <p className="mt-6 font-semibold text-slate-900 dark:text-slate-100">{settings.preparedByName}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">{settings.preparedByTitle}</p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Reviewed by:</p>
            <p className="mt-6 font-semibold text-slate-900 dark:text-slate-100">{settings.reviewedByName}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">{settings.reviewedByTitle}</p>
          </div>
          <div>
            <p className="text-slate-500 dark:text-slate-400">Approved by:</p>
            <p className="mt-6 font-semibold text-slate-900 dark:text-slate-100">{settings.approvedByName}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">{settings.approvedByTitle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
