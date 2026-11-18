import { Calendar, CheckCircle2, Clock, Flag, PlayCircle } from 'lucide-react';
import { ActivityComputed, MonthKey, Program } from '../../types/ppa';
import {
  ActivityBudgetDisplay,
  MONTHS,
  formatCompactPHP,
  formatPHP,
  formatPct,
  formatQty,
  safeNum,
} from '../../utils/calculations';

interface PpaTimelineChartProps {
  activity: ActivityComputed;
  program?: Program;
  budgetDisplay: ActivityBudgetDisplay;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getMonthIndexFromDate(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getMonth();
}

export function PpaTimelineChart({
  activity,
  program,
  budgetDisplay,
}: PpaTimelineChartProps) {
  const fyNum = parseInt(activity.fiscalYear, 10) || new Date().getFullYear();

  const activeMonthIndices = MONTHS.map((m, idx) => {
    const entry = activity.monthly[m.key];
    const hasActivity =
      safeNum(entry?.financialTarget) > 0 ||
      safeNum(entry?.physicalTarget) > 0 ||
      safeNum(entry?.financialActual) > 0 ||
      safeNum(entry?.physicalActual) > 0;
    return hasActivity ? idx : -1;
  }).filter((idx) => idx >= 0);

  const hasExplicitDates = Boolean(activity.startDate && activity.endDate);
  const inferredStartMonth = activeMonthIndices.length > 0 ? activeMonthIndices[0] : 0;
  const inferredEndMonth =
    activeMonthIndices.length > 0 ? activeMonthIndices[activeMonthIndices.length - 1] : 11;

  const startDate =
    activity.startDate ||
    `${fyNum}-${String(inferredStartMonth + 1).padStart(2, '0')}-01`;

  const lastDayOfEndMonth = new Date(fyNum, inferredEndMonth + 1, 0).getDate();
  const endDate =
    activity.endDate ||
    `${fyNum}-${String(inferredEndMonth + 1).padStart(2, '0')}-${String(lastDayOfEndMonth).padStart(2, '0')}`;

  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  const endMs = Math.max(startMs + 86400000, new Date(`${endDate}T23:59:59`).getTime());
  const nowMs = Date.now();
  const scheduleElapsedPct =
    nowMs <= startMs
      ? 0
      : nowMs >= endMs
        ? 100
        : Math.round(((nowMs - startMs) / (endMs - startMs)) * 100);

  const totalExp = budgetDisplay.expenditure;
  const finPct = Math.min(100, Math.max(0, budgetDisplay.accomplishmentPct));
  const physTarget =
    activity.annualPhysicalTarget > 0
      ? activity.annualPhysicalTarget
      : safeNum(program?.physicalTarget);
  const physPct =
    physTarget > 0
      ? Math.min(100, Math.round((activity.annualPhysicalActual / physTarget) * 1000) / 10)
      : 0;

  const isCompleted = activity.status === 'COMPLETED';
  const isOngoing = activity.status === 'ON-GOING';
  const isNotImplemented = activity.status === 'NOT IMPLEMENTED';
  const hasRecordedProgress =
    totalExp > 0 || activity.annualPhysicalActual > 0 || isOngoing || isCompleted;
  const isMidTermReached =
    isCompleted || finPct >= 50 || physPct >= 50 || activeMonthIndices.length >= 3;

  const milestones: {
    id: string;
    label: string;
    detail: string;
    dateLabel: string;
    state: 'done' | 'active' | 'pending' | 'blocked';
  }[] = [
    {
      id: 'planning',
      label: 'Budget & Planning',
      detail:
        budgetDisplay.revisedBudget > 0
          ? `Rev. ${formatCompactPHP(budgetDisplay.revisedBudget)}`
          : 'PPA Scheduled',
      dateLabel: formatDateLabel(startDate),
      state: 'done',
    },
    {
      id: 'initiation',
      label: 'Implementation Start',
      detail: isNotImplemented
        ? 'Not Implemented'
        : hasRecordedProgress
          ? `${activeMonthIndices.length || 1} active mo.`
          : 'Awaiting launch',
      dateLabel: formatDateLabel(startDate),
      state: isNotImplemented ? 'blocked' : hasRecordedProgress ? 'done' : 'active',
    },
    {
      id: 'midterm',
      label: 'Execution Milestone',
      detail:
        finPct > 0 || physPct > 0
          ? `${formatPct(finPct)} Fin.${physTarget > 0 ? ` · ${formatQty(activity.annualPhysicalActual)} Phys.` : ''}`
          : '0.00% Utilized',
      dateLabel: `FY ${activity.fiscalYear}`,
      state: isNotImplemented
        ? 'blocked'
        : isCompleted || isMidTermReached
          ? 'done'
          : hasRecordedProgress
            ? 'active'
            : 'pending',
    },
    {
      id: 'completion',
      label: 'Target End / Completion',
      detail: isCompleted
        ? 'Completed'
        : nowMs > endMs && !isCompleted
          ? 'Past Target Date'
          : activity.status,
      dateLabel: formatDateLabel(endDate),
      state: isNotImplemented ? 'blocked' : isCompleted ? 'done' : scheduleElapsedPct >= 85 ? 'active' : 'pending',
    },
  ];

  const startMonthIdx = getMonthIndexFromDate(startDate);
  const endMonthIdx = Math.max(startMonthIdx, getMonthIndexFromDate(endDate));
  const maxMonthExp = Math.max(
    1,
    ...MONTHS.map((m) => safeNum(activity.monthly[m.key]?.financialActual))
  );

  const monthBarColor = (mKey: MonthKey, idx: number) => {
    const exp = safeNum(activity.monthly[mKey]?.financialActual);
    const phys = safeNum(activity.monthly[mKey]?.physicalActual);
    if (exp > 0 || phys > 0) {
      return isCompleted
        ? 'bg-emerald-500 dark:bg-emerald-400'
        : 'bg-[#2563EB] dark:bg-sky-400';
    }
    if (idx >= startMonthIdx && idx <= endMonthIdx) {
      return 'bg-blue-200 dark:bg-sky-900/70';
    }
    return 'bg-slate-200 dark:bg-slate-800';
  };

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
            PPA Lifecycle &amp; Progress Timeline
          </h4>
        </div>
        <span className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
          {hasExplicitDates ? 'Scheduled Dates' : `Derived FY ${activity.fiscalYear} Window`}
        </span>
      </div>

      {/* Start Date -> Elapsed Today Marker -> End Date */}
      <div className="rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Start Date: </span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
              {formatDateLabel(startDate)}
            </span>
          </div>
          <div className="text-center">
            <span className="text-[11px] font-semibold text-[#2563EB] dark:text-sky-400">
              {scheduleElapsedPct}% Schedule Elapsed · {formatPct(finPct)} Financial Progress
            </span>
          </div>
          <div className="text-right">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">End Date: </span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
              {formatDateLabel(endDate)}
            </span>
          </div>
        </div>

        {/* Dual Progress Bar: Financial Progress over Schedule Window */}
        <div className="relative h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200/70 dark:border-slate-700">
          <div
            className="absolute inset-y-0 left-0 bg-blue-100 dark:bg-sky-950/70 transition-all"
            style={{ width: `${scheduleElapsedPct}%` }}
            title={`Schedule elapsed: ${scheduleElapsedPct}%`}
          />
          <div
            className={`relative h-full rounded-full transition-all ${
              isCompleted
                ? 'bg-emerald-500 dark:bg-emerald-400'
                : isNotImplemented
                  ? 'bg-red-500'
                  : 'bg-[#163A5F] dark:bg-sky-400'
            }`}
            style={{ width: `${Math.max(finPct > 0 ? 4 : 0, finPct)}%` }}
            title={`Financial Accomplishment: ${formatPct(finPct)}`}
          />
        </div>

        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#163A5F] dark:bg-sky-400" />
            Financial Progress ({formatPct(finPct)})
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-200 dark:bg-sky-800" />
            Schedule Elapsed ({scheduleElapsedPct}%)
          </span>
        </div>
      </div>

      {/* 4-Stage Milestone Stepper */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
        {milestones.map((ms, idx) => (
          <div
            key={ms.id}
            className={`rounded-lg border p-2.5 text-xs transition-colors ${
              ms.state === 'done'
                ? 'border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30'
                : ms.state === 'active'
                  ? 'border-blue-200 dark:border-sky-700/80 bg-blue-50/70 dark:bg-sky-950/40'
                  : ms.state === 'blocked'
                    ? 'border-red-200 dark:border-red-800/70 bg-red-50/60 dark:bg-red-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                STAGE {idx + 1}
              </span>
              {ms.state === 'done' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : ms.state === 'active' ? (
                <PlayCircle className="h-3.5 w-3.5 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
              ) : ms.state === 'blocked' ? (
                <Flag className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              )}
            </div>
            <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100 leading-tight">
              {ms.label}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
              {ms.detail}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {ms.dateLabel}
            </p>
          </div>
        ))}
      </div>

      {/* 12-Month Milestone Execution Bar Strip (Jan-Dec) */}
      <div className="rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 p-3.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-3">
          <span>Monthly Milestone Execution ({activity.fiscalYear})</span>
          <span className="font-mono text-slate-700 dark:text-slate-300">
            Total: {formatPHP(totalExp)}
          </span>
        </div>
        <div className="grid grid-cols-12 gap-1.5 items-end h-20">
          {MONTHS.map((m, idx) => {
            const entry = activity.monthly[m.key];
            const exp = safeNum(entry?.financialActual);
            const phys = safeNum(entry?.physicalActual);
            const inSpan = idx >= startMonthIdx && idx <= endMonthIdx;
            const heightPct =
              exp > 0
                ? Math.max(22, Math.round((exp / maxMonthExp) * 100))
                : phys > 0
                  ? 35
                  : inSpan
                    ? 18
                    : 10;

            return (
              <div
                key={m.key}
                className="flex flex-col items-center justify-end h-full group"
                title={`${m.label}: Exp ${formatPHP(exp)}${phys > 0 ? ` · Phys Actual ${formatQty(phys)}` : ''}`}
              >
                <div className="w-full flex-1 flex items-end justify-center px-0.5">
                  <div
                    className={`w-full max-w-[18px] rounded-t-sm transition-all ${monthBarColor(
                      m.key,
                      idx
                    )}`}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <span
                  className={`mt-1.5 text-[10px] font-mono ${
                    exp > 0 || phys > 0
                      ? 'font-bold text-[#163A5F] dark:text-sky-400'
                      : inSpan
                        ? 'font-medium text-slate-700 dark:text-slate-300'
                        : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {m.short}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
