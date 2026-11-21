import { useMemo, useState } from 'react';
import { Download, MessageSquarePlus, Search, Trash2 } from 'lucide-react';
import {
  ActivityComputed,
  ImplementationStatus,
  MonthlyMonitoringMap,
  Program,
  RemarkLog,
  UserAccount,
} from '../../types/ppa';
import {
  MONTHS,
  calculateRevisedBudgetByFund,
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
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  canAddEvaluationRemarks,
  isAdminRole,
  isOfficeScopedRole,
} from '../../utils/rbac';
import { buildAuditLog, dataService } from '../../services/dataService';
import { buildCsvBlob, sanitizeCsvFileSegment } from '../../utils/csvExport';
import { triggerBlobDownload } from '../../utils/excelService';

interface MonitoringEvaluationModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  remarksLogs: RemarkLog[];
  selectedFiscalYear: string;
  currentUser: UserAccount;
  onAddRemark: (remark: RemarkLog) => Promise<void>;
  onDeleteRemark: (id: string) => Promise<void>;
  onNotify?: (type: 'success' | 'error', msg: string) => void;
}

interface MergedPPAGroup {
  groupKey: string;
  primaryActivity: ActivityComputed;
  mergedActivity: ActivityComputed;
  activityIds: string[];
  refNumbers: string[];
  offices: string[];
  mergedCount: number;
}

function normalizePpaName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function resolveMergedStatus(items: ActivityComputed[]): ImplementationStatus {
  if (items.length === 1) return items[0].status;
  const statuses = new Set(items.map((i) => i.status));
  if (statuses.size === 1) return items[0].status;
  if (statuses.has('ON-GOING') || statuses.has('COMPLETED')) return 'ON-GOING';
  if (statuses.has('PENDING')) return 'PENDING';
  return items[0].status;
}

export function MonitoringEvaluationModule({
  programs,
  activities,
  remarksLogs,
  selectedFiscalYear,
  currentUser,
  onAddRemark,
  onDeleteRemark,
  onNotify,
}: MonitoringEvaluationModuleProps) {
  const canAddRemarks = canAddEvaluationRemarks(currentUser.role);
  const canDeleteAnyRemark =
    isAdminRole(currentUser.role) || isOfficeScopedRole(currentUser.role);

  const [search, setSearch] = useState('');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>('');
  const [observation, setObservation] = useState('');
  const [monitoringDate, setMonitoringDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const [confirmDeleteRemarkId, setConfirmDeleteRemarkId] = useState<string | null>(null);

  const programMap = useMemo(
    () => new Map(programs.map((p) => [p.id, p])),
    [programs]
  );

  const programSummaryMap = useMemo(
    () => new Map(programs.map((p) => [p.id, summarizeProgram(p, activities)])),
    [programs, activities]
  );

  const mergedGroups = useMemo<MergedPPAGroup[]>(() => {
    const groupsMap = new Map<string, ActivityComputed[]>();

    for (const a of activities) {
      if (selectedFiscalYear !== 'ALL' && a.fiscalYear !== selectedFiscalYear) {
        continue;
      }
      const key = `${a.fiscalYear}::${a.programId}::${normalizePpaName(a.description)}`;
      const bucket = groupsMap.get(key);
      if (bucket) {
        bucket.push(a);
      } else {
        groupsMap.set(key, [a]);
      }
    }

    const result: MergedPPAGroup[] = [];

    for (const [groupKey, groupItems] of groupsMap.entries()) {
      const primary = groupItems[0];
      const parentProg = programMap.get(primary.programId);

      const monthly: MonthlyMonitoringMap = createEmptyMonthlyData();
      let annualPhysicalTarget = 0;
      let annualPhysicalActual = 0;
      let annualFinancialTarget = 0;
      let annualFinancialActual = 0;

      for (const m of MONTHS) {
        let mPhysTarget = 0;
        let mPhysActual = 0;
        let mFinTarget = 0;
        let mFinActual = 0;

        for (const item of groupItems) {
          mPhysTarget += safeNum(item.monthly[m.key]?.physicalTarget);
          mPhysActual += safeNum(item.monthly[m.key]?.physicalActual);
          mFinTarget += safeNum(item.monthly[m.key]?.financialTarget);
          mFinActual += safeNum(item.monthly[m.key]?.financialActual);
        }

        if (mPhysTarget === 0 && parentProg?.monthlyPhysicalTarget?.[m.key]) {
          mPhysTarget = Math.max(0, safeNum(parentProg.monthlyPhysicalTarget[m.key]));
        }

        const roundedPhysTarget = Math.round(mPhysTarget * 10000) / 10000;
        const roundedPhysActual = Math.round(mPhysActual * 10000) / 10000;
        const roundedFinTarget = round2(mFinTarget);
        const roundedFinActual = round2(mFinActual);

        monthly[m.key] = {
          physicalTarget: roundedPhysTarget,
          physicalActual: roundedPhysActual,
          financialTarget: roundedFinTarget,
          financialActual: roundedFinActual,
        };

        annualPhysicalTarget += roundedPhysTarget;
        annualPhysicalActual += roundedPhysActual;
        annualFinancialTarget += roundedFinTarget;
        annualFinancialActual += roundedFinActual;
      }

      annualPhysicalTarget = Math.round(annualPhysicalTarget * 10000) / 10000;
      annualPhysicalActual = Math.round(annualPhysicalActual * 10000) / 10000;
      annualFinancialTarget = round2(annualFinancialTarget);
      annualFinancialActual = round2(annualFinancialActual);

      const gf = round2(groupItems.reduce((sum, item) => sum + item.gf, 0));
      const ps = round2(groupItems.reduce((sum, item) => sum + item.ps, 0));
      const mooe = round2(groupItems.reduce((sum, item) => sum + item.mooe, 0));
      const co = round2(groupItems.reduce((sum, item) => sum + item.co, 0));
      const approvedBudget = round2(gf + ps + mooe + co);
      const revisedBudget =
        approvedBudget > 0
          ? calculateRevisedBudgetByFund(
              approvedBudget,
              primary.sourceOfFund || primary.budgetClassification,
              { gf, ps, mooe, co }
            )
          : 0;

      const refNumbers = Array.from(
        new Set(groupItems.map((i) => i.referenceNumber).filter(Boolean))
      );
      const officeNames = Array.from(
        new Set(groupItems.map((i) => i.officeName).filter(Boolean))
      );
      const actualOutputsList = Array.from(
        new Set(groupItems.map((i) => i.targetOutputs.trim()).filter(Boolean))
      );
      const remarksList = Array.from(
        new Set(groupItems.map((i) => i.remarks.trim()).filter(Boolean))
      );

      const mergedActivity: ActivityComputed = {
        ...primary,
        referenceNumber: refNumbers.join(', '),
        officeName: officeNames.join(', '),
        targetOutputs: actualOutputsList.join(' / '),
        remarks: remarksList.join(' · '),
        status: programMap.get(primary.programId)?.status || resolveMergedStatus(groupItems),
        gf,
        ps,
        mooe,
        co,
        approvedBudget,
        revisedBudget,
        monthly,
        annualPhysicalTarget,
        annualPhysicalActual,
        annualFinancialTarget,
        annualFinancialActual,
        remainingBudget: round2(revisedBudget - annualFinancialActual),
        physicalAccomplishmentPct:
          annualPhysicalTarget > 0
            ? round2((annualPhysicalActual / annualPhysicalTarget) * 100)
            : 0,
        financialAccomplishmentPct:
          annualFinancialTarget > 0
            ? round2((annualFinancialActual / annualFinancialTarget) * 100)
            : 0,
        budgetUtilizationPct:
          revisedBudget > 0 ? round2((annualFinancialActual / revisedBudget) * 100) : 0,
      };

      result.push({
        groupKey,
        primaryActivity: primary,
        mergedActivity,
        activityIds: groupItems.map((i) => i.id),
        refNumbers,
        offices: officeNames,
        mergedCount: groupItems.length,
      });
    }

    const q = search.trim().toLowerCase();
    if (!q) return result;
    return result.filter((g) => {
      const act = g.mergedActivity;
      const progTitle = programMap.get(act.programId)?.title || '';
      const hay = `${act.referenceNumber} ${act.description} ${act.targetOutputs} ${act.officeName} ${progTitle}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activities, selectedFiscalYear, search, programMap]);

  const selectedGroup = useMemo(() => {
    return (
      mergedGroups.find((g) => g.groupKey === selectedGroupKey) ||
      mergedGroups[0] ||
      null
    );
  }, [mergedGroups, selectedGroupKey]);

  const selectedActivity = selectedGroup?.mergedActivity || null;

  const activityRemarks = useMemo(() => {
    if (!selectedGroup) return [];
    const idSet = new Set(selectedGroup.activityIds);
    return remarksLogs.filter((r) => idSet.has(r.activityId));
  }, [remarksLogs, selectedGroup]);

  const handleCreateRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !observation.trim()) return;
    setSaving(true);
    try {
      await onAddRemark({
        id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        activityId: selectedGroup.primaryActivity.id,
        authorUid: currentUser.uid,
        authorName: currentUser.displayName,
        authorRole: currentUser.role,
        observation: observation.trim(),
        monitoringDate,
        createdAt: new Date().toISOString(),
      });
      setObservation('');
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left Activity Selector */}
      <div className="lg:col-span-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col max-h-[360px] lg:max-h-[760px] shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Select PPA to evaluate..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {mergedGroups.length} {mergedGroups.length === 1 ? 'PPA' : 'PPAs'} available
          </p>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto flex-1">
          {mergedGroups.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No activities match your filter.
            </div>
          ) : (
            mergedGroups.map((group) => {
              const act = group.mergedActivity;
              const active = selectedGroup?.groupKey === group.groupKey;
              const parentProg = programMap.get(act.programId);
              const progSum = programSummaryMap.get(act.programId);
              const bd = resolveActivityBudgetDisplay(act, parentProg, progSum);
              return (
                <button
                  key={group.groupKey}
                  type="button"
                  onClick={() => setSelectedGroupKey(group.groupKey)}
                  className={`w-full text-left p-4 transition-colors ${
                    active ? 'bg-blue-50/80 dark:bg-sky-950/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-xs font-semibold text-[#163A5F] dark:text-sky-400 truncate">
                        {act.referenceNumber}
                      </span>
                      {group.mergedCount > 1 && (
                        <span className="shrink-0 rounded-md bg-blue-100 dark:bg-sky-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-[#163A5F] dark:text-sky-300">
                          Merged ({group.mergedCount})
                        </span>
                      )}
                    </div>
                    <StatusBadge status={act.status} compact />
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                    {act.description}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <AccomplishmentProgress
                      activity={act}
                      program={parentProg}
                      programSummary={progSum}
                      compact
                    />
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap">
                      Exp: {formatPHP(bd.expenditure)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Complete M&E Profile */}
      <div className="lg:col-span-8 space-y-6">
        {!selectedActivity || !selectedGroup ? (
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            Select an activity from the list to inspect its complete Monitoring &amp; Evaluation record.
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs font-semibold text-[#2563EB] dark:text-sky-400">
                      {selectedActivity.referenceNumber} ·{' '}
                      {programMap.get(selectedActivity.programId)?.title || 'Program'}
                    </p>
                    {selectedGroup.mergedCount > 1 && (
                      <span className="rounded-md bg-blue-100 dark:bg-sky-900/60 px-2 py-0.5 text-[10px] font-semibold text-[#163A5F] dark:text-sky-300">
                        {selectedGroup.mergedCount} PPA entries merged
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-[19px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
                    {selectedActivity.description}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    Office: {selectedActivity.officeName} · Actual Output:{' '}
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {selectedActivity.targetOutputs || '—'}
                    </span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={selectedActivity.status} />
                  <AccomplishmentProgress
                    activity={selectedActivity}
                    program={programMap.get(selectedActivity.programId)}
                    programSummary={programSummaryMap.get(selectedActivity.programId)}
                  />
                </div>
              </div>

              {/* Financial & Accomplishment Summary + Jan–Dec Table */}
              {(() => {
                const parentProg = programMap.get(selectedActivity.programId);
                const progSum = programSummaryMap.get(selectedActivity.programId);
                const bd = resolveActivityBudgetDisplay(selectedActivity, parentProg, progSum);
                const monthlyRows = MONTHS.reduce<
                  {
                    month: (typeof MONTHS)[number];
                    entry: (typeof selectedActivity.monthly)[typeof MONTHS[number]['key']];
                    totalExpenditure: number;
                    rawCumulativePct: number;
                    cappedAccompPct: number;
                  }[]
                >((acc, m) => {
                  const entry = selectedActivity.monthly[m.key];
                  const prevTotal = acc.length > 0 ? acc[acc.length - 1].totalExpenditure : 0;
                  const totalExpenditure = round2(prevTotal + safeNum(entry.financialActual));
                  const rawCumulativePct =
                    bd.revisedBudget > 0
                      ? round2((totalExpenditure / bd.revisedBudget) * 100)
                      : 0;
                  const cappedAccompPct = Math.min(100, Math.max(0, rawCumulativePct));
                  acc.push({
                    month: m,
                    entry,
                    totalExpenditure,
                    rawCumulativePct,
                    cappedAccompPct,
                  });
                  return acc;
                }, []);
                const finalTotalExpenditure =
                  monthlyRows.length > 0
                    ? monthlyRows[monthlyRows.length - 1].totalExpenditure
                    : 0;
                const finalCappedPct =
                  monthlyRows.length > 0
                    ? monthlyRows[monthlyRows.length - 1].cappedAccompPct
                    : 0;
                return (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Approved Budget</p>
                        <p className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatPHP(bd.approvedBudget)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Revised Budget</p>
                        <p className="mt-1 font-mono text-sm font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                          {formatPHP(bd.revisedBudget)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Remaining Budget</p>
                        <p
                          className={`mt-1 font-mono text-sm font-bold tabular-nums ${
                            bd.remainingBudget < 0
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {formatPHP(bd.remainingBudget)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Expenditure</p>
                        <p className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatPHP(bd.expenditure)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Accomplishment</p>
                        <p className="mt-1 font-mono text-sm font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                          {formatPct(bd.accomplishmentPct)}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Expenditure / Revised Budget × 100
                        </p>
                      </div>
                    </div>

                    {/* Complete Jan–Dec Table */}
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <table className="w-full text-left border-collapse text-[13px]">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                            <th className="py-2 px-3">Month</th>
                            <th className="py-2 px-3 text-right">Phys. Target</th>
                            <th className="py-2 px-3 text-right">Phys. Actual</th>
                            <th className="py-2 px-3 text-right">Expenditure</th>
                            <th className="py-2 px-3 text-right">Total Expenditure</th>
                            <th className="py-2 px-3 min-w-[160px]">Accomplishment</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {monthlyRows.map(
                            ({
                              month,
                              entry,
                              totalExpenditure,
                              rawCumulativePct,
                              cappedAccompPct,
                            }) => (
                              <tr key={month.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                <td className="py-1.5 px-3 font-sans font-medium text-slate-800 dark:text-slate-200">
                                  {month.label}
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  {formatQty(entry.physicalTarget)}
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                  {formatQty(entry.physicalActual)}
                                </td>
                                <td className="py-1.5 px-3 text-right font-semibold text-blue-800 dark:text-sky-300">
                                  {formatPHP(entry.financialActual)}
                                </td>
                                <td className="py-1.5 px-3 text-right font-semibold text-[#163A5F] dark:text-sky-200">
                                  {formatPHP(totalExpenditure)}
                                </td>
                                <td
                                  className="py-1.5 px-3"
                                  title={
                                    rawCumulativePct > 100
                                      ? `Cumulative Total Expenditure: ${formatPHP(totalExpenditure)} (${formatPct(rawCumulativePct)} of Revised Budget, capped at 100% on progress bar)`
                                      : `Cumulative Total Expenditure: ${formatPHP(totalExpenditure)} / ${formatPHP(bd.revisedBudget)} = ${formatPct(cappedAccompPct)}`
                                  }
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 flex-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          cappedAccompPct >= 100
                                            ? 'bg-emerald-600 dark:bg-emerald-400'
                                            : 'bg-[#163A5F] dark:bg-sky-400'
                                        }`}
                                        style={{ width: `${cappedAccompPct}%` }}
                                      />
                                    </div>
                                    <span className="w-14 text-right text-[10px] text-slate-700 dark:text-slate-300">
                                      {formatPct(cappedAccompPct)}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                            <td className="py-2 px-3 font-sans">Annual Total</td>
                            <td className="py-2 px-3 text-right">
                              {formatQty(selectedActivity.annualPhysicalTarget)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {formatQty(selectedActivity.annualPhysicalActual)}
                            </td>
                            <td className="py-2 px-3 text-right text-[#2563EB] dark:text-sky-300">
                              {formatPHP(selectedActivity.annualFinancialActual)}
                            </td>
                            <td className="py-2 px-3 text-right text-[#163A5F] dark:text-sky-300">
                              {formatPHP(finalTotalExpenditure)}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      finalCappedPct >= 100
                                        ? 'bg-emerald-600 dark:bg-emerald-400'
                                        : 'bg-[#163A5F] dark:bg-sky-400'
                                    }`}
                                    style={{
                                      width: `${Math.min(100, Math.max(0, bd.accomplishmentPct))}%`,
                                    }}
                                  />
                                </div>
                                <span className="w-14 text-right text-[10px] text-[#163A5F] dark:text-sky-400">
                                  {formatPct(bd.accomplishmentPct)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                );
              })()}

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">General Activity Remarks: </span>
                <span className="text-slate-600 dark:text-slate-400">
                  {selectedActivity.remarks || 'No general remarks recorded.'}
                </span>
              </div>
            </div>

            {/* Monitoring Personnel Observations & Remarks Log */}
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                    Monitoring Personnel Observations &amp; Field Notes
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activityRemarks.length}{' '}
                    {activityRemarks.length === 1 ? 'observation' : 'observations'} logged for this activity
                  </p>
                </div>
                <button
                  type="button"
                  disabled={activityRemarks.length === 0}
                  onClick={() => {
                    if (!selectedActivity || activityRemarks.length === 0) return;
                    const parentProgram = programMap.get(selectedActivity.programId);
                    const sortedHistory = [...activityRemarks].sort((a, b) =>
                      `${a.monitoringDate}-${a.createdAt}`.localeCompare(
                        `${b.monitoringDate}-${b.createdAt}`
                      )
                    );
                    const headers = [
                      'Remark ID',
                      'Reference Code',
                      'Activity Description',
                      'Program',
                      'Fiscal Year',
                      'Implementing Office',
                      'Monitoring Date',
                      'Author',
                      'Role',
                      'Observation',
                      'Logged At',
                    ];
                    const rows = sortedHistory.map((rem) => [
                      rem.id,
                      selectedActivity.referenceNumber || '',
                      selectedActivity.description,
                      parentProgram?.title || '',
                      selectedActivity.fiscalYear,
                      selectedActivity.officeName,
                      rem.monitoringDate,
                      rem.authorName,
                      rem.authorRole,
                      rem.observation,
                      rem.createdAt,
                    ]);
                    const blob = buildCsvBlob(headers, rows);
                    const safeRef = sanitizeCsvFileSegment(
                      selectedActivity.referenceNumber || selectedActivity.description
                    );
                    const dateStamp = new Date().toISOString().slice(0, 10);
                    const fileName = `LGU-Bula-Remarks-${safeRef}-${dateStamp}.csv`;
                    triggerBlobDownload(blob, fileName);
                    const audit = buildAuditLog(
                      currentUser,
                      'EXPORT',
                      'RemarkLog',
                      selectedActivity.id,
                      `Exported ${sortedHistory.length} M&E remarks for "${selectedActivity.description}" to CSV`,
                      fileName
                    );
                    void dataService.logAudit(audit).catch(() => {});
                    onNotify?.(
                      'success',
                      `Exported ${sortedHistory.length} remark${
                        sortedHistory.length === 1 ? '' : 's'
                      } to ${fileName}.`
                    );
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                  title="Export full remarks history for this activity as CSV"
                >
                  <Download className="h-3.5 w-3.5 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                  <span>Export Remarks CSV</span>
                </button>
              </div>

              {canAddRemarks && (
                <form onSubmit={handleCreateRemark} className="space-y-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-3">
                      <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                        Monitoring Observation / Findings *
                      </label>
                      <input
                        required
                        type="text"
                        value={observation}
                        onChange={(e) => setObservation(e.target.value)}
                        placeholder="Record field inspection findings, bottlenecks, or verification notes..."
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                        Monitoring Date
                      </label>
                      <input
                        type="date"
                        value={monitoringDate}
                        onChange={(e) => setMonitoringDate(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] dark:bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-[#1e4b7a] dark:hover:bg-sky-600 disabled:opacity-50 transition-colors"
                    >
                      <MessageSquarePlus className="h-4 w-4" />
                      <span>{saving ? 'Logging...' : 'Log Monitoring Remark'}</span>
                    </button>
                  </div>
                </form>
              )}

              {activityRemarks.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No field monitoring observations logged for this activity yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activityRemarks.map((rem) => (
                    <div key={rem.id} className="py-3 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-slate-800 dark:text-slate-200">{rem.observation}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {rem.authorName} ({rem.authorRole}) · Date: {rem.monitoringDate}
                        </p>
                      </div>
                      {(canDeleteAnyRemark ||
                        (currentUser.role === 'EVALUATOR' &&
                          rem.authorUid === currentUser.uid)) && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteRemarkId(rem.id)}
                          className="rounded-lg p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          title="Delete remark"
                          aria-label="Delete monitoring remark"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDeleteRemarkId)}
        title="Delete Monitoring Remark"
        message="Are you sure you want to remove this monitoring observation? This action will be recorded in the audit log."
        confirmLabel="Delete Remark"
        onCancel={() => setConfirmDeleteRemarkId(null)}
        onConfirm={async () => {
          if (confirmDeleteRemarkId) {
            await onDeleteRemark(confirmDeleteRemarkId);
          }
          setConfirmDeleteRemarkId(null);
        }}
      />
    </div>
  );
}
