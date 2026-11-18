import { ActivityComputed, Program } from '../../types/ppa';
import {
  MONTHS,
  ProgramSummary,
  formatPHP,
  formatPct,
  resolveActivityBudgetDisplay,
} from '../../utils/calculations';

interface AccomplishmentProgressProps {
  activity: ActivityComputed;
  program?: Program;
  programSummary?: ProgramSummary;
  compact?: boolean;
}

export function AccomplishmentProgress({
  activity,
  program,
  programSummary,
  compact = false,
}: AccomplishmentProgressProps) {
  const bd = resolveActivityBudgetDisplay(activity, program, programSummary);
  const values = MONTHS.map((m) => activity.monthly[m.key].financialActual);
  const targets = MONTHS.map((m) => activity.monthly[m.key].financialTarget);
  const maxVal = Math.max(...values, ...targets, 1);

  const width = compact ? 84 : 96;
  const height = compact ? 22 : 24;
  const padY = 3;
  const innerH = height - padY * 2;
  const stepX = width / (MONTHS.length - 1);

  const points = values
    .map((v, idx) => {
      const x = idx * stepX;
      const y = height - padY - (v / maxVal) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const targetPoints = targets
    .map((t, idx) => {
      const x = idx * stepX;
      const y = height - padY - (t / maxVal) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const hasTargets = targets.some((t) => t > 0);
  const areaPoints = `0,${height - padY} ${points} ${width},${height - padY}`;
  const pct = Math.min(100, Math.max(0, bd.accomplishmentPct));

  const monthlyBreakdown = MONTHS.map(
    (m, i) => `${m.short}: ${formatPHP(values[i])}`
  ).join(' · ');
  const tooltipText = `Accomplishment: ${formatPct(bd.accomplishmentPct)} (${formatPHP(
    bd.expenditure
  )} / ${formatPHP(bd.revisedBudget)} × 100) — ${monthlyBreakdown}`;

  return (
    <div
      className={`flex items-center gap-2.5 ${compact ? 'min-w-[140px]' : 'min-w-[165px]'}`}
      title={tooltipText}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 overflow-visible text-[#2563EB] dark:text-sky-400"
        aria-label={`Monthly expenditure accomplishment for ${activity.referenceNumber}`}
      >
        {hasTargets && (
          <polyline
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.28"
            strokeWidth="1.1"
            strokeDasharray="2 2"
            points={targetPoints}
          />
        )}
        <polyline
          fill="currentColor"
          fillOpacity="0.12"
          stroke="none"
          points={areaPoints}
        />
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
        {values.map((v, idx) => {
          if (v <= 0) return null;
          const x = idx * stepX;
          const y = height - padY - (v / maxVal) * innerH;
          return (
            <circle
              key={MONTHS[idx].key}
              cx={x}
              cy={y}
              r="1.7"
              fill="currentColor"
            />
          );
        })}
      </svg>

      <div className="w-16 shrink-0">
        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
          <span className="font-semibold">{formatPct(bd.accomplishmentPct)}</span>
        </div>
        <div className="mt-0.5 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#163A5F] dark:bg-sky-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
