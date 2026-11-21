import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RotateCcw,
  Save,
  Search,
  XCircle,
} from 'lucide-react';
import {
  Activity,
  ActivityComputed,
  ImplementationStatus,
  Program,
  UserRole,
} from '../../types/ppa';
import {
  STATUS_OPTIONS,
  formatPHP,
  formatPct,
  resolveActivityBudgetDisplay,
  summarizeProgram,
} from '../../utils/calculations';
import { StatusBadge } from '../ui/StatusBadge';
import { canEditStatusOrRemarks } from '../../utils/rbac';

interface AccomplishmentStatusModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  selectedFiscalYear: string;
  userRole: UserRole;
  userUid: string;
  onUpdateProgram?: (program: Program) => Promise<void>;
  onUpdateStatus: (
    activity: Activity,
    newStatus: ImplementationStatus,
    remarks: string,
    completionPct?: number
  ) => Promise<void>;
}

interface ActivityProgressDraft {
  status: ImplementationStatus;
  completionPct: number;
  remarks: string;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function computeRemarksRows(text: string): number {
  const normalized = text || '';
  const lines = normalized.split('\n');
  let visualLines = 0;
  for (const line of lines) {
    visualLines += Math.max(1, Math.ceil(line.length / 42));
  }
  return Math.max(2, Math.min(8, visualLines));
}

export function AccomplishmentStatusModule({
  programs,
  activities,
  selectedFiscalYear,
  userRole,
  onUpdateStatus,
}: AccomplishmentStatusModuleProps) {
  const canEditStatusRemarks = canEditStatusOrRemarks(userRole);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [collapsedProgramIds, setCollapsedProgramIds] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ActivityProgressDraft>>({});
  const [savingActIds, setSavingActIds] = useState<Record<string, boolean>>({});
  const [savedActIds, setSavedActIds] = useState<Record<string, boolean>>({});
  const savedTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(savedTimersRef.current)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const fyPrograms = useMemo(
    () =>
      programs
        .filter((p) => selectedFiscalYear === 'ALL' || p.fiscalYear === selectedFiscalYear)
        .sort((a, b) => a.orderIndex - b.orderIndex || a.aipRefCode.localeCompare(b.aipRefCode)),
    [programs, selectedFiscalYear]
  );

  const fyActivities = useMemo(
    () =>
      activities.filter(
        (a) => selectedFiscalYear === 'ALL' || a.fiscalYear === selectedFiscalYear
      ),
    [activities, selectedFiscalYear]
  );

  const counts = useMemo(() => {
    const total = fyActivities.length;
    const map: Record<ImplementationStatus, number> = {
      COMPLETED: 0,
      'ON-GOING': 0,
      PENDING: 0,
      'NOT IMPLEMENTED': 0,
    };
    const pctSums: Record<ImplementationStatus, number> = {
      COMPLETED: 0,
      'ON-GOING': 0,
      PENDING: 0,
      'NOT IMPLEMENTED': 0,
    };
    for (const a of fyActivities) {
      const st = a.status || 'PENDING';
      map[st] = (map[st] || 0) + 1;
      pctSums[st] = (pctSums[st] || 0) + clampPct(a.completionPct ?? 0);
    }
    return { total, map, pctSums };
  }, [fyActivities]);

  const activitiesByProgram = useMemo(() => {
    const map = new Map<string, ActivityComputed[]>();
    for (const a of fyActivities) {
      const list = map.get(a.programId);
      if (list) list.push(a);
      else map.set(a.programId, [a]);
    }
    return map;
  }, [fyActivities]);

  const programSummaryMap = useMemo(
    () =>
      new Map(
        fyPrograms.map((p) => [p.id, summarizeProgram(p, activitiesByProgram.get(p.id) || [])])
      ),
    [fyPrograms, activitiesByProgram]
  );

  const filteredPrograms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fyPrograms
      .map((p) => {
        const progActs = activitiesByProgram.get(p.id) || [];
        const matchingActs = progActs.filter((a) => {
          const st = a.status || 'PENDING';
          if (statusFilter !== 'ALL' && st !== statusFilter) return false;
          if (q) {
            const hay = `${p.aipRefCode} ${p.title} ${p.officeName} ${a.referenceNumber} ${a.description} ${a.remarks || ''} ${st}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const programMatchesQuery =
          !q ||
          `${p.aipRefCode} ${p.title} ${p.officeName} ${p.sourceOfFund || ''}`
            .toLowerCase()
            .includes(q);

        if (statusFilter !== 'ALL') {
          if (matchingActs.length === 0) return null;
          return { program: p, activities: matchingActs };
        }

        if (q && !programMatchesQuery && matchingActs.length === 0) {
          return null;
        }

        return {
          program: p,
          activities: q && !programMatchesQuery ? matchingActs : progActs,
        };
      })
      .filter((item): item is { program: Program; activities: ActivityComputed[] } => item !== null);
  }, [fyPrograms, statusFilter, search, activitiesByProgram]);

  const anyExpanded = useMemo(
    () =>
      filteredPrograms.some(
        ({ program, activities: pActs }) =>
          pActs.length > 0 && !collapsedProgramIds[program.id]
      ),
    [filteredPrograms, collapsedProgramIds]
  );

  const handleToggleExpandAll = () => {
    if (anyExpanded) {
      const next: Record<string, boolean> = {};
      for (const { program, activities: pActs } of filteredPrograms) {
        if (pActs.length > 0) next[program.id] = true;
      }
      setCollapsedProgramIds(next);
    } else {
      setCollapsedProgramIds({});
    }
  };

  const getDraft = (act: ActivityComputed): ActivityProgressDraft => {
    const existing = drafts[act.id];
    if (existing) return existing;
    return {
      status: act.status || 'PENDING',
      completionPct: clampPct(act.completionPct ?? 0),
      remarks: act.remarks || '',
    };
  };

  const updateDraft = (
    act: ActivityComputed,
    patch: Partial<ActivityProgressDraft>
  ) => {
    setDrafts((prev) => {
      const current = prev[act.id] ?? {
        status: act.status || 'PENDING',
        completionPct: clampPct(act.completionPct ?? 0),
        remarks: act.remarks || '',
      };
      return {
        ...prev,
        [act.id]: { ...current, ...patch },
      };
    });
    setSavedActIds((prev) => {
      if (!prev[act.id]) return prev;
      const next = { ...prev };
      delete next[act.id];
      return next;
    });
  };

  const isActivityDirty = (act: ActivityComputed, draft: ActivityProgressDraft): boolean => {
    const savedStatus = act.status || 'PENDING';
    const savedPct = clampPct(act.completionPct ?? 0);
    const savedRemarks = (act.remarks || '').replace(/\r\n/g, '\n');
    const draftRemarks = draft.remarks.replace(/\r\n/g, '\n');
    return (
      draft.status !== savedStatus ||
      clampPct(draft.completionPct) !== savedPct ||
      draftRemarks !== savedRemarks
    );
  };

  const handleSaveActivityProgress = async (
    act: ActivityComputed,
    overrideDraft?: ActivityProgressDraft
  ) => {
    if (savingActIds[act.id]) return;
    const draft = overrideDraft ?? getDraft(act);
    if (!isActivityDirty(act, draft)) {
      setDrafts((prev) => {
        if (!(act.id in prev)) return prev;
        const next = { ...prev };
        delete next[act.id];
        return next;
      });
      return;
    }

    const normalizedRemarks = draft.remarks.replace(/\r\n/g, '\n');
    const normalizedPct = clampPct(draft.completionPct);

    setSavingActIds((prev) => ({ ...prev, [act.id]: true }));
    try {
      await onUpdateStatus(act, draft.status, normalizedRemarks, normalizedPct);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[act.id];
        return next;
      });
      setSavedActIds((prev) => ({ ...prev, [act.id]: true }));
      const timerKey = `act:${act.id}`;
      if (savedTimersRef.current[timerKey]) {
        window.clearTimeout(savedTimersRef.current[timerKey]);
      }
      savedTimersRef.current[timerKey] = window.setTimeout(() => {
        setSavedActIds((prev) => {
          const next = { ...prev };
          delete next[act.id];
          return next;
        });
      }, 2500);
    } catch {
      /* Error notification handled in parent handler; keep user's draft intact */
    } finally {
      setSavingActIds((prev) => {
        const next = { ...prev };
        delete next[act.id];
        return next;
      });
    }
  };

  const handleDiscardDraft = (id: string) => {
    setDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const toggleExpandProgram = (progId: string) => {
    setCollapsedProgramIds((prev) => ({ ...prev, [progId]: !prev[progId] }));
  };

  const cards: {
    status: ImplementationStatus;
    color: string;
    bg: string;
    border: string;
    Icon: typeof CheckCircle2;
  }[] = [
    {
      status: 'COMPLETED',
      color: 'text-emerald-800 dark:text-emerald-300',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      border: 'border-emerald-200 dark:border-emerald-800',
      Icon: CheckCircle2,
    },
    {
      status: 'ON-GOING',
      color: 'text-blue-800 dark:text-sky-300',
      bg: 'bg-blue-50 dark:bg-sky-950/40',
      border: 'border-blue-200 dark:border-sky-800',
      Icon: Clock,
    },
    {
      status: 'PENDING',
      color: 'text-amber-800 dark:text-amber-300',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      border: 'border-amber-200 dark:border-amber-800',
      Icon: AlertCircle,
    },
    {
      status: 'NOT IMPLEMENTED',
      color: 'text-red-800 dark:text-red-300',
      bg: 'bg-red-50 dark:bg-red-950/40',
      border: 'border-red-200 dark:border-red-800',
      Icon: XCircle,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Activity Completion Distribution Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ status, color, bg, border, Icon }) => {
          const count = counts.map[status];
          const sharePct = counts.total > 0 ? (count / counts.total) * 100 : 0;
          const avgCompletion = count > 0 ? counts.pctSums[status] / count : 0;
          const isSelected = statusFilter === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(isSelected ? 'ALL' : status)}
              className={`text-left rounded-xl border p-4 transition-all shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
                isSelected
                  ? `${border} ${bg}`
                  : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${color}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{status}</span>
                </span>
                <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                  {formatPct(sharePct)}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <p className="font-mono text-[28px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                  {count}
                </p>
                {count > 0 && (
                  <span className="font-mono text-xs font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                    Avg {formatPct(avgCompletion)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {count === 1 ? 'Activity' : 'Activities'} · Click to{' '}
                {isSelected ? 'show all' : `filter ${status.toLowerCase()}`}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="relative min-w-0 sm:min-w-[240px] w-full sm:w-auto flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search AIP ref, program, activity, office, or remarks..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Specify activity completion status and percentage complete (0%–100%) alongside remarks.
          </p>
          <button
            type="button"
            onClick={handleToggleExpandAll}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            {anyExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      </div>

      {/* Programs & Activity Completion Tracking Table */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-3 px-4 w-9" aria-label="Expand activity completion tracking" />
                <th className="py-3 px-4">AIP Ref</th>
                <th className="py-3 px-4">Program Title &amp; Implementing Office</th>
                <th className="py-3 px-4 text-right">Activities</th>
                <th className="py-3 px-4 text-right">Revised Budget</th>
                <th className="py-3 px-4 text-right">Phys. %</th>
                <th className="py-3 px-4 text-right">Fin. %</th>
                <th className="py-3 px-4 min-w-[180px]">Avg. Completion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[13px] text-slate-800 dark:text-slate-200">
              {filteredPrograms.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No programs or activities found for the selected filter.
                  </td>
                </tr>
              ) : (
                filteredPrograms.map(({ program: prog, activities: progActs }) => {
                  const progSummary = programSummaryMap.get(prog.id);
                  const isExpanded = progActs.length > 0 && !collapsedProgramIds[prog.id];
                  const avgCompletionPct =
                    progActs.length > 0
                      ? progActs.reduce((sum, a) => sum + clampPct(a.completionPct ?? 0), 0) /
                        progActs.length
                      : 0;

                  return (
                    <Fragment key={prog.id}>
                      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-middle">
                        <td className="py-3 px-4">
                          {progActs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleExpandProgram(prog.id)}
                              className="rounded-md p-1 text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors"
                              aria-label={
                                isExpanded
                                  ? `Collapse activities under ${prog.title}`
                                  : `Expand activities under ${prog.title}`
                              }
                              title={
                                isExpanded
                                  ? 'Hide activity completion controls'
                                  : 'Show activity completion controls'
                              }
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-[#163A5F] dark:text-sky-400 whitespace-nowrap">
                          {prog.aipRefCode}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                            {prog.title}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            FY {prog.fiscalYear} · {prog.officeName}
                            {prog.sourceOfFund ? ` · ${prog.sourceOfFund}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium tabular-nums whitespace-nowrap">
                          {progActs.length}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                          {formatPHP(progSummary?.revisedBudget ?? 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-[#163A5F] dark:text-sky-400 tabular-nums whitespace-nowrap">
                          {progSummary && progSummary.annualPhysicalTarget > 0
                            ? formatPct(progSummary.physicalAccomplishmentPct)
                            : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-[#163A5F] dark:text-sky-400 tabular-nums whitespace-nowrap">
                          {formatPct(progSummary?.budgetUtilizationPct ?? 0)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {progActs.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    avgCompletionPct >= 100
                                      ? 'bg-emerald-600 dark:bg-emerald-400'
                                      : 'bg-[#163A5F] dark:bg-sky-400'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, avgCompletionPct))}%` }}
                                />
                              </div>
                              <span className="w-14 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                                {formatPct(avgCompletionPct)}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>

                      {isExpanded && progActs.length > 0 && (
                        <tr className="bg-slate-50/70 dark:bg-slate-800/30">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                              <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Activity Completion Tracking &amp; Remarks ({progActs.length})
                              </div>
                              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                {progActs.map((act) => {
                                  const bd = resolveActivityBudgetDisplay(act, prog, progSummary);
                                  const draft = getDraft(act);
                                  const isDirty = isActivityDirty(act, draft);
                                  const isSavingAct = Boolean(savingActIds[act.id]);
                                  const isSavedAct = Boolean(savedActIds[act.id]);

                                  return (
                                    <div
                                      key={act.id}
                                      className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start"
                                    >
                                      {/* Activity Summary */}
                                      <div className="lg:col-span-4 space-y-1">
                                        <p className="font-mono text-xs font-semibold text-[#2563EB] dark:text-sky-400">
                                          {act.referenceNumber}
                                        </p>
                                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                          {act.description}
                                        </p>
                                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                          Expenditure: {formatPHP(bd.expenditure)} · Fin:{' '}
                                          {formatPct(bd.accomplishmentPct)}
                                        </p>
                                      </div>

                                      {/* Status + Percentage Complete */}
                                      <div className="lg:col-span-4 space-y-2.5">
                                        <div>
                                          <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                                            Completion Status
                                          </label>
                                          <div className="flex flex-wrap items-center gap-2">
                                            {canEditStatusRemarks ? (
                                              <select
                                                aria-label={`Completion status for ${act.referenceNumber}`}
                                                value={draft.status}
                                                disabled={isSavingAct}
                                                onChange={(e) => {
                                                  const nextStatus = e.target
                                                    .value as ImplementationStatus;
                                                  const nextPct =
                                                    nextStatus === 'COMPLETED' &&
                                                    draft.completionPct === 0
                                                      ? 100
                                                      : draft.completionPct;
                                                  updateDraft(act, {
                                                    status: nextStatus,
                                                    completionPct: nextPct,
                                                  });
                                                }}
                                                className="no-print rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-50"
                                              >
                                                {STATUS_OPTIONS.map((s) => (
                                                  <option key={s} value={s}>
                                                    {s}
                                                  </option>
                                                ))}
                                              </select>
                                            ) : null}
                                            <StatusBadge status={draft.status} compact />
                                          </div>
                                        </div>

                                        <div>
                                          <div className="flex items-center justify-between gap-2 mb-1">
                                            <label
                                              htmlFor={`pct-${act.id}`}
                                              className="text-[11px] font-medium text-slate-600 dark:text-slate-400"
                                            >
                                              Percentage Complete
                                            </label>
                                            <div className="flex items-center gap-1">
                                              <input
                                                id={`pct-${act.id}`}
                                                type="number"
                                                min={0}
                                                max={100}
                                                step={1}
                                                value={draft.completionPct}
                                                disabled={isSavingAct || !canEditStatusRemarks}
                                                onChange={(e) => {
                                                  const raw = e.target.value;
                                                  const parsed = raw === '' ? 0 : Number(raw);
                                                  updateDraft(act, {
                                                    completionPct: clampPct(parsed),
                                                  });
                                                }}
                                                className="no-print w-16 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-0.5 text-right font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
                                                aria-label={`Percentage complete for ${act.referenceNumber}`}
                                              />
                                              <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                %
                                              </span>
                                            </div>
                                          </div>
                                          {canEditStatusRemarks && (
                                            <input
                                              type="range"
                                              min={0}
                                              max={100}
                                              step={1}
                                              value={draft.completionPct}
                                              disabled={isSavingAct}
                                              onChange={(e) =>
                                                updateDraft(act, {
                                                  completionPct: clampPct(Number(e.target.value)),
                                                })
                                              }
                                              aria-label={`Percentage complete slider for ${act.referenceNumber}`}
                                              className="no-print w-full accent-[#163A5F] dark:accent-sky-400 cursor-pointer h-1.5"
                                            />
                                          )}
                                          <div className="mt-1 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full transition-all ${
                                                draft.completionPct >= 100
                                                  ? 'bg-emerald-600 dark:bg-emerald-400'
                                                  : draft.completionPct > 0
                                                    ? 'bg-[#2563EB] dark:bg-sky-400'
                                                    : 'bg-slate-400 dark:bg-slate-600'
                                              }`}
                                              style={{ width: `${clampPct(draft.completionPct)}%` }}
                                            />
                                          </div>
                                        </div>
                                      </div>

                                      {/* Remarks + Save Controls */}
                                      <div className="lg:col-span-4 space-y-1.5">
                                        <label
                                          htmlFor={`rem-${act.id}`}
                                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                                        >
                                          Activity Remarks
                                        </label>
                                        <textarea
                                          id={`rem-${act.id}`}
                                          aria-label={`Remarks for ${act.referenceNumber}`}
                                          rows={computeRemarksRows(draft.remarks)}
                                          value={draft.remarks}
                                          disabled={isSavingAct || !canEditStatusRemarks}
                                          onChange={(e) =>
                                            updateDraft(act, { remarks: e.target.value })
                                          }
                                          onKeyDown={(e) => {
                                            if (
                                              canEditStatusRemarks &&
                                              (e.metaKey || e.ctrlKey) &&
                                              e.key === 'Enter'
                                            ) {
                                              e.preventDefault();
                                              void handleSaveActivityProgress(act, {
                                                ...draft,
                                                remarks: e.currentTarget.value,
                                              });
                                            }
                                          }}
                                          placeholder={
                                            canEditStatusRemarks
                                              ? 'Enter multi-line remarks or progress notes...'
                                              : 'Read-only remarks'
                                          }
                                          className={`no-print w-full resize-y rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none transition-colors ${
                                            isDirty
                                              ? 'border-[#2563EB] bg-blue-50/30 dark:bg-sky-950/20'
                                              : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:border-[#2563EB]'
                                          } disabled:opacity-60`}
                                        />
                                        <div className="hidden print:block text-xs leading-relaxed whitespace-pre-wrap break-words text-slate-800">
                                          {draft.remarks.trim() || '—'}
                                        </div>
                                        {canEditStatusRemarks &&
                                          (isDirty || isSavingAct || isSavedAct) && (
                                            <div className="no-print flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                                {isSavingAct
                                                  ? 'Saving progress...'
                                                  : isSavedAct
                                                    ? 'Progress saved'
                                                    : 'Unsaved changes (Ctrl+Enter or click Save)'}
                                              </span>
                                              {isDirty && (
                                                <div className="flex items-center gap-1.5">
                                                  <button
                                                    type="button"
                                                    disabled={isSavingAct}
                                                    onClick={() => handleDiscardDraft(act.id)}
                                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                                  >
                                                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                                    <span>Discard</span>
                                                  </button>
                                                  <button
                                                    type="button"
                                                    disabled={isSavingAct}
                                                    onClick={() => void handleSaveActivityProgress(act)}
                                                    className="inline-flex items-center gap-1 rounded-md bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                                  >
                                                    <Save className="h-3 w-3" aria-hidden="true" />
                                                    <span>
                                                      {isSavingAct ? 'Saving...' : 'Save Progress'}
                                                    </span>
                                                  </button>
                                                </div>
                                              )}
                                              {!isDirty && isSavedAct && (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                                  <span>Saved</span>
                                                </span>
                                              )}
                                            </div>
                                          )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
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
    </div>
  );
}
