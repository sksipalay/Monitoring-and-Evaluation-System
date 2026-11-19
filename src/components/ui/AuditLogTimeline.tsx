import { useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  History,
  LogIn,
  Pencil,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { AuditActionType, AuditLog } from '../../types/ppa';

interface AuditLogTimelineProps {
  logs: AuditLog[];
  loading?: boolean;
  isOfficeScoped?: boolean;
  officeName?: string;
  onRefresh?: () => void;
  onOpenFullAuditTable?: () => void;
  canOpenFullAuditTable?: boolean;
}

type QuickActionFilter = 'ALL' | 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'OTHER';

const CORE_CRUD_ACTIONS = new Set<AuditActionType>(['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE']);

const ACTION_VISUALS: Record<
  AuditActionType,
  {
    label: string;
    badgeClass: string;
    nodeClass: string;
    ringClass: string;
    Icon: typeof PlusCircle;
  }
> = {
  CREATE: {
    label: 'CREATE',
    badgeClass:
      'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
    nodeClass: 'bg-emerald-600 text-white',
    ringClass: 'ring-emerald-100 dark:ring-emerald-950',
    Icon: PlusCircle,
  },
  UPDATE: {
    label: 'UPDATE',
    badgeClass:
      'bg-blue-50 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border-blue-300 dark:border-blue-700',
    nodeClass: 'bg-blue-600 text-white',
    ringClass: 'ring-blue-100 dark:ring-blue-950',
    Icon: Pencil,
  },
  DELETE: {
    label: 'DELETE',
    badgeClass:
      'bg-red-50 dark:bg-red-950/70 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700',
    nodeClass: 'bg-red-600 text-white',
    ringClass: 'ring-red-100 dark:ring-red-950',
    Icon: Trash2,
  },
  STATUS_CHANGE: {
    label: 'STATUS CHANGE',
    badgeClass:
      'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700',
    nodeClass: 'bg-indigo-600 text-white',
    ringClass: 'ring-indigo-100 dark:ring-indigo-950',
    Icon: ArrowLeftRight,
  },
  IMPORT: {
    label: 'IMPORT',
    badgeClass:
      'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700',
    nodeClass: 'bg-amber-600 text-white',
    ringClass: 'ring-amber-100 dark:ring-amber-950',
    Icon: Upload,
  },
  EXPORT: {
    label: 'EXPORT',
    badgeClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600',
    nodeClass: 'bg-slate-600 text-white',
    ringClass: 'ring-slate-100 dark:ring-slate-800',
    Icon: Download,
  },
  SETTINGS: {
    label: 'SETTINGS',
    badgeClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600',
    nodeClass: 'bg-slate-700 text-white',
    ringClass: 'ring-slate-100 dark:ring-slate-800',
    Icon: Settings,
  },
  LOGIN: {
    label: 'LOGIN',
    badgeClass:
      'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    nodeClass: 'bg-slate-500 text-white',
    ringClass: 'ring-slate-100 dark:ring-slate-800',
    Icon: LogIn,
  },
  AUTH_FAILED: {
    label: 'AUTH FAILED',
    badgeClass:
      'bg-red-50 dark:bg-red-950/70 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700',
    nodeClass: 'bg-red-700 text-white',
    ringClass: 'ring-red-100 dark:ring-red-950',
    Icon: ShieldAlert,
  },
  BACKUP: {
    label: 'BACKUP',
    badgeClass:
      'bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300 border-teal-300 dark:border-teal-700',
    nodeClass: 'bg-teal-600 text-white',
    ringClass: 'ring-teal-100 dark:ring-teal-950',
    Icon: Database,
  },
  RESTORE: {
    label: 'RESTORE',
    badgeClass:
      'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700',
    nodeClass: 'bg-amber-600 text-white',
    ringClass: 'ring-amber-100 dark:ring-amber-950',
    Icon: RotateCcw,
  },
};

function getDateBucketKey(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Unknown Date';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function formatDateHeading(bucketKey: string): string {
  if (bucketKey === 'Unknown Date') return bucketKey;
  const parts = bucketKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return bucketKey;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dt.getTime() === today.getTime()) {
    return `Today · ${dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  if (dt.getTime() === yesterday.getTime()) {
    return `Yesterday · ${dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return dt.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeOnly(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRelativeTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const diffSec = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return '';
}

export function AuditLogTimeline({
  logs,
  loading = false,
  isOfficeScoped = false,
  officeName = '',
  onRefresh,
  onOpenFullAuditTable,
  canOpenFullAuditTable = false,
}: AuditLogTimelineProps) {
  const [actionFilter, setActionFilter] = useState<QuickActionFilter>('ALL');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDiffIds, setExpandedDiffIds] = useState<Record<string, boolean>>({});
  const [visibleLimit, setVisibleLimit] = useState(40);

  const sortedLogs = useMemo(() => {
    return [...logs].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [logs]);

  const actionCounts = useMemo(() => {
    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;
    let statusCount = 0;
    let otherCount = 0;
    for (const l of sortedLogs) {
      if (l.action === 'CREATE') createCount++;
      else if (l.action === 'UPDATE') updateCount++;
      else if (l.action === 'DELETE') deleteCount++;
      else if (l.action === 'STATUS_CHANGE') statusCount++;
      else otherCount++;
    }
    return {
      total: sortedLogs.length,
      createCount,
      updateCount,
      deleteCount,
      statusCount,
      otherCount,
    };
  }, [sortedLogs]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const l of sortedLogs) {
      if (l.entityType) set.add(l.entityType);
    }
    return Array.from(set).sort();
  }, [sortedLogs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedLogs.filter((l) => {
      if (actionFilter === 'OTHER') {
        if (CORE_CRUD_ACTIONS.has(l.action)) return false;
      } else if (actionFilter !== 'ALL' && l.action !== actionFilter) {
        return false;
      }
      if (entityFilter !== 'ALL' && l.entityType !== entityFilter) {
        return false;
      }
      if (q) {
        const hay = `${l.userName} ${l.userEmail} ${l.userRole} ${l.userOfficeName || ''} ${l.action} ${l.entityType} ${l.entityId} ${l.summary} ${l.details}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sortedLogs, actionFilter, entityFilter, searchQuery]);

  const displayedLogs = useMemo(
    () => filteredLogs.slice(0, visibleLimit),
    [filteredLogs, visibleLimit]
  );

  const groupedByDate = useMemo(() => {
    const groups: { dateKey: string; heading: string; items: AuditLog[] }[] = [];
    const byKey = new Map<string, AuditLog[]>();
    for (const item of displayedLogs) {
      const key = getDateBucketKey(item.timestamp);
      const list = byKey.get(key);
      if (list) {
        list.push(item);
      } else {
        const nextList = [item];
        byKey.set(key, nextList);
        groups.push({ dateKey: key, heading: formatDateHeading(key), items: nextList });
      }
    }
    return groups;
  }, [displayedLogs]);

  return (
    <div className="space-y-5">
      {/* Timeline Header & Summary Strip */}
      <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#163A5F]/10 dark:bg-sky-500/15 text-[#163A5F] dark:text-sky-400">
              <History className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                System Audit Log Timeline
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {isOfficeScoped
                  ? `Chronological change history for ${officeName || 'your office'} showing create, update, and delete events.`
                  : 'Chronological audit trail of program, budget, activity, and system changes across LGU Bula.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{loading ? 'Refreshing...' : 'Refresh Timeline'}</span>
              </button>
            )}
            {canOpenFullAuditTable && onOpenFullAuditTable && (
              <button
                type="button"
                onClick={onOpenFullAuditTable}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1e4b7a] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                <ActivityIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Admin Audit Table &amp; Hash Verify</span>
              </button>
            )}
          </div>
        </div>

        {/* Color-Coded Action Summary Counters */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <button
            type="button"
            onClick={() => setActionFilter('ALL')}
            className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
              actionFilter === 'ALL'
                ? 'border-[#163A5F] dark:border-sky-500 bg-slate-50 dark:bg-slate-800/80 ring-1 ring-[#163A5F]/20 dark:ring-sky-500/30'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
          >
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">All Events</p>
            <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {actionCounts.total}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setActionFilter(actionFilter === 'CREATE' ? 'ALL' : 'CREATE')}
            className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
              actionFilter === 'CREATE'
                ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 ring-1 ring-emerald-500/30'
                : 'border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/15 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/30'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                CREATE
              </span>
              <PlusCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            </div>
            <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-900 dark:text-emerald-200 tabular-nums">
              {actionCounts.createCount}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setActionFilter(actionFilter === 'UPDATE' ? 'ALL' : 'UPDATE')}
            className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
              actionFilter === 'UPDATE'
                ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 ring-1 ring-blue-500/30'
                : 'border-blue-200/80 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/15 hover:bg-blue-50/70 dark:hover:bg-blue-950/30'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-400">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                UPDATE
              </span>
              <Pencil className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            </div>
            <p className="mt-0.5 font-mono text-lg font-semibold text-blue-900 dark:text-blue-200 tabular-nums">
              {actionCounts.updateCount}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setActionFilter(actionFilter === 'DELETE' ? 'ALL' : 'DELETE')}
            className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
              actionFilter === 'DELETE'
                ? 'border-red-500 bg-red-50/80 dark:bg-red-950/40 ring-1 ring-red-500/30'
                : 'border-red-200/80 dark:border-red-900/60 bg-red-50/30 dark:bg-red-950/15 hover:bg-red-50/70 dark:hover:bg-red-950/30'
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-600" />
                DELETE
              </span>
              <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
            </div>
            <p className="mt-0.5 font-mono text-lg font-semibold text-red-900 dark:text-red-200 tabular-nums">
              {actionCounts.deleteCount}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setActionFilter(actionFilter === 'OTHER' ? 'ALL' : 'OTHER')}
            className={`col-span-2 sm:col-span-1 rounded-lg border px-3 py-2.5 text-left transition-all ${
              actionFilter === 'OTHER'
                ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/40 ring-1 ring-indigo-500/30'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
            }`}
          >
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Status / System
            </p>
            <p className="mt-0.5 font-mono text-lg font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
              {actionCounts.statusCount + actionCounts.otherCount}
            </p>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 no-print">
          <div className="relative flex-1 min-w-[210px]">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search timeline by user, ref code, summary, or details..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
            />
          </div>

          <select
            aria-label="Filter by action type"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as QuickActionFilter)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
          >
            <option value="ALL">All Actions</option>
            <option value="CREATE">CREATE only</option>
            <option value="UPDATE">UPDATE only</option>
            <option value="DELETE">DELETE only</option>
            <option value="STATUS_CHANGE">STATUS CHANGE only</option>
            <option value="OTHER">Imports / Exports / System</option>
          </select>

          <select
            aria-label="Filter by entity type"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
          >
            <option value="ALL">All Entities</option>
            {entityTypes.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>

          {(actionFilter !== 'ALL' || entityFilter !== 'ALL' || searchQuery.trim() !== '') && (
            <button
              type="button"
              onClick={() => {
                setActionFilter('ALL');
                setEntityFilter('ALL');
                setSearchQuery('');
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      </section>

      {/* Vertical Chronological Timeline */}
      {groupedByDate.length === 0 ? (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <Clock className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
            No matching audit timeline entries
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {sortedLogs.length === 0
              ? 'System events will appear along this timeline as programs, budgets, and activities are created, updated, or deleted.'
              : 'Try adjusting your action tag filter or search query.'}
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {groupedByDate.map((group) => (
            <section
              key={group.dateKey}
              className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            >
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {group.heading}
                </h3>
                <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                  {group.items.length} {group.items.length === 1 ? 'event' : 'events'}
                </span>
              </div>

              <ol className="relative ml-3.5 border-l-2 border-slate-200 dark:border-slate-700/80 space-y-4">
                {group.items.map((log) => {
                  const visual = ACTION_VISUALS[log.action] || ACTION_VISUALS.UPDATE;
                  const Icon = visual.Icon;
                  const hasDiffs = Array.isArray(log.changes) && log.changes.length > 0;
                  const isExpanded = Boolean(expandedDiffIds[log.id]);
                  const rel = formatRelativeTime(log.timestamp);

                  return (
                    <li key={log.id} className="relative pl-7">
                      {/* Timeline Node */}
                      <span
                        className={`absolute -left-[13px] top-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-4 ${visual.nodeClass} ${visual.ringClass}`}
                        aria-hidden="true"
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>

                      <div className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-3.5 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide ${visual.badgeClass}`}
                            >
                              {visual.label}
                            </span>
                            <span className="rounded bg-slate-200/70 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                              {log.entityType}
                              {log.entityId ? ` · #${log.entityId}` : ''}
                            </span>
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {log.userName}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {log.userRole}
                              {log.userOfficeName ? ` · ${log.userOfficeName}` : ''}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {rel && (
                              <span className="rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 text-[10px]">
                                {rel}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
                              {formatTimeOnly(log.timestamp)}
                            </span>
                          </div>
                        </div>

                        <p className="mt-2 text-[13px] font-medium text-slate-800 dark:text-slate-200 break-words">
                          {log.summary}
                        </p>

                        {log.details && !hasDiffs && (
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 break-words">
                            {log.details}
                          </p>
                        )}

                        {hasDiffs && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedDiffIds((prev) => ({
                                  ...prev,
                                  [log.id]: !prev[log.id],
                                }))
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] dark:text-sky-400 hover:underline"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>
                                {isExpanded ? 'Hide' : 'View'} {log.changes!.length} field change
                                {log.changes!.length === 1 ? '' : 's'}
                              </span>
                            </button>

                            {isExpanded && (
                              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {log.changes!.map((diff, idx) => (
                                  <div
                                    key={`${log.id}-diff-${idx}`}
                                    className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                                  >
                                    <p className="font-mono text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                      {diff.field}
                                    </p>
                                    <p className="mt-0.5 text-[11px] break-words">
                                      <span className="line-through text-red-600 dark:text-red-400">
                                        {diff.before || '—'}
                                      </span>
                                      <span className="mx-1.5 text-slate-400">→</span>
                                      <span className="font-medium text-emerald-700 dark:text-emerald-400">
                                        {diff.after || '—'}
                                      </span>
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {log.entryHash && (
                          <p className="mt-1.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                            Audit Hash: #{log.entryHash.slice(0, 12)}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {filteredLogs.length > visibleLimit && (
            <div className="flex justify-center pt-1 no-print">
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + 40)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Load More Timeline Events ({filteredLogs.length - visibleLimit} remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
