import { useMemo, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import {
  Activity,
  ActivityComputed,
  Program,
  UserRole,
} from '../../types/ppa';
import {
  classifyFundBucket,
  computeDashboardSummary,
  formatPHP,
  formatPct,
  resolveActivityBudgetDisplay,
  summarizeProgram,
} from '../../utils/calculations';

interface BudgetManagementModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  selectedFiscalYear: string;
  userRole: UserRole;
  userUid: string;
  userName?: string;
  onUpdateActivity: (activity: Activity) => Promise<void>;
  onUpdateProgram?: (program: Program) => Promise<void>;
}

function formatFundLabel(act: ActivityComputed, parentProg?: Program): string {
  if (act.sourceOfFund) return act.sourceOfFund;
  if (act.gf > 0 && act.ps === 0 && act.mooe === 0 && act.co === 0) return 'General Fund (GF)';
  if (act.budgetClassification) return act.budgetClassification;
  if (parentProg?.sourceOfFund) return parentProg.sourceOfFund;
  return 'GF';
}

export function BudgetManagementModule({
  programs,
  activities,
  selectedFiscalYear,
}: BudgetManagementModuleProps) {
  const [viewMode, setViewMode] = useState<'activity' | 'program'>('activity');
  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('ALL');

  const fyPrograms = useMemo(
    () =>
      programs.filter(
        (p) => selectedFiscalYear === 'ALL' || p.fiscalYear === selectedFiscalYear
      ),
    [programs, selectedFiscalYear]
  );

  const filteredActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter((a) => {
      if (selectedFiscalYear !== 'ALL' && a.fiscalYear !== selectedFiscalYear) return false;
      if (programFilter !== 'ALL' && a.programId !== programFilter) return false;
      if (q) {
        const hay = `${a.referenceNumber} ${a.description} ${a.officeName} ${a.sourceOfFund || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activities, selectedFiscalYear, programFilter, search]);

  const programLookup = useMemo(
    () => new Map(fyPrograms.map((p) => [p.id, p])),
    [fyPrograms]
  );

  const relevantPrograms = useMemo(() => {
    if (programFilter !== 'ALL') {
      return fyPrograms.filter((p) => p.id === programFilter);
    }
    if (!search.trim()) return fyPrograms;
    const ids = new Set(filteredActivities.map((a) => a.programId));
    return fyPrograms.filter((p) => ids.has(p.id));
  }, [fyPrograms, programFilter, search, filteredActivities]);

  const programSummaries = useMemo(
    () => relevantPrograms.map((p) => summarizeProgram(p, filteredActivities)),
    [relevantPrograms, filteredActivities]
  );

  const programSummaryLookup = useMemo(
    () => new Map(programSummaries.map((s) => [s.program.id, s])),
    [programSummaries]
  );

  const totals = useMemo(() => {
    const dash = computeDashboardSummary(relevantPrograms, filteredActivities);
    return {
      gf: dash.totalGF,
      ps: dash.totalPS,
      mooe: dash.totalMOOE,
      co: dash.totalCO,
      approved: dash.totalApprovedBudget,
      revised: dash.totalRevisedBudget,
      utilized: dash.totalBudgetUtilized,
      remaining: dash.remainingBudget,
      utilPct: dash.budgetUtilizationPct,
    };
  }, [relevantPrograms, filteredActivities]);

  const ceilingAlerts = useMemo(() => {
    const overPrograms = programSummaries.filter((s) => s.remainingBudget < 0);
    const overActivities = filteredActivities.filter((a) => {
      const bd = resolveActivityBudgetDisplay(
        a,
        programLookup.get(a.programId),
        programSummaryLookup.get(a.programId)
      );
      return bd.remainingBudget < 0;
    });
    return { overPrograms, overActivities };
  }, [programSummaries, filteredActivities, programLookup, programSummaryLookup]);

  return (
    <div className="space-y-5">
      {(ceilingAlerts.overPrograms.length > 0 || ceilingAlerts.overActivities.length > 0) && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/90 dark:bg-red-950/40 px-4 py-3 text-xs text-red-900 dark:text-red-200 flex items-start gap-3"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#DC2626] dark:text-red-400" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="font-semibold">
              Budget Ceiling Exceeded:{' '}
              {ceilingAlerts.overPrograms.length > 0 &&
                `${ceilingAlerts.overPrograms.length} program${ceilingAlerts.overPrograms.length === 1 ? '' : 's'}`}
              {ceilingAlerts.overPrograms.length > 0 && ceilingAlerts.overActivities.length > 0 && ' and '}
              {ceilingAlerts.overActivities.length > 0 &&
                `${ceilingAlerts.overActivities.length} activit${ceilingAlerts.overActivities.length === 1 ? 'y' : 'ies'}`}{' '}
              report expenditure above revised allocation.
            </p>
            <p className="text-red-700 dark:text-red-300">
              Review highlighted negative remaining balances below or apply a supplemental budget adjustment if authorized.
            </p>
          </div>
        </div>
      )}

      {/* Primary Budget Totals Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            Total Approved Budget (GF + PS + MOOE + CO)
          </p>
          <p className="mt-1.5 font-mono text-[22px] sm:text-[24px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
            {formatPHP(totals.approved)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            Revised Total Budget (PS Exempt; GF/MOOE/CO −15%)
          </p>
          <p className="mt-1.5 font-mono text-[22px] sm:text-[24px] leading-tight font-semibold tracking-tight text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPHP(totals.revised)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            Total Expenditure
          </p>
          <p className="mt-1.5 font-mono text-[22px] sm:text-[24px] leading-tight font-semibold tracking-tight text-slate-800 dark:text-slate-200 tabular-nums">
            {formatPHP(totals.utilized)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
            Remaining Budget ({formatPct(totals.utilPct)} Used)
          </p>
          <p
            className={`mt-1.5 font-mono text-[22px] sm:text-[24px] leading-tight font-semibold tracking-tight tabular-nums ${
              totals.remaining < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {formatPHP(totals.remaining)}
          </p>
        </div>
      </div>

      {/* Source of Fund Amounts Breakdown Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
              General Fund (GF)
            </p>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              −15% Reserve
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[17px] font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPHP(totals.gf)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
              Personnel Services (PS)
            </p>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              15% Exempted
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[17px] font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPHP(totals.ps)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
              MOOE
            </p>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              −15% Reserve
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[17px] font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPHP(totals.mooe)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
              Capital Outlay (CO)
            </p>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              −15% Reserve
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[17px] font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPHP(totals.co)}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-0 sm:min-w-[220px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter budget records..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 pl-9 pr-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
            />
          </div>
          <select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          >
            <option value="ALL">All Programs</option>
            {fyPrograms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.aipRefCode} · {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => setViewMode('activity')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'activity'
                ? 'bg-white dark:bg-slate-700 text-[#163A5F] dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            By Activity
          </button>
          <button
            type="button"
            onClick={() => setViewMode('program')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'program'
                ? 'bg-white dark:bg-slate-700 text-[#163A5F] dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            By Program
          </button>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          {viewMode === 'activity' ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                  <th className="py-3 px-3">Ref Code</th>
                  <th className="py-3 px-3 min-w-[220px]">Project / Activity</th>
                  <th className="py-3 px-3">Source of Fund</th>
                  <th className="py-3 px-3 text-right">GF</th>
                  <th className="py-3 px-3 text-right">PS</th>
                  <th className="py-3 px-3 text-right">MOOE</th>
                  <th className="py-3 px-3 text-right">CO</th>
                  <th className="py-3 px-3 text-right">Approved Budget</th>
                  <th className="py-3 px-3 text-right">Revised Budget</th>
                  <th className="py-3 px-3 text-right">Expenditure</th>
                  <th className="py-3 px-3 text-right">Remaining Budget</th>
                  <th className="py-3 px-3 text-right">Util %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[13px] dark:text-slate-200">
                {filteredActivities.length === 0 ? (
                  <tr>
                    <td
                      colSpan={12}
                      className="py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      No budget records match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredActivities.map((a) => {
                    const parentProg = programLookup.get(a.programId);
                    const progSum = programSummaryLookup.get(a.programId);
                    const bd = resolveActivityBudgetDisplay(a, parentProg, progSum);
                    const fundLabel = formatFundLabel(a, parentProg);
                    const fundBucket = classifyFundBucket(fundLabel);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {a.referenceNumber}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                          {a.description}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                            {fundBucket}
                          </span>
                          <span className="ml-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                            {bd.isPsExempt ? '(PS Exempt)' : '(−15%)'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {formatPHP(bd.gf)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {formatPHP(bd.ps)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {formatPHP(bd.mooe)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {formatPHP(bd.co)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                          {formatPHP(bd.approvedBudget)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums whitespace-nowrap">
                          {formatPHP(bd.revisedBudget)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {formatPHP(bd.expenditure)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            bd.remainingBudget < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          <span>{formatPHP(bd.remainingBudget)}</span>
                          {bd.remainingBudget < 0 && (
                            <span className="ml-1.5 inline-block rounded bg-red-100 dark:bg-red-950 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:text-red-300">
                              Over
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                          {formatPct(bd.utilizationPct)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredActivities.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-[#163A5F] text-xs font-bold text-white">
                    <td colSpan={3} className="py-3 px-3">
                      ANNUAL TOTAL ({filteredActivities.length} Activities)
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.gf)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.ps)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.mooe)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.co)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.approved)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.revised)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.utilized)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.remaining)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPct(totals.utilPct)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
                  <th className="py-3 px-4">AIP Ref</th>
                  <th className="py-3 px-4">Program Title</th>
                  <th className="py-3 px-4">Source of Fund</th>
                  <th className="py-3 px-4 text-right">Activities</th>
                  <th className="py-3 px-4 text-right">GF</th>
                  <th className="py-3 px-4 text-right">PS</th>
                  <th className="py-3 px-4 text-right">MOOE</th>
                  <th className="py-3 px-4 text-right">CO</th>
                  <th className="py-3 px-4 text-right">Approved Budget</th>
                  <th className="py-3 px-4 text-right">Revised Budget</th>
                  <th className="py-3 px-4 text-right">Expenditure</th>
                  <th className="py-3 px-4 text-right">Remaining Budget</th>
                  <th className="py-3 px-4 text-right">Util %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[13px] dark:text-slate-200">
                {programSummaries.map((s) => (
                  <tr key={s.program.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {s.program.aipRefCode}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                      {s.program.title}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {s.program.sourceOfFund || 'General Fund (GF)'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {s.activityCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(s.gf)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(s.ps)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(s.mooe)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(s.co)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                      {formatPHP(s.approvedBudget)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums whitespace-nowrap">
                      {formatPHP(s.revisedBudget)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(s.annualFinancialActual)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                        s.remainingBudget < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      <span>{formatPHP(s.remainingBudget)}</span>
                      {s.remainingBudget < 0 && (
                        <span className="ml-1.5 inline-block rounded bg-red-100 dark:bg-red-950 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:text-red-300">
                          Over
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                      {formatPct(s.budgetUtilizationPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {programSummaries.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-[#163A5F] text-xs font-bold text-white">
                    <td colSpan={3} className="py-3 px-4">
                      ANNUAL TOTAL ({programSummaries.length} Programs)
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {filteredActivities.length}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.gf)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.ps)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.mooe)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.co)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.approved)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.revised)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.utilized)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPHP(totals.remaining)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatPct(totals.utilPct)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
