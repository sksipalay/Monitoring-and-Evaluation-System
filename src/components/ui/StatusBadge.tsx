import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { ImplementationStatus } from '../../types/ppa';

interface StatusBadgeProps {
  status: ImplementationStatus;
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  ImplementationStatus,
  {
    bg: string;
    text: string;
    border: string;
    Icon: typeof CheckCircle2;
  }
> = {
  COMPLETED: {
    bg: 'bg-emerald-50/90 dark:bg-emerald-950/60',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200/80 dark:border-emerald-800/80',
    Icon: CheckCircle2,
  },
  'ON-GOING': {
    bg: 'bg-blue-50/90 dark:bg-blue-950/60',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200/80 dark:border-blue-800/80',
    Icon: Clock,
  },
  PENDING: {
    bg: 'bg-amber-50/90 dark:bg-amber-950/60',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200/80 dark:border-amber-800/80',
    Icon: AlertCircle,
  },
  'NOT IMPLEMENTED': {
    bg: 'bg-red-50/90 dark:bg-red-950/60',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200/80 dark:border-red-800/80',
    Icon: XCircle,
  },
};

export function StatusBadge({ status, compact }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  const Icon = cfg.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-tight whitespace-nowrap shrink-0 ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{compact && status === 'NOT IMPLEMENTED' ? 'NOT IMPL.' : status}</span>
    </span>
  );
}
