import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
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
  onUpdateStatus: (
    activity: Activity,
    newStatus: ImplementationStatus,
    remarks: string
  ) => Promise<void>;
}

function computeRemarksRows(text: string): number {
  const normalized = text || '';
  const lines = normalized.split('\n');
  let visualLines = 0;
  for (const line of lines) {
    visualLines += Math.max(1, Math.ceil(line.length / 42));
  }
  return Math.max(3, Math.min(10, visualLines));
}

export function AccomplishmentStatusModule({
  programs,
  activities,
  selectedFiscalYear,
  userRole,
  onUpdateStatus,
}: AccomplishmentStatusModuleProps) {
  const canEditRemarks = canEditStatusOrRemarks(userRole);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [remarksDrafts, setRemarksDrafts] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const savedTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(savedTimersRef.current)) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

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
    for (const a of fyActivities) {
      map[a.status] = (map[a.status] || 0) + 1;
    }
    return { total, map };
  }, [fyActivities]);

  const programMap = useMemo(
    () => new Map(programs.map((p) => [p.id, p])),
    [programs]
  );

  const programNameMap = useMemo(
    () => new Map(programs.map((p) => [p.id, p.title])),
    [programs]
  );

  const programSummaryMap = useMemo(
    () => new Map(programs.map((p) => [p.id, summarizeProgram(p, activities)])),
    [programs, activities]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fyActivities.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (q) {
        const hay = `${a.referenceNumber} ${a.description} ${a.officeName} ${a.remarks || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [fyActivities, statusFilter, search]);

  const handleRemarksChange = (id: string, value: string) => {
    setRemarksDrafts((prev) => ({ ...prev, [id]: value }));
    setSavedIds((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleSaveRemarks = async (act: ActivityComputed, overrideValue?: string) => {
    if (savingIds[act.id]) return;
    const rawDraft = overrideValue ?? remarksDrafts[act.id];
    if (rawDraft === undefined) return;

    const normalizedNext = rawDraft.replace(/\r\n/g, '\n');
    const normalizedCurrent = (act.remarks || '').replace(/\r\n/g, '\n');

    if (normalizedNext === normalizedCurrent) {
      setRemarksDrafts((prev) => {
        if (!(act.id in prev)) return prev;
        const next = { ...prev };
        delete next[act.id];
        return next;
      });
      return;
    }

    setSavingIds((prev) => ({ ...prev, [act.id]: true }));
    try {
      await onUpdateStatus(act, act.status, normalizedNext);
      setRemarksDrafts((prev) => {
        const next = { ...prev };
        delete next[act.id];
        return next;
      });
      setSavedIds((prev) => ({ ...prev, [act.id]: true }));
      if (savedTimersRef.current[act.id]) {
        window.clearTimeout(savedTimersRef.current[act.id]);
      }
      savedTimersRef.current[act.id] = window.setTimeout(() => {
        setSavedIds((prev) => {
          const next = { ...prev };
          delete next[act.id];
          return next;
        });
      }, 2500);
    } catch {
      /* Error notification handled in parent handler; keep user's draft intact */
    } finally {
      setSavingIds((prev) => {
        const next = { ...prev };
        delete next[act.id];
        return next;
      });
    }
  };

  const handleDiscardRemarks = (id: string) => {
    setRemarksDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
      {/* Status Distribution Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ status, color, bg, border, Icon }) => {
          const count = counts.map[status];
          const pct = counts.total > 0 ? (count / counts.total) * 100 : 0;
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
                  {formatPct(pct)}
                </span>
              </div>
              <p className="mt-2 font-mono text-[28px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                {count}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Click to {isSelected ? 'show all statuses' : `filter ${status.toLowerCase()}`}
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
            placeholder="Search reference code, activity, office, or remarks..."
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
          />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Remarks support complete multi-line text and save automatically on blur or via Save Remarks.
        </p>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                <th className="py-3 px-4">Ref No.</th>
                <th className="py-3 px-4">Project / Activity &amp; Program</th>
                <th className="py-3 px-4 text-right">Accomplishment</th>
                <th className="py-3 px-4 text-right">Revised Budget</th>
                <th className="py-3 px-4 text-right">Fin. %</th>
                <th className="py-3 px-4">Current Status</th>
                <th className="py-3 px-4 min-w-[300px]">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[13px] text-slate-800 dark:text-slate-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No activities found.
                  </td>
                </tr>
              ) : (
                filtered.map((act) => {
                  const parentProg = programMap.get(act.programId);
                  const bd = resolveActivityBudgetDisplay(
                    act,
                    parentProg,
                    programSummaryMap.get(act.programId)
                  );
                  const savedRemarks = act.remarks || '';
                  const draftValue = remarksDrafts[act.id] ?? savedRemarks;
                  const isDirty =
                    remarksDrafts[act.id] !== undefined &&
                    draftValue.replace(/\r\n/g, '\n') !== savedRemarks.replace(/\r\n/g, '\n');
                  const isSaving = Boolean(savingIds[act.id]);
                  const isSaved = Boolean(savedIds[act.id]);

                  return (
                    <tr key={act.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
                      <td className="py-3 px-4 font-mono text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {act.referenceNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100 leading-snug">
                          {act.description}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {programNameMap.get(act.programId) || 'Program'} · {act.officeName}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-[#163A5F] dark:text-sky-400 tabular-nums whitespace-nowrap">
                        {formatPct(bd.accomplishmentPct)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {formatPHP(bd.revisedBudget)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium tabular-nums whitespace-nowrap">
                        {formatPct(act.financialAccomplishmentPct)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusBadge status={act.status} />
                      </td>
                      <td className="py-3 px-4 min-w-[300px] max-w-lg">
                        <div className="space-y-1.5">
                          <textarea
                            aria-label={`Remarks for ${act.referenceNumber}`}
                            rows={computeRemarksRows(draftValue)}
                            value={draftValue}
                            disabled={isSaving || !canEditRemarks}
                            onChange={(e) => handleRemarksChange(act.id, e.target.value)}
                            onBlur={(e) => {
                              if (canEditRemarks && isDirty && !isSaving) {
                                void handleSaveRemarks(act, e.currentTarget.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (canEditRemarks && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                void handleSaveRemarks(act, e.currentTarget.value);
                              }
                            }}
                            placeholder={
                              canEditRemarks
                                ? 'Enter detailed multi-line accomplishment remarks or observations...'
                                : 'Read-only remarks'
                            }
                            className={`no-print w-full resize-y rounded-lg border px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none transition-colors ${
                              isDirty
                                ? 'border-[#2563EB] bg-blue-50/30 dark:bg-sky-950/20'
                                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 focus:border-[#2563EB]'
                            } disabled:opacity-60`}
                          />
                          <div className="hidden print:block text-[12px] leading-relaxed whitespace-pre-wrap break-words text-slate-800">
                            {draftValue.trim() || '—'}
                          </div>
                          {canEditRemarks && (isDirty || isSaving || isSaved) && (
                            <div className="no-print flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {isSaving
                                  ? 'Saving remarks...'
                                  : isSaved
                                    ? 'Remarks saved'
                                    : 'Unsaved changes (Ctrl+Enter or click outside to save)'}
                              </span>
                              {isDirty && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => handleDiscardRemarks(act.id)}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                                  >
                                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                    <span>Discard</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => void handleSaveRemarks(act)}
                                    className="inline-flex items-center gap-1 rounded-md bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                                  >
                                    <Save className="h-3 w-3" aria-hidden="true" />
                                    <span>{isSaving ? 'Saving...' : 'Save Remarks'}</span>
                                  </button>
                                </div>
                              )}
                              {!isDirty && isSaved && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Saved</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
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
