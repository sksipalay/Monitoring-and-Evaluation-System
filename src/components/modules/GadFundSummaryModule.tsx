import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Scale,
  Search,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ActivityComputed, FiscalYear, Office, Program } from '../../types/ppa';
import {
  computeGadComplianceSummary,
  formatCompactPHP,
  formatPHP,
  formatPct,
  resolveActivityBudgetDisplay,
  round2,
  summarizeProgram,
} from '../../utils/calculations';
import { StatusBadge } from '../ui/StatusBadge';

interface GadFundSummaryModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  offices: Office[];
  fiscalYears: FiscalYear[];
  selectedFiscalYear: string;
  isOfficeScoped?: boolean;
  userOfficeName?: string;
  theme?: 'light' | 'dark';
  canManagePrograms?: boolean;
  onNavigateToPrograms?: () => void;
}

type SortKey = 'budget_desc' | 'expenditure_desc' | 'utilization_desc' | 'aip_asc';

export function GadFundSummaryModule({
  programs,
  activities,
  offices,
  fiscalYears,
  selectedFiscalYear,
  isOfficeScoped = false,
  userOfficeName = '',
  theme = 'light',
  canManagePrograms = false,
  onNavigateToPrograms,
}: GadFundSummaryModuleProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [officeFilter, setOfficeFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('budget_desc');
  const [expandedProgramIds, setExpandedProgramIds] = useState<Set<string>>(new Set());

  const isDark = theme === 'dark';

  const fyPrograms = useMemo(
    () =>
      programs.filter(
        (p) => selectedFiscalYear === 'ALL' || p.fiscalYear === selectedFiscalYear
      ),
    [programs, selectedFiscalYear]
  );

  const fyActivities = useMemo(
    () =>
      activities.filter(
        (a) => selectedFiscalYear === 'ALL' || a.fiscalYear === selectedFiscalYear
      ),
    [activities, selectedFiscalYear]
  );

  const summary = useMemo(
    () => computeGadComplianceSummary(fyPrograms, fyActivities),
    [fyPrograms, fyActivities]
  );

  const targetAttainmentPct = useMemo(() => {
    if (summary.mandatoryFivePctTarget <= 0) return 0;
    return round2((summary.gadApprovedBudget / summary.mandatoryFivePctTarget) * 100);
  }, [summary.gadApprovedBudget, summary.mandatoryFivePctTarget]);

  const gadOffices = useMemo(() => {
    const ids = new Set(summary.gadPrograms.map((s) => s.program.officeId));
    return offices.filter((o) => ids.has(o.id));
  }, [offices, summary.gadPrograms]);

  const filteredGadPrograms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = summary.gadPrograms.filter((row) => {
      if (officeFilter !== 'ALL' && row.program.officeId !== officeFilter) return false;
      if (!q) return true;
      return `${row.program.aipRefCode} ${row.program.title} ${row.program.sector} ${row.program.officeName} ${row.program.sourceOfFund || ''}`
        .toLowerCase()
        .includes(q);
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'expenditure_desc') {
        return b.annualFinancialActual - a.annualFinancialActual;
      }
      if (sortBy === 'utilization_desc') {
        return b.budgetUtilizationPct - a.budgetUtilizationPct;
      }
      if (sortBy === 'aip_asc') {
        return a.program.aipRefCode.localeCompare(b.program.aipRefCode, undefined, {
          numeric: true,
        });
      }
      return b.revisedBudget - a.revisedBudget;
    });
  }, [summary.gadPrograms, searchQuery, officeFilter, sortBy]);

  const filteredTotals = useMemo(() => {
    const approved = round2(filteredGadPrograms.reduce((s, r) => s + r.approvedBudget, 0));
    const revised = round2(filteredGadPrograms.reduce((s, r) => s + r.revisedBudget, 0));
    const expenditure = round2(filteredGadPrograms.reduce((s, r) => s + r.annualFinancialActual, 0));
    const remaining = round2(revised - expenditure);
    const activityCount = filteredGadPrograms.reduce((s, r) => s + r.activityCount, 0);
    const utilizationPct = revised > 0 ? round2((expenditure / revised) * 100) : 0;
    const shareOfLguPct =
      summary.totalBudgetApproved > 0
        ? round2((approved / summary.totalBudgetApproved) * 100)
        : 0;
    return {
      approved,
      revised,
      expenditure,
      remaining,
      activityCount,
      utilizationPct,
      shareOfLguPct,
    };
  }, [filteredGadPrograms, summary.totalBudgetApproved]);

  const programChartData = useMemo(() => {
    return filteredGadPrograms.slice(0, 8).map((row) => ({
      name:
        row.program.title.length > 26
          ? `${row.program.title.slice(0, 24)}…`
          : row.program.title,
      fullTitle: `${row.program.aipRefCode} · ${row.program.title}`,
      revisedBudget: row.revisedBudget,
      expenditure: row.annualFinancialActual,
    }));
  }, [filteredGadPrograms]);

  const officeBreakdownData = useMemo(() => {
    const map = new Map<
      string,
      { officeName: string; officeCode: string; budget: number; expenditure: number }
    >();
    const codeById = new Map(offices.map((o) => [o.id, o.code]));

    for (const row of filteredGadPrograms) {
      const id = row.program.officeId || row.program.officeName;
      const code = codeById.get(row.program.officeId) || row.program.officeName.slice(0, 12);
      const curr = map.get(id) || {
        officeName: row.program.officeName,
        officeCode: code,
        budget: 0,
        expenditure: 0,
      };
      curr.budget = round2(curr.budget + row.revisedBudget);
      curr.expenditure = round2(curr.expenditure + row.annualFinancialActual);
      map.set(id, curr);
    }

    return Array.from(map.values())
      .sort((a, b) => b.budget - a.budget)
      .slice(0, 8);
  }, [filteredGadPrograms, offices]);

  const toggleExpandProgram = (programId: string) => {
    setExpandedProgramIds((prev) => {
      const next = new Set(prev);
      if (next.has(programId)) next.delete(programId);
      else next.add(programId);
      return next;
    });
  };

  const activeFyLabel = useMemo(() => {
    if (selectedFiscalYear === 'ALL') return 'All Fiscal Years';
    return (
      fiscalYears.find((f) => f.year === selectedFiscalYear)?.label ||
      `FY ${selectedFiscalYear}`
    );
  }, [fiscalYears, selectedFiscalYear]);

  // Scale the compliance meter cleanly up to 10% (so 5% sits right at the midpoint 50%)
  // or higher if GAD share exceeds 10%.
  const meterMaxPct = Math.max(10, Math.ceil(summary.gadShareApprovedPct / 2) * 2);
  const targetMarkerLeftPct = Math.min(100, (5 / meterMaxPct) * 100);
  const actualFillWidthPct = Math.min(100, (summary.gadShareApprovedPct / meterMaxPct) * 100);

  return (
    <div className="space-y-6">
      {/* Compliance Status Banner & 5% Allocation Target Meter */}
      <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>{activeFyLabel}</span>
              <span aria-hidden="true">·</span>
              <span>RA 9710 / PCW-DILG-DBM-NEDA JMC 2013-01</span>
              <span aria-hidden="true">·</span>
              <span>Mandatory 5.00% Annual Budget Floor</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {summary.isCompliant ? (
                <span className="inline-flex items-center gap-1.5 text-[18px] font-semibold text-[#16A34A] dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>Compliant — Meets Mandatory 5.00% GAD Allocation</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[18px] font-semibold text-[#D97706] dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>
                    {summary.totalBudgetApproved === 0
                      ? 'No Program Appropriations Recorded Yet'
                      : 'Below Mandatory 5.00% GAD Allocation Target'}
                  </span>
                </span>
              )}
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Automatically aggregates all programs marked with{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                GAD Fund? = Yes
              </span>{' '}
              across {activeFyLabel} to evaluate appropriation compliance and track actual budget
              utilization.
              {isOfficeScoped && userOfficeName && (
                <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Office-scoped view active: displaying programs assigned to {userOfficeName}.
                </span>
              )}
            </p>
          </div>

          {/* Right Primary Compliance Readout */}
          <div className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 px-5 py-4 min-w-[260px]">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              GAD Share of Total LGU Approved Budget
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <p
                className={`font-mono text-[30px] font-semibold tracking-tight tabular-nums ${
                  summary.isCompliant
                    ? 'text-[#16A34A] dark:text-emerald-400'
                    : 'text-[#163A5F] dark:text-sky-400'
                }`}
              >
                {formatPct(summary.gadShareApprovedPct)}
              </p>
              <span className="font-mono text-xs font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                Target: 5.00%
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200/80 dark:border-slate-700/80 pt-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">5% Target Attainment</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {formatPct(targetAttainmentPct)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Variance vs. 5% Floor</span>
              <span
                className={`font-mono font-semibold tabular-nums ${
                  summary.varianceFromTarget >= 0
                    ? 'text-[#16A34A] dark:text-emerald-400'
                    : 'text-[#DC2626] dark:text-red-400'
                }`}
              >
                {summary.varianceFromTarget >= 0 ? '+' : ''}
                {formatPHP(summary.varianceFromTarget)}
              </span>
            </div>
          </div>
        </div>

        {/* Visual 5.00% Threshold Gauge */}
        <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-2">
            <span>0.00%</span>
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Mandatory 5.00% Floor ({formatPHP(summary.mandatoryFivePctTarget)})
            </span>
            <span className="font-mono tabular-nums">{meterMaxPct.toFixed(0)}.00%</span>
          </div>
          <div className="relative h-3.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-visible">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                summary.isCompliant
                  ? 'bg-[#16A34A] dark:bg-emerald-500'
                  : 'bg-[#2563EB] dark:bg-sky-500'
              }`}
              style={{ width: `${actualFillWidthPct}%` }}
            />
            <div
              className="absolute -top-1 -bottom-1 w-0.5 bg-slate-900 dark:bg-white"
              style={{ left: `${targetMarkerLeftPct}%` }}
              title={`Mandatory 5.00% Target (${formatPHP(summary.mandatoryFivePctTarget)})`}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Total LGU Approved Budget:{' '}
              <strong className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {formatPHP(summary.totalBudgetApproved)}
              </strong>
            </span>
            <span>
              GAD Share (Revised Net Budget):{' '}
              <strong className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                {formatPct(summary.gadShareRevisedPct)}
              </strong>
            </span>
          </div>
        </div>
      </section>

      {/* 4-Column KPI Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total GAD Budget (Approved)</span>
            <Wallet className="h-4 w-4 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[24px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
            {formatPHP(summary.gadApprovedBudget)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Revised (Net): {formatPHP(summary.gadRevisedBudget)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total GAD Expenditure</span>
            <TrendingUp className="h-4 w-4 text-[#0D9488] dark:text-teal-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[24px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
            {formatPHP(summary.gadExpenditure)}
          </p>
          <p
            className={`mt-1.5 text-xs font-mono tabular-nums ${
              summary.gadRemainingBudget < 0
                ? 'text-[#DC2626] dark:text-red-400 font-medium'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            Remaining: {formatPHP(summary.gadRemainingBudget)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>GAD Budget Utilization Rate</span>
            <Scale className="h-4 w-4 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[24px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
            {formatPct(summary.gadUtilizationPct)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Expenditure vs. revised GAD appropriation
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>GAD-Attributed Programs</span>
            <FolderKanban className="h-4 w-4 text-[#16A34A] dark:text-emerald-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[24px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
            {summary.gadProgramCount}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {summary.gadActivityCount} linked PPA{' '}
            {summary.gadActivityCount === 1 ? 'activity' : 'activities'} ·{' '}
            {gadOffices.length} {gadOffices.length === 1 ? 'office' : 'offices'}
          </p>
        </div>
      </section>

      {/* Empty State or Analytics + Ledger */}
      {summary.gadPrograms.length === 0 ? (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <Scale className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <h3 className="mt-3 text-[18px] font-semibold text-slate-900 dark:text-slate-100">
            No GAD-Flagged Programs Found for {activeFyLabel}
          </h3>
          <p className="mx-auto mt-1.5 max-w-lg text-sm text-slate-500 dark:text-slate-400">
            Programs marked with <strong className="text-slate-700 dark:text-slate-200">GAD Fund? = Yes</strong> in the{' '}
            Programs and Activities workspace are automatically aggregated here to track LGU compliance with the 5% Gender and Development allocation target.
          </p>
          {canManagePrograms && onNavigateToPrograms && (
            <button
              type="button"
              onClick={onNavigateToPrograms}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white transition-colors"
            >
              <FolderKanban className="h-4 w-4" aria-hidden="true" />
              <span>Go to Programs and Activities</span>
            </button>
          )}
        </section>
      ) : (
        <>
          {/* Budget vs Expenditure Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 no-print">
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
                  GAD Program Budget vs. Expenditure
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Comparison of revised net appropriation and cumulative actual expenditure across top GAD programs
                </p>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={programChartData}
                    margin={{ top: 8, right: 12, left: 4, bottom: 28 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={isDark ? '#1E293B' : '#E2E8F0'}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: isDark ? '#94A3B8' : '#475569' }}
                      angle={-18}
                      textAnchor="end"
                      height={56}
                      interval={0}
                    />
                    <YAxis
                      tickFormatter={(v) => formatCompactPHP(Number(v))}
                      tick={{ fontSize: 11, fill: isDark ? '#94A3B8' : '#475569' }}
                      width={72}
                    />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [
                        formatPHP(Number(value)),
                        String(name),
                      ]}
                      labelFormatter={(_label, payload) =>
                        (payload?.[0]?.payload as { fullTitle?: string })?.fullTitle || ''
                      }
                      contentStyle={{
                        backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                        borderColor: isDark ? '#334155' : '#E2E8F0',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                        color: isDark ? '#F1F5F9' : '#0F172A',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '4px' }} />
                    <Bar
                      dataKey="revisedBudget"
                      name="Revised GAD Budget"
                      fill={isDark ? '#38BDF8' : '#163A5F'}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="expenditure"
                      name="Actual Expenditure"
                      fill={isDark ? '#2DD4BF' : '#0D9488'}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="mb-4">
                <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
                  GAD Budget &amp; Expenditure by Implementing Office
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Office-level distribution of GAD appropriations and financial utilization
                </p>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={officeBreakdownData}
                    margin={{ top: 8, right: 12, left: 4, bottom: 20 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={isDark ? '#1E293B' : '#E2E8F0'}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="officeCode"
                      tick={{ fontSize: 11, fill: isDark ? '#94A3B8' : '#475569' }}
                    />
                    <YAxis
                      tickFormatter={(v) => formatCompactPHP(Number(v))}
                      tick={{ fontSize: 11, fill: isDark ? '#94A3B8' : '#475569' }}
                      width={72}
                    />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [
                        formatPHP(Number(value)),
                        String(name),
                      ]}
                      labelFormatter={(_label, payload) =>
                        (payload?.[0]?.payload as { officeName?: string })?.officeName || ''
                      }
                      contentStyle={{
                        backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                        borderColor: isDark ? '#334155' : '#E2E8F0',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                        color: isDark ? '#F1F5F9' : '#0F172A',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '4px' }} />
                    <Bar
                      dataKey="budget"
                      name="Revised GAD Budget"
                      fill={isDark ? '#60A5FA' : '#2563EB'}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="expenditure"
                      name="Actual Expenditure"
                      fill={isDark ? '#34D399' : '#16A34A'}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* GAD Programs Ledger Table */}
          <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <h3 className="text-[17px] font-semibold text-slate-900 dark:text-slate-100">
                  GAD-Flagged Programs &amp; Attribution Ledger
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Showing {filteredGadPrograms.length} of {summary.gadPrograms.length} GAD-attributed programs · Click a row to inspect linked PPAs
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 no-print">
                <div className="relative min-w-[210px] flex-1 sm:flex-initial">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search AIP code, title, sector..."
                    aria-label="Search GAD programs"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                {!isOfficeScoped && gadOffices.length > 1 && (
                  <select
                    aria-label="Filter GAD programs by office"
                    value={officeFilter}
                    onChange={(e) => setOfficeFilter(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  >
                    <option value="ALL">All Implementing Offices</option>
                    {gadOffices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} — {o.name}
                      </option>
                    ))}
                  </select>
                )}

                <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5">
                  <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <select
                    aria-label="Sort GAD programs"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortKey)}
                    className="bg-transparent text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none"
                  >
                    <option value="budget_desc">Sort: Budget (High–Low)</option>
                    <option value="expenditure_desc">Sort: Expenditure (High–Low)</option>
                    <option value="utilization_desc">Sort: Utilization %</option>
                    <option value="aip_asc">Sort: AIP Ref Code</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/70 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                    <th className="py-3 pl-4 pr-2 w-8" aria-label="Expand" />
                    <th className="py-3 px-3 whitespace-nowrap">AIP Ref Code</th>
                    <th className="py-3 px-3">Program Title &amp; Metadata</th>
                    <th className="py-3 px-3">Implementing Office</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">PPAs</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Approved Budget</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Revised Budget</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Expenditure</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Remaining</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">Utilization %</th>
                    <th className="py-3 pr-5 pl-3 text-right whitespace-nowrap">% of LGU Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredGadPrograms.length === 0 ? (
                    <tr>
                      <td
                        colSpan={11}
                        className="py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        No GAD-flagged programs match the current search or office filter.
                      </td>
                    </tr>
                  ) : (
                    filteredGadPrograms.map((row) => {
                      const p = row.program;
                      const isExpanded = expandedProgramIds.has(p.id);
                      const childActivities = fyActivities.filter(
                        (a) => a.programId === p.id || a.subprogramId === p.id
                      );
                      const progShareOfLgu =
                        summary.totalBudgetApproved > 0
                          ? round2((row.approvedBudget / summary.totalBudgetApproved) * 100)
                          : 0;
                      const fullSummary = summarizeProgram(p, fyActivities);

                      return (
                        <Fragment key={p.id}>
                          <tr
                            onClick={() => toggleExpandProgram(p.id)}
                            className="cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-3 pl-4 pr-2 text-slate-400">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono font-semibold text-[#163A5F] dark:text-sky-400 whitespace-nowrap">
                              {p.aipRefCode}
                            </td>
                            <td className="py-3 px-3 min-w-[240px]">
                              <p className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                {p.title}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                {p.sector || 'General Public Services'}
                                <span aria-hidden="true"> · </span>
                                FY {p.fiscalYear}
                                {p.sourceOfFund ? (
                                  <>
                                    <span aria-hidden="true"> · </span>
                                    <span>{p.sourceOfFund}</span>
                                  </>
                                ) : null}
                              </p>
                            </td>
                            <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                              {p.officeName}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {row.activityCount}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {formatPHP(row.approvedBudget)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {formatPHP(row.revisedBudget)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-[#0D9488] dark:text-teal-400 font-medium">
                              {formatPHP(row.annualFinancialActual)}
                            </td>
                            <td
                              className={`py-3 px-3 text-right font-mono tabular-nums ${
                                row.remainingBudget < 0
                                  ? 'text-[#DC2626] dark:text-red-400 font-semibold'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {formatPHP(row.remainingBudget)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <span
                                className={`font-semibold ${
                                  row.budgetUtilizationPct > 100
                                    ? 'text-[#DC2626] dark:text-red-400'
                                    : row.budgetUtilizationPct >= 75
                                      ? 'text-[#16A34A] dark:text-emerald-400'
                                      : 'text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                {formatPct(row.budgetUtilizationPct)}
                              </span>
                            </td>
                            <td className="py-3 pr-5 pl-3 text-right font-mono font-semibold tabular-nums text-[#163A5F] dark:text-sky-400">
                              {formatPct(progShareOfLgu)}
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                              <td colSpan={11} className="px-6 py-4">
                                {childActivities.length === 0 ? (
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    No individual PPA activities encoded under this GAD program yet. Appropriations and targets are currently tracked at the program level.
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                      Linked Projects &amp; Activities ({childActivities.length})
                                    </p>
                                    <div className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900">
                                      <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-semibold">
                                            <th className="py-2 px-3">Ref Code</th>
                                            <th className="py-2 px-3">PPA Description</th>
                                            <th className="py-2 px-3">Office</th>
                                            <th className="py-2 px-3 text-right">Budget</th>
                                            <th className="py-2 px-3 text-right">Expenditure</th>
                                            <th className="py-2 px-3 text-right">Phys %</th>
                                            <th className="py-2 px-3">Status</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                          {childActivities.map((act) => {
                                            const bd = resolveActivityBudgetDisplay(
                                              act,
                                              p,
                                              fullSummary
                                            );
                                            return (
                                              <tr key={act.id}>
                                                <td className="py-2 px-3 font-mono font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                                  {act.referenceNumber}
                                                </td>
                                                <td className="py-2 px-3 text-slate-800 dark:text-slate-200">
                                                  {act.description}
                                                </td>
                                                <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                                                  {act.officeName}
                                                </td>
                                                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                                                  {bd.isProgramBudget
                                                    ? 'Program-level'
                                                    : formatPHP(bd.revisedBudget)}
                                                </td>
                                                <td className="py-2 px-3 text-right font-mono tabular-nums text-[#0D9488] dark:text-teal-400">
                                                  {formatPHP(act.annualFinancialActual)}
                                                </td>
                                                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                                  {formatPct(act.physicalAccomplishmentPct)}
                                                </td>
                                                <td className="py-2 px-3">
                                                  <StatusBadge status={act.status} compact />
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
                {filteredGadPrograms.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 font-semibold text-slate-900 dark:text-slate-100">
                      <td className="py-3 pl-4 pr-2" />
                      <td className="py-3 px-3 font-mono text-xs">TOTAL</td>
                      <td className="py-3 px-3 text-xs">
                        {filteredGadPrograms.length} GAD-Attributed{' '}
                        {filteredGadPrograms.length === 1 ? 'Program' : 'Programs'}
                      </td>
                      <td className="py-3 px-3" />
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {filteredTotals.activityCount}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatPHP(filteredTotals.approved)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatPHP(filteredTotals.revised)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-[#0D9488] dark:text-teal-400">
                        {formatPHP(filteredTotals.expenditure)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatPHP(filteredTotals.remaining)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatPct(filteredTotals.utilizationPct)}
                      </td>
                      <td className="py-3 pr-5 pl-3 text-right font-mono tabular-nums text-[#163A5F] dark:text-sky-400">
                        {formatPct(filteredTotals.shareOfLguPct)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
