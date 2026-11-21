import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, ChevronDown, ChevronRight, Edit3, Save, Search, X } from 'lucide-react';
import {
  Activity,
  ActivityComputed,
  MonthKey,
  MonthlyMonitoringMap,
  Program,
  UserRole,
} from '../../types/ppa';
import {
  MONTHS,
  createEmptyMonthlyData,
  formatPHP,
  formatPct,
  formatQty,
  resolveActivityBudgetDisplay,
  round2,
  safeNum,
  summarizeProgram,
} from '../../utils/calculations';
import { StatusBadge } from '../ui/StatusBadge';
import { AccomplishmentProgress } from '../ui/AccomplishmentProgress';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { canEditPpaStructure } from '../../utils/rbac';

interface MonthlyMonitoringModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  selectedFiscalYear: string;
  userRole: UserRole;
  userUid: string;
  onUpdateActivity: (activity: Activity) => Promise<void>;
}

export function MonthlyMonitoringModule({
  programs,
  activities,
  selectedFiscalYear,
  userRole,
  userUid,
  onUpdateActivity,
}: MonthlyMonitoringModuleProps) {
  const canEncode = canEditPpaStructure(userRole);
  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('ALL');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  // Encoding modal state
  const [editingActivity, setEditingActivity] = useState<ActivityComputed | null>(null);
  const [draftMonthly, setDraftMonthly] = useState<MonthlyMonitoringMap>(createEmptyMonthlyData());
  const [saving, setSaving] = useState(false);
  const modalRef = useModalFocusTrap<HTMLDivElement>(
    Boolean(editingActivity),
    () => setEditingActivity(null)
  );

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
        const hay = `${a.referenceNumber} ${a.description} ${a.officeName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activities, selectedFiscalYear, programFilter, search]);

  const programMap = useMemo(
    () => new Map(programs.map((p) => [p.id, p])),
    [programs]
  );

  const programSummaryMap = useMemo(
    () => new Map(programs.map((p) => [p.id, summarizeProgram(p, activities)])),
    [programs, activities]
  );

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const openMonthlyEncoder = (act: ActivityComputed) => {
    setEditingActivity(act);
    setDraftMonthly(JSON.parse(JSON.stringify(act.monthly)) as MonthlyMonitoringMap);
  };

  const updateMonthField = (
    monthKey: MonthKey,
    field: 'physicalTarget' | 'financialTarget' | 'physicalActual' | 'financialActual',
    value: string
  ) => {
    const num = safeNum(value);
    setDraftMonthly((prev) => ({
      ...prev,
      [monthKey]: {
        ...prev[monthKey],
        [field]:
          field === 'financialTarget' || field === 'financialActual' ? round2(num) : num,
      },
    }));
  };

  // Live draft annual totals
  const draftTotals = useMemo(() => {
    let pt = 0;
    let ft = 0;
    let pa = 0;
    let fa = 0;
    for (const m of MONTHS) {
      const row = draftMonthly[m.key];
      pt += safeNum(row.physicalTarget);
      ft += safeNum(row.financialTarget);
      pa += safeNum(row.physicalActual);
      fa += safeNum(row.financialActual);
    }
    const pPct = pt > 0 ? round2((pa / pt) * 100) : 0;
    const fPct = ft > 0 ? round2((fa / ft) * 100) : 0;
    return {
      pt: Math.round(pt * 10000) / 10000,
      ft: round2(ft),
      pa: Math.round(pa * 10000) / 10000,
      fa: round2(fa),
      pPct,
      fPct,
    };
  }, [draftMonthly]);

  const handleSaveMonthly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingActivity) return;
    setSaving(true);
    try {
      await onUpdateActivity({
        ...editingActivity,
        monthly: draftMonthly,
        updatedBy: userUid,
        updatedAt: new Date().toISOString(),
      });
      setEditingActivity(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activity to monitor..."
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 py-1.5 text-sm"
            />
          </div>
          <select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm"
          >
            <option value="ALL">All Programs</option>
            {fyPrograms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.aipRefCode} · {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <Calendar className="h-4 w-4 text-[#0F294A] dark:text-sky-400" aria-hidden="true" />
          <span>Click any row chevron to expand Jan–Dec details</span>
        </div>
      </div>

      {/* Expandable Monthly Monitoring Table */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-3 px-3 w-8" />
                <th className="py-3 px-3">Ref No.</th>
                <th className="py-3 px-3 min-w-[240px]">Project / Activity Description</th>
                <th className="py-3 px-3">Accomplishment</th>
                <th className="py-3 px-3 text-right">Annual Phys. Target</th>
                <th className="py-3 px-3 text-right">Annual Phys. Actual</th>
                <th className="py-3 px-3 text-right">Phys. %</th>
                <th className="py-3 px-3 text-right">Annual Fin. Target</th>
                <th className="py-3 px-3 text-right">Annual Fin. Actual</th>
                <th className="py-3 px-3 text-right">Fin. %</th>
                <th className="py-3 px-3">Status</th>
                {canEncode && <th className="py-3 px-3 text-right">Encode</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs text-slate-800 dark:text-slate-200">
              {filteredActivities.length === 0 ? (
                <tr>
                  <td colSpan={canEncode ? 12 : 11} className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No activities found for monthly monitoring.
                  </td>
                </tr>
              ) : (
                filteredActivities.map((act) => {
                  const isOpen = Boolean(expandedRows[act.id]);
                  return (
                    <Fragment key={act.id}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => toggleExpand(act.id)}
                            className="rounded p-1 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                            aria-label={isOpen ? 'Collapse monthly breakdown' : 'Expand monthly breakdown'}
                          >
                            {isOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {act.referenceNumber}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{act.description}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{act.officeName}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <AccomplishmentProgress
                            activity={act}
                            program={programMap.get(act.programId)}
                            programSummary={programSummaryMap.get(act.programId)}
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatQty(act.annualPhysicalTarget)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                          {formatQty(act.annualPhysicalActual)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#0F294A] dark:text-sky-400 tabular-nums">
                          {formatPct(act.physicalAccomplishmentPct)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {formatPHP(act.annualFinancialTarget)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                          {formatPHP(act.annualFinancialActual)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#0F294A] dark:text-sky-400 tabular-nums">
                          {formatPct(act.financialAccomplishmentPct)}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={programMap.get(act.programId)?.status || act.status} compact />
                            {resolveActivityBudgetDisplay(
                              act,
                              programMap.get(act.programId),
                              programSummaryMap.get(act.programId)
                            ).remainingBudget < 0 && (
                              <span
                                title="Expenditure exceeds revised budget ceiling"
                                className="inline-flex items-center gap-1 rounded bg-red-100 dark:bg-red-950 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:text-red-300"
                              >
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                Over Ceiling
                              </span>
                            )}
                          </div>
                        </td>
                        {canEncode && (
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openMonthlyEncoder(act)}
                              className="inline-flex items-center gap-1 rounded border border-[#0F294A] dark:border-sky-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-[#0F294A] dark:text-sky-300 hover:bg-blue-50 dark:hover:bg-sky-950/60"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Encode</span>
                            </button>
                          </td>
                        )}
                      </tr>

                      {isOpen && (
                        <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                          <td colSpan={canEncode ? 12 : 11} className="p-4">
                            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                                    <th className="py-2 px-3">Metric</th>
                                    {MONTHS.map((m) => (
                                      <th key={m.key} className="py-2 px-2.5 text-right">
                                        {m.short}
                                      </th>
                                    ))}
                                    <th className="py-2 px-3 text-right bg-slate-200/70 dark:bg-slate-700/70">Annual Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                                  <tr>
                                    <td className="py-2 px-3 font-sans font-medium text-slate-700 dark:text-slate-300">
                                      Physical Target
                                    </td>
                                    {MONTHS.map((m) => (
                                      <td key={m.key} className="py-2 px-2.5 text-right">
                                        {formatQty(act.monthly[m.key].physicalTarget)}
                                      </td>
                                    ))}
                                    <td className="py-2 px-3 text-right font-bold bg-slate-50 dark:bg-slate-800/60">
                                      {formatQty(act.annualPhysicalTarget)}
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 px-3 font-sans font-medium text-[#0F294A] dark:text-sky-400">
                                      Physical Actual
                                    </td>
                                    {MONTHS.map((m) => (
                                      <td key={m.key} className="py-2 px-2.5 text-right font-semibold text-[#0F294A] dark:text-sky-400">
                                        {formatQty(act.monthly[m.key].physicalActual)}
                                      </td>
                                    ))}
                                    <td className="py-2 px-3 text-right font-bold text-[#0F294A] dark:text-sky-400 bg-slate-50 dark:bg-slate-800/60">
                                      {formatQty(act.annualPhysicalActual)}
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 px-3 font-sans font-medium text-slate-700 dark:text-slate-300">
                                      Financial Target
                                    </td>
                                    {MONTHS.map((m) => (
                                      <td key={m.key} className="py-2 px-2.5 text-right whitespace-nowrap">
                                        {formatPHP(act.monthly[m.key].financialTarget)}
                                      </td>
                                    ))}
                                    <td className="py-2 px-3 text-right font-bold bg-slate-50 dark:bg-slate-800/60 whitespace-nowrap">
                                      {formatPHP(act.annualFinancialTarget)}
                                    </td>
                                  </tr>
                                  <tr>
                                    <td className="py-2 px-3 font-sans font-medium text-blue-800 dark:text-sky-300">
                                      Financial Actual
                                    </td>
                                    {MONTHS.map((m) => (
                                      <td key={m.key} className="py-2 px-2.5 text-right font-semibold text-blue-800 dark:text-sky-300 whitespace-nowrap">
                                        {formatPHP(act.monthly[m.key].financialActual)}
                                      </td>
                                    ))}
                                    <td className="py-2 px-3 text-right font-bold text-blue-800 dark:text-sky-300 bg-slate-50 dark:bg-slate-800/60 whitespace-nowrap">
                                      {formatPHP(act.annualFinancialActual)}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Encoding Modal */}
      {editingActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 p-4 overflow-y-auto">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="monthly-encoding-title"
            className="my-6 w-full max-w-5xl rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl"
          >
            <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <p className="font-mono text-xs font-semibold text-[#0F294A] dark:text-sky-400">
                  {editingActivity.referenceNumber} · Revised Budget:{' '}
                  {formatPHP(
                    resolveActivityBudgetDisplay(
                      editingActivity,
                      programMap.get(editingActivity.programId),
                      programSummaryMap.get(editingActivity.programId)
                    ).revisedBudget
                  )}
                </p>
                <h3
                  id="monthly-encoding-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  Monthly Target &amp; Actual Encoding — {editingActivity.description}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Target Outputs: {editingActivity.targetOutputs}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingActivity(null)}
                aria-label="Close monthly encoding modal"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {(() => {
              const progSum = programSummaryMap.get(editingActivity.programId);
              const bd = resolveActivityBudgetDisplay(
                editingActivity,
                programMap.get(editingActivity.programId),
                progSum
              );
              const totalProgExp = progSum
                ? progSum.annualFinancialActual
                : editingActivity.annualFinancialActual;
              const otherSpend = bd.isProgramBudget
                ? Math.max(0, round2(totalProgExp - editingActivity.annualFinancialActual))
                : 0;
              const projectedExpenditure = round2(otherSpend + draftTotals.fa);
              const overage = round2(projectedExpenditure - bd.revisedBudget);
              if (overage <= 0) return null;
              return (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs text-red-800 dark:text-red-200 flex items-start gap-2.5"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold">Budget Ceiling Alert:</strong> Projected annual expenditure ({formatPHP(projectedExpenditure)}) exceeds the revised budget ({formatPHP(bd.revisedBudget)}) by <strong className="font-mono">{formatPHP(overage)}</strong>.
                  </span>
                </div>
              );
            })()}

            <form onSubmit={handleSaveMonthly} className="mt-4 space-y-4">
              <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#0F294A] dark:bg-slate-800 text-white font-semibold">
                      <th className="py-2.5 px-3">Month</th>
                      <th className="py-2.5 px-3">Physical Target</th>
                      <th className="py-2.5 px-3">Financial Target (₱)</th>
                      <th className="py-2.5 px-3">Physical Actual</th>
                      <th className="py-2.5 px-3">Financial Actual (₱)</th>
                      <th className="py-2.5 px-3 text-right">Phys. %</th>
                      <th className="py-2.5 px-3 text-right">Fin. %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {MONTHS.map((m) => {
                      const entry = draftMonthly[m.key];
                      const pPct =
                        entry.physicalTarget > 0
                          ? (entry.physicalActual / entry.physicalTarget) * 100
                          : 0;
                      const fPct =
                        entry.financialTarget > 0
                          ? (entry.financialActual / entry.financialTarget) * 100
                          : 0;
                      return (
                        <tr key={m.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{m.label}</td>
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              disabled={!canEncode}
                              value={entry.physicalTarget}
                              onChange={(e) =>
                                updateMonthField(m.key, 'physicalTarget', e.target.value)
                              }
                              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-right font-mono tabular-nums"
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!canEncode}
                              value={entry.financialTarget}
                              onChange={(e) =>
                                updateMonthField(m.key, 'financialTarget', e.target.value)
                              }
                              className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-right font-mono tabular-nums"
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              disabled={!canEncode}
                              value={entry.physicalActual}
                              onChange={(e) =>
                                updateMonthField(m.key, 'physicalActual', e.target.value)
                              }
                              className="w-full rounded border border-blue-300 dark:border-sky-700 bg-blue-50/40 dark:bg-sky-950/30 px-2.5 py-1.5 text-right font-mono font-semibold text-[#0F294A] dark:text-sky-300 tabular-nums"
                            />
                          </td>
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!canEncode}
                              value={entry.financialActual}
                              onChange={(e) =>
                                updateMonthField(m.key, 'financialActual', e.target.value)
                              }
                              className="w-full rounded border border-blue-300 dark:border-sky-700 bg-blue-50/40 dark:bg-sky-950/30 px-2.5 py-1.5 text-right font-mono font-semibold text-[#0F294A] dark:text-sky-300 tabular-nums"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatPct(pPct)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {formatPct(fPct)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100 border-t-2 border-slate-300 dark:border-slate-700">
                      <td className="py-2.5 px-3">ANNUAL TOTAL</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatQty(draftTotals.pt)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatPHP(draftTotals.ft)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#0F294A] dark:text-sky-400 tabular-nums">
                        {formatQty(draftTotals.pa)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#0F294A] dark:text-sky-400 tabular-nums">
                        {formatPHP(draftTotals.fa)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#0F294A] dark:text-sky-400 tabular-nums">
                        {formatPct(draftTotals.pPct)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[#0F294A] dark:text-sky-400 tabular-nums">
                        {formatPct(draftTotals.fPct)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Annual totals and percentages update automatically from January–December entries. Zero denominators safely compute as 0.00%.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingActivity(null)}
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  {canEncode && (
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#0F294A] dark:bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-[#163864] dark:hover:bg-sky-600 disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      <span>{saving ? 'Saving...' : 'Save Monthly Monitoring'}</span>
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
