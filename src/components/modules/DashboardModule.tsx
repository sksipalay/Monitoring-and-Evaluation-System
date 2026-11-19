import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  CheckCircle2,
  Clock,
  Coins,
  Database,
  Download,
  FileSpreadsheet,
  FolderKanban,
  FolderPlus,
  History,
  LayoutDashboard,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Target,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { AuditLogTimeline } from '../ui/AuditLogTimeline';
import {
  Activity,
  ActivityComputed,
  AuditActionType,
  AuditLog,
  FiscalYear,
  ImplementationStatus,
  MonthKey,
  Office,
  Program,
  RemarkLog,
  UserRole,
} from '../../types/ppa';
import {
  MONTHS,
  STATUS_OPTIONS,
  calculateRevisedBudgetByFund,
  computeDashboardSummary,
  formatCompactPHP,
  formatPHP,
  formatPct,
  formatQty,
  resolveActivityBudgetDisplay,
  round2,
  safeNum,
  summarizeProgram,
} from '../../utils/calculations';

interface DashboardModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  offices: Office[];
  fiscalYears: FiscalYear[];
  auditLogs: AuditLog[];
  selectedFiscalYear: string;
  onChangeFiscalYear: (fy: string) => void;
  userRole: UserRole;
  userUid: string;
  userName: string;
  userOfficeId?: string;
  userOfficeName?: string;
  theme?: 'light' | 'dark';
  onNavigate: (module: 'programs' | 'excel' | 'users') => void;
  onDownloadTemplate: () => void;
  onLoadSampleData: () => void;
  onUpdateActivity: (activity: Activity) => Promise<void>;
  onAddRemark: (remark: RemarkLog) => Promise<void>;
}

const STATUS_COLORS: Record<ImplementationStatus, string> = {
  COMPLETED: '#16A34A',
  'ON-GOING': '#2563EB',
  PENDING: '#F59E0B',
  'NOT IMPLEMENTED': '#DC2626',
};

const STATUS_TEXT_CLASSES: Record<ImplementationStatus, string> = {
  COMPLETED: 'text-emerald-700 dark:text-emerald-400',
  'ON-GOING': 'text-[#2563EB] dark:text-sky-400',
  PENDING: 'text-amber-700 dark:text-amber-400',
  'NOT IMPLEMENTED': 'text-red-700 dark:text-red-400',
};

const OFFICE_PIE_COLORS = [
  '#163A5F',
  '#2563EB',
  '#0D9488',
  '#F59E0B',
  '#7C3AED',
  '#DB2777',
  '#16A34A',
  '#EA580C',
  '#475569',
];

const OFFICE_PIE_COLORS_DARK = [
  '#38BDF8',
  '#60A5FA',
  '#2DD4BF',
  '#FBBF24',
  '#A78BFA',
  '#F472B6',
  '#34D399',
  '#FB923C',
  '#94A3B8',
];

const ACTION_BADGE_STYLES: Record<AuditActionType, string> = {
  CREATE:
    'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  UPDATE:
    'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  STATUS_CHANGE:
    'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
  DELETE:
    'bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800',
  IMPORT:
    'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  EXPORT:
    'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700',
  SETTINGS:
    'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700',
  LOGIN:
    'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  AUTH_FAILED:
    'bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800',
  BACKUP:
    'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800',
  RESTORE:
    'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
};

function formatAuditTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DashboardModule({
  programs,
  activities,
  offices,
  fiscalYears,
  auditLogs,
  selectedFiscalYear,
  onChangeFiscalYear,
  userRole,
  userUid,
  userName,
  userOfficeId = '',
  userOfficeName = '',
  theme = 'light',
  onNavigate,
  onDownloadTemplate,
  onLoadSampleData,
  onUpdateActivity,
  onAddRemark,
}: DashboardModuleProps) {
  const isOfficeScoped = userRole === 'ENCODER' && Boolean(userOfficeId);
  const isDark = theme === 'dark';
  const gridStroke = isDark ? '#334155' : '#E2E8F0';
  const tickColor = isDark ? '#94A3B8' : '#475569';
  const tooltipStyle = {
    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
    borderColor: isDark ? '#334155' : '#E2E8F0',
    color: isDark ? '#F1F5F9' : '#0F172A',
    fontSize: '12px',
    borderRadius: '6px',
  };
  const pieColors = isDark ? OFFICE_PIE_COLORS_DARK : OFFICE_PIE_COLORS;

  const canQuickAdd = userRole === 'ADMINISTRATOR' || userRole === 'ENCODER';
  const defaultMonthKey: MonthKey = MONTHS[new Date().getMonth()]?.key || 'jan';

  const [dashboardTab, setDashboardTab] = useState<'overview' | 'timeline'>('overview');
  const [officeFilter, setOfficeFilter] = useState<string>('ALL');
  const [programFilter, setProgramFilter] = useState<string>('ALL');
  const [activityFilter, setActivityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [quarterChartMode, setQuarterChartMode] = useState<'quarterly' | 'cumulative'>('cumulative');

  // Global Quick Add Daily / Periodic Accomplishment modal state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [qaSearch, setQaSearch] = useState('');
  const [qaActivityId, setQaActivityId] = useState<string>('');
  const [qaMonth, setQaMonth] = useState<MonthKey>(defaultMonthKey);
  const [qaMode, setQaMode] = useState<'add' | 'set'>('add');
  const [qaPhysical, setQaPhysical] = useState<string>('0');
  const [qaExpenditure, setQaExpenditure] = useState<string>('0');
  const [qaStatus, setQaStatus] = useState<ImplementationStatus | 'KEEP'>('KEEP');
  const [qaNote, setQaNote] = useState<string>('');
  const [qaDate, setQaDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [qaSaving, setQaSaving] = useState(false);
  const [qaSavedBanner, setQaSavedBanner] = useState<string | null>(null);
  const quickAddModalRef = useModalFocusTrap<HTMLDivElement>(
    quickAddOpen,
    () => setQuickAddOpen(false)
  );

  // Audit log timeline state (fetches up to 200 entries scoped on server; merged with reactive prop logs)
  const [fetchedAuditLogs, setFetchedAuditLogs] = useState<AuditLog[]>(() => auditLogs);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);

  const fetchAuditTimelineLogs = useCallback(async () => {
    setLoadingAuditLogs(true);
    try {
      const res = await dataService.getAuditLogs(200);
      if (Array.isArray(res.auditLogs)) {
        setFetchedAuditLogs(res.auditLogs);
      }
    } catch {
      setFetchedAuditLogs(auditLogs);
    } finally {
      setLoadingAuditLogs(false);
    }
  }, [auditLogs]);

  useEffect(() => {
    fetchAuditTimelineLogs();
  }, [fetchAuditTimelineLogs]);

  const timelineAuditLogs = useMemo(() => {
    const byId = new Map<string, AuditLog>();
    for (const log of fetchedAuditLogs) {
      byId.set(log.id, log);
    }
    for (const log of auditLogs) {
      byId.set(log.id, log);
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [fetchedAuditLogs, auditLogs]);

  const recentAuditLogs = useMemo(() => timelineAuditLogs.slice(0, 5), [timelineAuditLogs]);

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

  const filteredActivities = useMemo(() => {
    return fyActivities.filter((a) => {
      if (officeFilter !== 'ALL' && a.officeId !== officeFilter && a.officeName !== officeFilter)
        return false;
      if (programFilter !== 'ALL' && a.programId !== programFilter && a.subprogramId !== programFilter)
        return false;
      if (activityFilter !== 'ALL' && a.id !== activityFilter) return false;
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      return true;
    });
  }, [fyActivities, officeFilter, programFilter, activityFilter, statusFilter]);

  const filteredPrograms = useMemo(() => {
    if (programFilter !== 'ALL') {
      return fyPrograms.filter((p) => p.id === programFilter);
    }
    if (officeFilter === 'ALL' && activityFilter === 'ALL' && statusFilter === 'ALL') {
      return fyPrograms;
    }
    const activeProgramIds = new Set(filteredActivities.map((a) => a.programId));
    return fyPrograms.filter((p) => activeProgramIds.has(p.id));
  }, [fyPrograms, filteredActivities, officeFilter, programFilter, activityFilter, statusFilter]);

  const summary = useMemo(
    () => computeDashboardSummary(filteredPrograms, filteredActivities),
    [filteredPrograms, filteredActivities]
  );

  const executiveSummary = useMemo(() => {
    const actsByProgram = new Map<string, ActivityComputed[]>();
    const activeOfficeKeys = new Set<string>();

    for (const a of filteredActivities) {
      const list = actsByProgram.get(a.programId);
      if (list) list.push(a);
      else actsByProgram.set(a.programId, [a]);
      if (a.officeId || a.officeName) {
        activeOfficeKeys.add(a.officeId || a.officeName);
      }
    }

    let totalActivePrograms = 0;
    for (const p of filteredPrograms) {
      if (p.officeId || p.officeName) {
        activeOfficeKeys.add(p.officeId || p.officeName);
      }
      const pActs = actsByProgram.get(p.id) || [];
      const hasLiveActivity =
        pActs.length === 0 || pActs.some((a) => a.status !== 'NOT IMPLEMENTED');
      if (hasLiveActivity) {
        totalActivePrograms++;
      }
    }

    const completionRatePct =
      summary.totalActivities > 0
        ? round2((summary.completedCount / summary.totalActivities) * 100)
        : 0;

    const remainingBudgetPct =
      summary.totalRevisedBudget > 0
        ? round2((summary.remainingBudget / summary.totalRevisedBudget) * 100)
        : 0;

    return {
      totalActivePrograms,
      activeOfficeCount: activeOfficeKeys.size,
      completionRatePct,
      remainingBudgetPct,
    };
  }, [filteredPrograms, filteredActivities, summary]);

  const programChartData = useMemo(() => {
    return filteredPrograms.map((p) => {
      const s = summarizeProgram(p, filteredActivities);
      const shortName = p.title.length > 26 ? `${p.title.slice(0, 24)}…` : p.title;
      return {
        name: `${p.aipRefCode} · ${shortName}`,
        fullName: p.title,
        approvedBudget: s.approvedBudget,
        revisedBudget: s.revisedBudget,
        utilized: s.annualFinancialActual,
        physicalTarget: s.annualPhysicalTarget,
        physicalActual: s.annualPhysicalActual,
      };
    });
  }, [filteredPrograms, filteredActivities]);

  const quarterlyOverlayData = useMemo(() => {
    const quarters: { label: string; short: string; keys: MonthKey[] }[] = [
      { label: 'Q1 (Jan–Mar)', short: 'Q1', keys: ['jan', 'feb', 'mar'] },
      { label: 'Q2 (Apr–Jun)', short: 'Q2', keys: ['apr', 'may', 'jun'] },
      { label: 'Q3 (Jul–Sep)', short: 'Q3', keys: ['jul', 'aug', 'sep'] },
      { label: 'Q4 (Oct–Dec)', short: 'Q4', keys: ['oct', 'nov', 'dec'] },
    ];

    const byKey = new Map(summary.monthlySeries.map((m) => [m.monthKey, m]));
    let cumExpenditure = 0;
    let cumPhysActual = 0;

    return quarters.map((q) => {
      let qExp = 0;
      let qPhysTarget = 0;
      let qPhysActual = 0;

      for (const k of q.keys) {
        const entry = byKey.get(k);
        if (entry) {
          qExp += entry.financialActual;
          qPhysTarget += entry.physicalTarget;
          qPhysActual += entry.physicalActual;
        }
      }

      qExp = round2(qExp);
      qPhysTarget = Math.round(qPhysTarget * 10000) / 10000;
      qPhysActual = Math.round(qPhysActual * 10000) / 10000;

      cumExpenditure = round2(cumExpenditure + qExp);
      cumPhysActual = Math.round((cumPhysActual + qPhysActual) * 10000) / 10000;

      const qBudgetUtilPct =
        summary.totalRevisedBudget > 0
          ? round2((qExp / summary.totalRevisedBudget) * 100)
          : 0;
      const qPhysPct =
        qPhysTarget > 0 ? round2((qPhysActual / qPhysTarget) * 100) : 0;

      const cumBudgetUtilPct =
        summary.totalRevisedBudget > 0
          ? round2((cumExpenditure / summary.totalRevisedBudget) * 100)
          : 0;
      const cumPhysPct =
        summary.totalPhysicalTarget > 0
          ? round2((cumPhysActual / summary.totalPhysicalTarget) * 100)
          : 0;

      const isCum = quarterChartMode === 'cumulative';

      return {
        quarter: q.label,
        short: q.short,
        expenditure: isCum ? cumExpenditure : qExp,
        revisedBudget: summary.totalRevisedBudget,
        physicalActual: isCum ? cumPhysActual : qPhysActual,
        physicalTarget: isCum ? summary.totalPhysicalTarget : qPhysTarget,
        budgetUtilizationPct: isCum ? cumBudgetUtilPct : qBudgetUtilPct,
        physicalAccomplishmentPct: isCum ? cumPhysPct : qPhysPct,
      };
    });
  }, [summary, quarterChartMode]);

  const statusDistData = useMemo(() => {
    const total = summary.totalActivities;
    return [
      {
        name: 'COMPLETED' as ImplementationStatus,
        value: summary.completedCount,
        pct: total > 0 ? (summary.completedCount / total) * 100 : 0,
      },
      {
        name: 'ON-GOING' as ImplementationStatus,
        value: summary.ongoingCount,
        pct: total > 0 ? (summary.ongoingCount / total) * 100 : 0,
      },
      {
        name: 'PENDING' as ImplementationStatus,
        value: summary.pendingCount,
        pct: total > 0 ? (summary.pendingCount / total) * 100 : 0,
      },
      {
        name: 'NOT IMPLEMENTED' as ImplementationStatus,
        value: summary.notImplementedCount,
        pct: total > 0 ? (summary.notImplementedCount / total) * 100 : 0,
      },
    ];
  }, [summary]);

  const officeUtilizationData = useMemo(() => {
    const officeLookup = new Map(offices.map((o) => [o.id, o]));
    const programLookup = new Map(filteredPrograms.map((p) => [p.id, p]));
    const addedProgramBudgetsPerOffice = new Set<string>();
    const approvedByProgram = new Map<string, number>();

    for (const a of filteredActivities) {
      approvedByProgram.set(
        a.programId,
        (approvedByProgram.get(a.programId) || 0) + a.approvedBudget
      );
    }

    const byOffice = new Map<
      string,
      {
        key: string;
        code: string;
        officeName: string;
        utilized: number;
        revisedBudget: number;
        activityCount: number;
      }
    >();

    for (const a of filteredActivities) {
      const office = officeLookup.get(a.officeId);
      const key = office?.id || a.officeId || a.officeName || 'UNASSIGNED';
      const officeName = office?.name || a.officeName || 'Unassigned Office';
      const code = office?.code || officeName.slice(0, 12);
      const prev = byOffice.get(key) || {
        key,
        code,
        officeName,
        utilized: 0,
        revisedBudget: 0,
        activityCount: 0,
      };
      prev.utilized = round2(prev.utilized + a.annualFinancialActual);

      let revAdd = a.revisedBudget;
      if (a.approvedBudget === 0 && (approvedByProgram.get(a.programId) || 0) === 0) {
        const parentProg = programLookup.get(a.programId);
        const dedupeKey = `${key}::${a.programId}`;
        if (parentProg && safeNum(parentProg.budget) > 0 && !addedProgramBudgetsPerOffice.has(dedupeKey)) {
          revAdd = calculateRevisedBudgetByFund(
            safeNum(parentProg.budget),
            a.sourceOfFund || parentProg.sourceOfFund || a.budgetClassification
          );
          addedProgramBudgetsPerOffice.add(dedupeKey);
        }
      }

      prev.revisedBudget = round2(prev.revisedBudget + revAdd);
      prev.activityCount += 1;
      byOffice.set(key, prev);
    }

    const totalUtilized = Array.from(byOffice.values()).reduce(
      (sum, item) => sum + item.utilized,
      0
    );

    return Array.from(byOffice.values())
      .map((item) => ({
        ...item,
        name: item.code !== item.officeName ? `${item.code} — ${item.officeName}` : item.officeName,
        sharePct: totalUtilized > 0 ? round2((item.utilized / totalUtilized) * 100) : 0,
        utilizationRatePct:
          item.revisedBudget > 0 ? round2((item.utilized / item.revisedBudget) * 100) : 0,
      }))
      .sort((a, b) => b.utilized - a.utilized);
  }, [filteredActivities, filteredPrograms, offices]);

  const officePieSlices = useMemo(
    () => officeUtilizationData.filter((d) => d.utilized > 0),
    [officeUtilizationData]
  );

  const resetFilters = () => {
    setOfficeFilter('ALL');
    setProgramFilter('ALL');
    setActivityFilter('ALL');
    setStatusFilter('ALL');
  };

  const quickAddBasePool = useMemo(() => {
    const preferredIds = new Set(
      (filteredActivities.length > 0 ? filteredActivities : fyActivities).map((a) => a.id)
    );
    return [...activities].sort((a, b) => {
      const aPref = preferredIds.has(a.id) ? 0 : 1;
      const bPref = preferredIds.has(b.id) ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      return a.referenceNumber.localeCompare(b.referenceNumber);
    });
  }, [activities, filteredActivities, fyActivities]);

  const quickAddPool = useMemo(() => {
    const q = qaSearch.trim().toLowerCase();
    if (!q) return quickAddBasePool;
    return quickAddBasePool.filter((a) =>
      `${a.referenceNumber} ${a.description} ${a.officeName} ${a.fiscalYear}`
        .toLowerCase()
        .includes(q)
    );
  }, [quickAddBasePool, qaSearch]);

  const matchedQuickActivity = useMemo(() => {
    if (quickAddPool.length === 0) return null;
    return quickAddPool.find((a) => a.id === qaActivityId) || quickAddPool[0] || null;
  }, [quickAddPool, qaActivityId]);

  const selectedQuickActivity = useMemo(
    () =>
      matchedQuickActivity ||
      quickAddBasePool.find((a) => a.id === qaActivityId) ||
      quickAddBasePool[0] ||
      null,
    [matchedQuickActivity, quickAddBasePool, qaActivityId]
  );

  const quickAddPreview = useMemo(() => {
    if (!matchedQuickActivity) return null;
    const existingMonth = matchedQuickActivity.monthly[qaMonth];
    const deltaPhys = safeNum(qaPhysical);
    const deltaExp = round2(safeNum(qaExpenditure));

    const nextMonthPhys = Math.max(
      0,
      qaMode === 'add'
        ? Math.round((existingMonth.physicalActual + deltaPhys) * 10000) / 10000
        : Math.round(deltaPhys * 10000) / 10000
    );
    const nextMonthFin = Math.max(
      0,
      qaMode === 'add' ? round2(existingMonth.financialActual + deltaExp) : deltaExp
    );

    const parentProg = programs.find((p) => p.id === matchedQuickActivity.programId);
    const progSum = parentProg
      ? summarizeProgram(
          parentProg,
          activities.filter((a) => a.programId === parentProg.id)
        )
      : undefined;
    const baseBudget = resolveActivityBudgetDisplay(matchedQuickActivity, parentProg, progSum);
    const finDeltaFromCurrent = round2(nextMonthFin - existingMonth.financialActual);
    const nextRemaining = round2(baseBudget.remainingBudget - finDeltaFromCurrent);

    return {
      existingMonth,
      nextMonthPhys,
      nextMonthFin,
      nextRemaining,
      revisedBudget: baseBudget.revisedBudget,
    };
  }, [matchedQuickActivity, qaMonth, qaMode, qaPhysical, qaExpenditure, programs, activities]);

  const openQuickAdd = () => {
    const initial =
      (filteredActivities.length > 0 ? filteredActivities[0] : fyActivities[0]) ||
      activities[0] ||
      null;
    setQaSearch('');
    setQaActivityId(initial?.id || '');
    setQaMonth(defaultMonthKey);
    setQaMode('add');
    setQaPhysical('0');
    setQaExpenditure('0');
    setQaStatus('KEEP');
    setQaNote('');
    setQaDate(new Date().toISOString().slice(0, 10));
    setQaSavedBanner(null);
    setQuickAddOpen(true);
  };

  const saveQuickAdd = async (keepOpen: boolean) => {
    if (!matchedQuickActivity) return;
    setQaSaving(true);
    try {
      const existingMonth = matchedQuickActivity.monthly[qaMonth];
      const deltaPhys = safeNum(qaPhysical);
      const deltaExp = round2(safeNum(qaExpenditure));

      const nextPhysActual =
        qaMode === 'add'
          ? Math.round((existingMonth.physicalActual + deltaPhys) * 10000) / 10000
          : Math.round(deltaPhys * 10000) / 10000;
      const nextFinActual =
        qaMode === 'add'
          ? round2(existingMonth.financialActual + deltaExp)
          : deltaExp;

      const updatedMonthly = {
        ...matchedQuickActivity.monthly,
        [qaMonth]: {
          ...existingMonth,
          physicalActual: Math.max(0, nextPhysActual),
          financialActual: Math.max(0, nextFinActual),
        },
      };

      const nextStatus = qaStatus === 'KEEP' ? matchedQuickActivity.status : qaStatus;
      const trimmedNote = qaNote.trim();

      await onUpdateActivity({
        ...matchedQuickActivity,
        monthly: updatedMonthly,
        status: nextStatus,
        remarks: trimmedNote || matchedQuickActivity.remarks,
        updatedBy: userUid,
        updatedAt: new Date().toISOString(),
      });

      if (trimmedNote) {
        const mLabel = MONTHS.find((m) => m.key === qaMonth)?.label || qaMonth;
        await onAddRemark({
          id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          activityId: matchedQuickActivity.id,
          authorUid: userUid,
          authorName: userName,
          authorRole: userRole,
          observation: `[Quick Add · ${mLabel} · Phys: ${
            qaMode === 'add' ? `+${deltaPhys}` : deltaPhys
          }, Exp: ${formatPHP(deltaExp)}] ${trimmedNote}`,
          monitoringDate: qaDate,
          createdAt: new Date().toISOString(),
        });
      }

      if (keepOpen) {
        setQaPhysical('0');
        setQaExpenditure('0');
        setQaNote('');
        setQaStatus('KEEP');
        setQaSavedBanner(`Saved accomplishment update for ${matchedQuickActivity.referenceNumber}.`);
      } else {
        setQuickAddOpen(false);
      }
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setQaSaving(false);
    }
  };

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveQuickAdd(false);
  };

  const renderDashboardTabBar = () => (
    <div className="no-print flex flex-wrap items-center justify-between gap-3">
      <div
        className="inline-flex items-center rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        role="tablist"
        aria-label="Dashboard sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={dashboardTab === 'overview'}
          onClick={() => setDashboardTab('overview')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors ${
            dashboardTab === 'overview'
              ? 'bg-[#163A5F] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
          <span>Executive Overview</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={dashboardTab === 'timeline'}
          onClick={() => setDashboardTab('timeline')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors ${
            dashboardTab === 'timeline'
              ? 'bg-[#163A5F] text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          <span>Audit Log Timeline</span>
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
              dashboardTab === 'timeline'
                ? 'bg-white/20 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {timelineAuditLogs.length}
          </span>
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {dashboardTab === 'overview'
          ? `Showing FY ${selectedFiscalYear === 'ALL' ? 'All Years' : selectedFiscalYear} · ${summary.totalPrograms} program${summary.totalPrograms === 1 ? '' : 's'} · ${summary.totalActivities} PPA${summary.totalActivities === 1 ? '' : 's'}`
          : 'Color-coded CREATE, UPDATE, and DELETE event timeline'}
      </p>
    </div>
  );

  const renderRecentActivityWidget = () => (
    <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#163A5F]/10 dark:bg-sky-500/15 text-[#163A5F] dark:text-sky-400">
            <ActivityIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Recent Activity
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Last 5 audit log entries showing user, action, and target record details
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 no-print">
          <button
            type="button"
            onClick={fetchAuditTimelineLogs}
            disabled={loadingAuditLogs}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            title="Refresh audit logs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loadingAuditLogs ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setDashboardTab('timeline')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-sky-800 bg-blue-50/70 dark:bg-sky-950/40 px-3 py-1.5 text-xs font-semibold text-[#163A5F] dark:text-sky-300 hover:bg-blue-100/80 dark:hover:bg-sky-900/50 transition-colors"
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Open Audit Timeline</span>
          </button>
          {userRole === 'ADMINISTRATOR' && (
            <button
              type="button"
              onClick={() => onNavigate('users')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] dark:text-sky-400 hover:underline"
            >
              <span>View Full Audit Log</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {recentAuditLogs.length === 0 ? (
        <div className="px-5 py-6 text-xs text-slate-500 dark:text-slate-400">
          No audit entries recorded yet. Updates to programs, budgets, monthly monitoring, and statuses will appear here automatically.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {recentAuditLogs.slice(0, 5).map((log) => (
            <li
              key={log.id}
              className="flex flex-wrap items-start sm:items-center justify-between gap-3 px-5 py-3 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <span
                  className={`mt-0.5 sm:mt-0 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                    ACTION_BADGE_STYLES[log.action] || ACTION_BADGE_STYLES.UPDATE
                  }`}
                >
                  {log.action.replace('_', ' ')}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {log.userName}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      ({log.userRole})
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700 dark:text-slate-300">
                      {log.entityType}
                      {log.entityId ? ` #${log.entityId}` : ''}
                    </span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 break-words">
                    {log.summary}
                    {log.details ? ` — ${log.details}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
                <span>{formatAuditTime(log.timestamp)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (activities.length === 0 && programs.length === 0) {
    return (
      <div className="space-y-6">
        {renderDashboardTabBar()}

        {dashboardTab === 'timeline' ? (
          <AuditLogTimeline
            logs={timelineAuditLogs}
            loading={loadingAuditLogs}
            isOfficeScoped={isOfficeScoped}
            officeName={userOfficeName}
            onRefresh={fetchAuditTimelineLogs}
            canOpenFullAuditTable={userRole === 'ADMINISTRATOR'}
            onOpenFullAuditTable={() => onNavigate('users')}
          />
        ) : (
          <>
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="max-w-2xl">
                <p className="text-xs font-medium text-[#2563EB] dark:text-sky-400">
                  {isOfficeScoped ? `${userOfficeName} · ` : 'MPDO Initial Setup · '}Fiscal Year {selectedFiscalYear}
                </p>
                <h2 className="mt-2 text-[26px] font-semibold leading-tight text-slate-900 dark:text-slate-100">
                  {isOfficeScoped
                    ? `No PPA Monitoring Records for ${userOfficeName} Yet`
                    : 'No PPA Monitoring Records Loaded Yet'}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {isOfficeScoped
                    ? `Begin by creating your office's Programs and Projects/Activities under "Programs and Activities", or download the official LGU Bula template. Every dashboard figure and chart will update automatically for ${userOfficeName}.`
                    : 'Begin by uploading your existing Monitoring Template.xlsx workbook, downloading the official LGU Bula template, or creating Programs and Activities directly in the system. Every dashboard figure and chart will compute automatically from your saved records.'}
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {userRole === 'ADMINISTRATOR' && (
                    <button
                      type="button"
                      onClick={() => onNavigate('excel')}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e4b7a] whitespace-nowrap shrink-0 transition-colors"
                    >
                      <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                      <span>Import Monitoring Template (.xlsx)</span>
                    </button>
                  )}
                  {(userRole === 'ADMINISTRATOR' || userRole === 'ENCODER') && (
                    <button
                      type="button"
                      onClick={() => onNavigate('programs')}
                      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm whitespace-nowrap shrink-0 transition-colors ${
                        userRole === 'ENCODER'
                          ? 'bg-[#163A5F] font-semibold text-white hover:bg-[#1e4b7a]'
                          : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <FolderPlus className="h-4 w-4" aria-hidden="true" />
                      <span>Add Program &amp; Activity</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onDownloadTemplate}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>Download Official Template (.xlsx)</span>
                  </button>
                  {userRole === 'ADMINISTRATOR' && (
                    <button
                      type="button"
                      onClick={onLoadSampleData}
                      className="inline-flex items-center gap-2 rounded-lg border border-blue-200 dark:border-sky-800 bg-blue-50 dark:bg-sky-950/60 px-4 py-2.5 text-sm font-medium text-[#163A5F] dark:text-sky-300 hover:bg-blue-100 dark:hover:bg-sky-900/60 whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Database className="h-4 w-4" aria-hidden="true" />
                      <span>Load Sample LGU Bula Dataset (Demo)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Activity Widget */}
            {renderRecentActivityWidget()}
          </>
        )}
      </div>
    );
  }

  const highestOffice = officePieSlices[0];
  const lowestOffice =
    officeUtilizationData.length > 1
      ? officeUtilizationData[officeUtilizationData.length - 1]
      : null;

  return (
    <div className="space-y-6">
      {renderDashboardTabBar()}

      {dashboardTab === 'timeline' ? (
        <AuditLogTimeline
          logs={timelineAuditLogs}
          loading={loadingAuditLogs}
          isOfficeScoped={isOfficeScoped}
          officeName={userOfficeName}
          onRefresh={fetchAuditTimelineLogs}
          canOpenFullAuditTable={userRole === 'ADMINISTRATOR'}
          onOpenFullAuditTable={() => onNavigate('users')}
        />
      ) : (
        <>
      {/* Filter Bar */}
      <section className="no-print rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[130px] flex-1">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Fiscal Year</label>
            <select
              value={selectedFiscalYear}
              onChange={(e) => onChangeFiscalYear(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
            >
              <option value="ALL">All Fiscal Years</option>
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.year}>
                  {fy.label}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[180px] flex-[1.4]">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Office / Department</label>
            <select
              disabled={isOfficeScoped}
              value={isOfficeScoped ? userOfficeId : officeFilter}
              onChange={(e) => setOfficeFilter(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/60"
            >
              {!isOfficeScoped && <option value="ALL">All Offices</option>}
              {(isOfficeScoped
                ? offices.filter((o) => o.id === userOfficeId)
                : offices
              ).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} — {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[180px] flex-[1.5]">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Program</label>
            <select
              value={programFilter}
              onChange={(e) => {
                setProgramFilter(e.target.value);
                setActivityFilter('ALL');
              }}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
            >
              <option value="ALL">All Programs</option>
              {fyPrograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.aipRefCode} · {p.title}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[180px] flex-[1.5]">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Project / Activity</label>
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
            >
              <option value="ALL">All Projects &amp; Activities</option>
              {fyActivities
                .filter((a) => programFilter === 'ALL' || a.programId === programFilter)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.referenceNumber} · {a.description}
                  </option>
                ))}
            </select>
          </div>

          <div className="min-w-[150px] flex-1">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Implementation Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
            >
              <option value="ALL">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset</span>
          </button>

          {canQuickAdd && activities.length > 0 && (
            <button
              type="button"
              onClick={openQuickAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e4b7a] whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Quick Add</span>
            </button>
          )}
        </div>
      </section>

      {(() => {
        const overPrograms = filteredPrograms.filter(
          (p) => summarizeProgram(p, filteredActivities).remainingBudget < 0
        );
        if (overPrograms.length === 0) return null;
        return (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/90 dark:bg-red-950/40 px-4 py-3 text-xs text-red-900 dark:text-red-200 flex items-start gap-3"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#DC2626] dark:text-red-400" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                Budget Ceiling Alert: {overPrograms.length} program{overPrograms.length === 1 ? '' : 's'} exceed{overPrograms.length === 1 ? 's' : ''} revised budget allocation
              </p>
              <p className="text-red-700 dark:text-red-300 mt-0.5">
                {overPrograms
                  .slice(0, 3)
                  .map((p) => `${p.aipRefCode} (${p.title})`)
                  .join(' · ')}
                {overPrograms.length > 3 ? ` · +${overPrograms.length - 3} more` : ''}
              </p>
            </div>
          </div>
        );
      })()}

      {/* High-Level PPA Executive Summary */}
      <section
        aria-label="Executive PPA Summary"
        className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-r from-[#163A5F]/[0.04] via-white to-[#0D9488]/[0.04] dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2563EB] dark:text-sky-400">
              Executive PPA Summary · FY {selectedFiscalYear === 'ALL' ? 'All Years' : selectedFiscalYear}
            </p>
            <h2 className="text-base sm:text-[17px] font-semibold text-slate-900 dark:text-slate-100">
              High-Level Performance &amp; Fiscal Standing
            </h2>
          </div>
          <span className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-600 dark:text-slate-300 tabular-nums">
            {executiveSummary.activeOfficeCount} Implementing{' '}
            {executiveSummary.activeOfficeCount === 1 ? 'Office' : 'Offices'}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* KPI 1: Total Active Programs */}
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Total Active Programs
              </p>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#163A5F]/10 dark:bg-sky-500/15 text-[#163A5F] dark:text-sky-400">
                <FolderKanban className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <p className="font-mono text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                {executiveSummary.totalActivePrograms}
              </p>
              {executiveSummary.totalActivePrograms !== summary.totalPrograms && (
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  of {summary.totalPrograms} total
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Covering{' '}
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                {summary.totalActivities}
              </span>{' '}
              filtered PPA{summary.totalActivities === 1 ? '' : 's'} ({summary.ongoingCount} on-going,{' '}
              {summary.pendingCount} pending)
            </p>
          </div>

          {/* KPI 2: Completion Rate Percentage */}
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Completion Rate Percentage
              </p>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
            <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-emerald-700 dark:text-emerald-400 tabular-nums">
              {formatPct(executiveSummary.completionRatePct)}
            </p>
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400 transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, executiveSummary.completionRatePct))}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {summary.completedCount} of {summary.totalActivities} PPAs completed · Physical{' '}
              {formatPct(summary.overallPhysicalPct)}
            </p>
          </div>

          {/* KPI 3: Remaining Budget */}
          <div
            className={`rounded-xl border p-4 ${
              summary.remainingBudget < 0
                ? 'border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-950/30'
                : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950/60'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Remaining Budget
              </p>
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  summary.remainingBudget < 0
                    ? 'bg-red-600/15 text-red-700 dark:text-red-400'
                    : 'bg-[#0D9488]/10 dark:bg-teal-500/15 text-[#0D9488] dark:text-teal-400'
                }`}
              >
                <Wallet className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
            <p
              className={`mt-2 font-mono text-2xl sm:text-3xl font-bold tracking-tight tabular-nums ${
                summary.remainingBudget < 0
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-[#163A5F] dark:text-sky-400'
              }`}
            >
              {formatPHP(summary.remainingBudget)}
            </p>
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  summary.remainingBudget < 0
                    ? 'bg-red-600 dark:bg-red-400'
                    : 'bg-[#0D9488] dark:bg-teal-400'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(0, executiveSummary.remainingBudgetPct))}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
              {summary.remainingBudget < 0
                ? 'Over revised allocation ceiling'
                : `${formatPct(executiveSummary.remainingBudgetPct)} unspent of ${formatCompactPHP(
                    summary.totalRevisedBudget
                  )} revised`}
            </p>
          </div>
        </div>
      </section>

      {/* Primary KPI Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Programs &amp; Activities</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#163A5F]/10 dark:bg-sky-500/15 text-[#163A5F] dark:text-sky-400">
              <FolderKanban className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <p className="font-mono text-[26px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
              {summary.totalPrograms} Programs
            </p>
            <span className="font-mono text-[13px] font-semibold text-[#2563EB] dark:text-sky-400 tabular-nums">
              {summary.totalActivities} PPAs
            </span>
          </div>
          <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
            Active records for FY {selectedFiscalYear === 'ALL' ? 'All' : selectedFiscalYear}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Total Approved Budget</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB]/10 dark:bg-blue-500/15 text-[#2563EB] dark:text-blue-400">
              <Banknote className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <p className="mt-2 font-mono text-[26px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
            {formatPHP(summary.totalApprovedBudget)}
          </p>
          <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            PS {formatCompactPHP(summary.totalPS)} · MOOE {formatCompactPHP(summary.totalMOOE)} · CO{' '}
            {formatCompactPHP(summary.totalCO)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Total Revised Budget</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0D9488]/10 dark:bg-teal-500/15 text-[#0D9488] dark:text-teal-400">
              <Coins className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <p className="mt-2 font-mono text-[26px] leading-tight font-semibold tracking-tight text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPHP(summary.totalRevisedBudget)}
          </p>
          <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Approved − 15% reserve (PS Exempt)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">Total Expenditures</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <p className="mt-2 font-mono text-[26px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
            {formatPHP(summary.totalBudgetUtilized)}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#2563EB] dark:bg-sky-400 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, summary.budgetUtilizationPct))}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums truncate">
            Remaining: {formatPHP(summary.remainingBudget)} ({formatPct(summary.budgetUtilizationPct)})
          </p>
        </div>
      </section>

      {/* Accomplishment % & Status Breakdown Row */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <div
          className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 lg:col-span-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          title="Formula: (Sum of Monthly Physical Actual across every Program / Sum of Monthly Physical Target across every Program) × 100"
        >
          <div className="flex items-center justify-between gap-1.5">
            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
              Overall Physical Accomplishment
            </p>
            <Target className="h-4 w-4 shrink-0 text-[#0D9488] dark:text-teal-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[26px] leading-tight font-semibold tracking-tight text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPct(summary.overallPhysicalPct)}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#0D9488] dark:bg-teal-400 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, summary.overallPhysicalPct))}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {formatQty(summary.totalPhysicalActual)} / {formatQty(summary.totalPhysicalTarget)}
          </p>
        </div>

        <div
          className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 lg:col-span-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          title="Formula: (Total Expenditure of all Programs / Total Revised Budget) × 100"
        >
          <div className="flex items-center justify-between gap-1.5">
            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">
              Overall Financial Accomplishment
            </p>
            <BarChart3 className="h-4 w-4 shrink-0 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-[26px] leading-tight font-semibold tracking-tight text-[#163A5F] dark:text-sky-400 tabular-nums">
            {formatPct(summary.overallFinancialPct)}
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#2563EB] dark:bg-sky-400 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, summary.overallFinancialPct))}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            {formatCompactPHP(summary.totalFinancialActual)} / {formatCompactPHP(summary.totalRevisedBudget)}
          </p>
        </div>

        {statusDistData.map((st) => (
          <div
            key={st.name}
            className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <p className={`text-xs font-semibold ${STATUS_TEXT_CLASSES[st.name]}`}>
              {st.name}
            </p>
            <div className="mt-2 flex items-baseline justify-between">
              <p className="font-mono text-[26px] leading-tight font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                {st.value}
              </p>
              <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                {formatPct(st.pct)}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, st.pct))}%`,
                  backgroundColor: STATUS_COLORS[st.name],
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {st.value === 1 ? '1 activity' : `${st.value} activities`}
            </p>
          </div>
        ))}
      </section>

      {/* Charts Row 1: Budget Utilization vs. Physical Accomplishment Overlay & Monthly Financial Accomplishment */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Quarterly Overlay Chart */}
        <div className="min-w-0 print-avoid-break rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                Budget Utilization vs. Physical Accomplishment
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Spending efficiency against target physical output progress across fiscal quarters
              </p>
            </div>
            <div
              className="no-print inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px] font-semibold"
              role="group"
              aria-label="Quarterly chart mode"
            >
              <button
                type="button"
                onClick={() => setQuarterChartMode('cumulative')}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  quarterChartMode === 'cumulative'
                    ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Cumulative YTD
              </button>
              <button
                type="button"
                onClick={() => setQuarterChartMode('quarterly')}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  quarterChartMode === 'quarterly'
                    ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Per Quarter
              </button>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={quarterlyOverlayData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="quarter" tick={{ fontSize: 12, fill: tickColor }} />
                <YAxis
                  tick={{ fontSize: 11, fill: tickColor }}
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  domain={[0, (dataMax: number) => Math.max(100, Math.ceil(dataMax / 10) * 10)]}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name, props) => {
                    const row = props?.payload as
                      | {
                          expenditure: number;
                          revisedBudget: number;
                          physicalActual: number;
                          physicalTarget: number;
                        }
                      | undefined;
                    const pct = formatPct(Number(value));
                    if (name === 'Budget Utilization (%)') {
                      return [
                        `${pct} (${formatCompactPHP(row?.expenditure ?? 0)} / ${formatCompactPHP(
                          row?.revisedBudget ?? 0
                        )})`,
                        name,
                      ];
                    }
                    return [
                      `${pct} (${formatQty(row?.physicalActual ?? 0)} / ${formatQty(
                        row?.physicalTarget ?? 0
                      )} outputs)`,
                      name,
                    ];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="budgetUtilizationPct"
                  name="Budget Utilization (%)"
                  fill={isDark ? '#2563EB' : '#163A5F'}
                  radius={[5, 5, 0, 0]}
                  barSize={38}
                />
                <Line
                  type="monotone"
                  dataKey="physicalAccomplishmentPct"
                  name="Physical Accomplishment (%)"
                  stroke={isDark ? '#2DD4BF' : '#0D9488'}
                  strokeWidth={2.75}
                  dot={{ r: 5, strokeWidth: 2, fill: isDark ? '#0F172A' : '#FFFFFF' }}
                  activeDot={{ r: 7 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Financial Accomplishment */}
        <div className="min-w-0 print-avoid-break rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4">
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Monthly Financial Accomplishment (Jan – Dec)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Monthly financial targets versus actual expenditures in Philippine Peso
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={summary.monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: tickColor }} />
                <YAxis
                  tick={{ fontSize: 11, fill: tickColor }}
                  tickFormatter={(v) => formatCompactPHP(Number(v))}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatPHP(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="financialTarget" name="Financial Target" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="financialActual"
                  name="Financial Actual"
                  fill={isDark ? '#38BDF8' : '#163A5F'}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Charts Row 2: Physical vs Target, Financial vs Budget, Status Distribution, Budget Utilization by Office */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="min-w-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4">
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Physical Accomplishment vs. Target
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Program-level annual output comparison</p>
          </div>
          {programChartData.length === 0 ? (
            <div className="flex h-72 items-center justify-center px-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No programs match the selected filters.
              </p>
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={programChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: tickColor }} hide={programChartData.length > 5} />
                  <YAxis tick={{ fontSize: 11, fill: tickColor }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="physicalTarget" name="Target" fill={isDark ? '#475569' : '#CBD5E1'} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="physicalActual" name="Actual" fill="#0D9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4">
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Financial Accomplishment vs. Budget
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Revised budget versus cumulative utilization</p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart
                data={[
                  {
                    name: 'Aggregate FY Totals',
                    approved: summary.totalApprovedBudget,
                    revised: summary.totalRevisedBudget,
                    utilized: summary.totalBudgetUtilized,
                  },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: tickColor }} />
                <YAxis
                  tick={{ fontSize: 11, fill: tickColor }}
                  tickFormatter={(v) => formatCompactPHP(Number(v))}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatPHP(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="approved" name="Approved Budget" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="revised"
                  name="Revised Budget"
                  fill={isDark ? '#0284C7' : '#163A5F'}
                  radius={[4, 4, 0, 0]}
                />
                <Bar dataKey="utilized" name="Budget Utilized" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4">
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              PPA Implementation Status Distribution
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Breakdown across {summary.totalActivities} activities</p>
          </div>
          {statusDistData.every((d) => d.value === 0) ? (
            <div className="flex h-72 items-center justify-center px-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No activities match the selected filters.
              </p>
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart>
                  <Pie
                    data={statusDistData.filter((d) => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={50}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {statusDistData
                      .filter((d) => d.value > 0)
                      .map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                      ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Budget Utilization by Office Pie Chart */}
        <div className="min-w-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-3">
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Budget Utilization by Office
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Share of cumulative expenditure across implementing offices
            </p>
          </div>

          {officePieSlices.length === 0 ? (
            <div className="flex-1 flex items-center justify-center h-64 text-center px-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No expenditure recorded for the selected filters yet. Encode monthly financial actuals to compare office expenditure levels.
              </p>
            </div>
          ) : (
            <>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart>
                    <Pie
                      data={officePieSlices}
                      dataKey="utilized"
                      nameKey="code"
                      cx="50%"
                      cy="45%"
                      innerRadius={44}
                      outerRadius={76}
                      paddingAngle={2}
                    >
                      {officePieSlices.map((entry, idx) => (
                        <Cell
                          key={entry.key}
                          fill={pieColors[idx % pieColors.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(val, _name, props) => {
                        const row = props?.payload as
                          | {
                              officeName: string;
                              sharePct: number;
                              utilizationRatePct: number;
                            }
                          | undefined;
                        return [
                          `${formatPHP(Number(val))} (${formatPct(row?.sharePct ?? 0)} share · ${formatPct(
                            row?.utilizationRatePct ?? 0
                          )} of budget)`,
                          row?.officeName || 'Office',
                        ];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {highestOffice && (
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Highest Spend:</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {highestOffice.code} ({formatCompactPHP(highestOffice.utilized)})
                    </span>
                  </div>
                  {lowestOffice && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 dark:text-slate-400">Lowest Spend:</span>
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 truncate">
                        {lowestOffice.code} ({formatCompactPHP(lowestOffice.utilized)})
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Charts Row 3: Budget Allocation by Program & Budget Utilization by Program */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="min-w-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4">
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">Budget Allocation by Program</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Approved versus Revised Budget per program</p>
          </div>
          {programChartData.length === 0 ? (
            <div className="flex h-80 items-center justify-center px-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No programs match the selected filters.
              </p>
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={programChartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: tickColor }}
                    tickFormatter={(v) => formatCompactPHP(Number(v))}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={160}
                    tick={{ fontSize: 11, fill: tickColor }}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatPHP(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="approvedBudget" name="Approved Budget" fill="#94A3B8" radius={[0, 4, 4, 0]} />
                  <Bar
                    dataKey="revisedBudget"
                    name="Revised Budget"
                    fill={isDark ? '#38BDF8' : '#163A5F'}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="mb-4">
            <h3 className="text-[15px] sm:text-base font-semibold text-slate-900 dark:text-slate-100">Budget Utilization by Program</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Revised allocation versus actual utilization per program</p>
          </div>
          {programChartData.length === 0 ? (
            <div className="flex h-80 items-center justify-center px-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No programs match the selected filters.
              </p>
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={programChartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: tickColor }}
                    tickFormatter={(v) => formatCompactPHP(Number(v))}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={160}
                    tick={{ fontSize: 11, fill: tickColor }}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatPHP(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="revisedBudget"
                    name="Revised Budget"
                    fill={isDark ? '#475569' : '#CBD5E1'}
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar dataKey="utilized" name="Budget Utilized" fill="#2563EB" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* Recent Activity Widget */}
      {renderRecentActivityWidget()}
        </>
      )}

      {/* Global Quick Add Daily / Periodic Accomplishment Modal */}
      {quickAddOpen && selectedQuickActivity && (
        <div
          ref={quickAddModalRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] dark:bg-slate-950/75 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-add-title"
        >
          <div className="my-6 w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-fade-in">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 px-6 py-4 bg-[#163A5F] text-white">
              <div>
                <p className="text-xs font-medium text-blue-200">
                  Global Daily / Periodic Accomplishment Entry
                </p>
                <h3 id="quick-add-title" className="mt-0.5 text-[18px] font-semibold">
                  Quick Add Accomplishment &amp; Expenditure
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuickAddOpen(false)}
                className="rounded-lg p-1 text-blue-200 hover:bg-white/10 hover:text-white"
                aria-label="Close quick add modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleQuickAddSubmit} className="max-h-[80vh] overflow-y-auto p-6 space-y-4">
              {qaSavedBanner && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                  {qaSavedBanner}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Project / Activity *
                  </label>
                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={qaSearch}
                      onChange={(e) => setQaSearch(e.target.value)}
                      placeholder="Filter activities..."
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>
                <select
                  value={matchedQuickActivity?.id || ''}
                  disabled={quickAddPool.length === 0}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setQaActivityId(nextId);
                    setQaSavedBanner(null);
                    if (qaMode === 'set') {
                      const nextAct = quickAddPool.find((a) => a.id === nextId);
                      if (nextAct) {
                        setQaPhysical(String(nextAct.monthly[qaMonth].physicalActual));
                        setQaExpenditure(String(nextAct.monthly[qaMonth].financialActual));
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
                >
                  {quickAddPool.length === 0 ? (
                    <option value="">No matching activities found</option>
                  ) : (
                    quickAddPool.map((a) => (
                      <option key={a.id} value={a.id}>
                        [{a.fiscalYear}] {a.referenceNumber} · {a.description}
                      </option>
                    ))
                  )}
                </select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Target Outputs: {matchedQuickActivity?.targetOutputs || 'No target output specified'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Period / Month *</label>
                  <select
                    value={qaMonth}
                    onChange={(e) => {
                      const nextMonth = e.target.value as MonthKey;
                      setQaMonth(nextMonth);
                      if (qaMode === 'set' && matchedQuickActivity) {
                        setQaPhysical(String(matchedQuickActivity.monthly[nextMonth].physicalActual));
                        setQaExpenditure(String(matchedQuickActivity.monthly[nextMonth].financialActual));
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  >
                    {MONTHS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Accomplishment Date</label>
                  <input
                    type="date"
                    value={qaDate}
                    onChange={(e) => setQaDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              {/* Entry Mode */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Entry Mode
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => setQaMode('add')}
                    className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                      qaMode === 'add'
                        ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Add to Existing Month (Daily)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQaMode('set');
                      if (matchedQuickActivity) {
                        setQaPhysical(
                          String(matchedQuickActivity.monthly[qaMonth].physicalActual)
                        );
                        setQaExpenditure(
                          String(matchedQuickActivity.monthly[qaMonth].financialActual)
                        );
                      }
                    }}
                    className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                      qaMode === 'set'
                        ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Set Month Total (Periodic)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {qaMode === 'add' ? 'Physical Accomplishment (+)' : 'Physical Actual Total'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={qaPhysical}
                    onChange={(e) => setQaPhysical(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {qaMode === 'add' ? 'Expenditure Added (₱)' : 'Expenditure Total (₱)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={qaExpenditure}
                    onChange={(e) => setQaExpenditure(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              {/* Current & Resulting Preview */}
              {quickAddPreview && (
                <div className="rounded-lg border border-blue-200 dark:border-sky-800/60 bg-blue-50/70 dark:bg-slate-800/80 p-3.5 text-xs space-y-2">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    {MONTHS.find((m) => m.key === qaMonth)?.label} Accomplishment &amp; Budget Impact
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono tabular-nums">
                    <div>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        Physical (Current → New)
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatQty(quickAddPreview.existingMonth.physicalActual)} →{' '}
                        <span className="text-[#163A5F] dark:text-sky-400">
                          {formatQty(quickAddPreview.nextMonthPhys)}
                        </span>{' '}
                        / {formatQty(quickAddPreview.existingMonth.physicalTarget)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        Expenditure (Current → New)
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatPHP(quickAddPreview.existingMonth.financialActual)} →{' '}
                        <span className="text-[#163A5F] dark:text-sky-400">
                          {formatPHP(quickAddPreview.nextMonthFin)}
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        Remaining Budget
                      </span>
                      <span
                        className={`font-bold ${
                          quickAddPreview.nextRemaining < 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {formatPHP(quickAddPreview.nextRemaining)}
                      </span>
                    </div>
                  </div>
                  {quickAddPreview.nextRemaining < 0 && (
                    <div
                      role="alert"
                      className="mt-2 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs text-red-800 dark:text-red-200 flex items-start gap-2"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                      <span>
                        <strong className="font-semibold">Budget Ceiling Warning:</strong> Saving this entry puts remaining budget at{' '}
                        <strong className="font-mono">{formatPHP(quickAddPreview.nextRemaining)}</strong> (revised ceiling: {formatPHP(quickAddPreview.revisedBudget)}).
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Implementation Status (Optional)
                </label>
                <select
                  value={qaStatus}
                  onChange={(e) =>
                    setQaStatus(e.target.value as ImplementationStatus | 'KEEP')
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="KEEP">
                    Keep Current ({(matchedQuickActivity || selectedQuickActivity).status})
                  </option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Daily / Periodic Accomplishment Note / Remarks
                </label>
                <textarea
                  rows={2}
                  value={qaNote}
                  onChange={(e) => setQaNote(e.target.value)}
                  placeholder="Describe daily accomplishment or expenditure voucher reference..."
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setQuickAddOpen(false)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={qaSaving || !matchedQuickActivity}
                  onClick={() => saveQuickAdd(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#163A5F] dark:border-sky-500 px-4 py-2 text-sm font-semibold text-[#163A5F] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-sky-950/40 disabled:opacity-50 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>{qaSaving ? 'Saving...' : 'Save & Add Another'}</span>
                </button>
                <button
                  type="submit"
                  disabled={qaSaving || !matchedQuickActivity}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e4b7a] disabled:opacity-50 transition-colors"
                >
                  <Save className="h-4 w-4" />
                  <span>{qaSaving ? 'Saving...' : 'Save Accomplishment'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
