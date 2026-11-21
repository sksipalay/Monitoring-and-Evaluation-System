import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  FolderPlus,
  GripVertical,
  History,
  Link2,
  Paperclip,
  Plus,
  PlusCircle,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Activity,
  ActivityComputed,
  ActivityEvidenceItem,
  ActivityMilestone,
  AuditLog,
  BudgetClassification,
  FiscalYear,
  ImplementationStatus,
  MilestoneStatus,
  MonthKey,
  Office,
  Program,
  UserRole,
} from '../../types/ppa';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import {
  MONTHS,
  STATUS_OPTIONS,
  calculateRevisedBudgetByFund,
  createEmptyMonthlyData,
  createEmptyMonthlyPhysicalTargets,
  formatPHP,
  formatPct,
  formatQty,
  getProgramSupplementalBreakdown,
  isPersonnelServicesFund,
  normalizeMonthlyPhysicalTargets,
  resolveActivityBudgetDisplay,
  round2,
  safeNum,
  sumMonthlyPhysicalTargets,
  summarizeProgram,
} from '../../utils/calculations';
import { StatusBadge } from '../ui/StatusBadge';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  canEditPpaStructure,
  canEditStatusOrRemarks,
  isOfficeScopedRole,
} from '../../utils/rbac';
import { PpaTimelineChart } from '../ui/PpaTimelineChart';
import { SupplementalBudgetModal } from '../modals/SupplementalBudgetModal';

interface ProgramsActivitiesModuleProps {
  programs: Program[];
  activities: ActivityComputed[];
  offices: Office[];
  fiscalYears: FiscalYear[];
  auditLogs?: AuditLog[];
  selectedFiscalYear: string;
  userRole: UserRole;
  userUid: string;
  userName?: string;
  userOfficeId?: string;
  userOfficeName?: string;
  globalSearchRequest?: {
    query: string;
    officeId?: string;
    nonce: number;
  } | null;
  onCreateProgram: (program: Program) => Promise<void>;
  onUpdateProgram: (program: Program) => Promise<void>;
  onDeleteProgram: (id: string) => Promise<void>;
  onCreateActivity: (activity: Activity) => Promise<void>;
  onUpdateActivity: (activity: Activity) => Promise<void>;
  onDeleteActivity: (id: string) => Promise<void>;
  onBulkDeleteActivities?: (ids: string[]) => Promise<void>;
  onReorderActivities?: (updates: { id: string; orderIndex: number }[]) => Promise<void>;
}

const SOURCE_OF_FUND_OPTIONS = [
  'Personnel Services (PS)',
  'Maintenance and Other Operating Expenses (MOOE)',
  'Capital Outlay (CO)',
  'General Fund (GF)',
];

function sourceOfFundToBudgetClass(sourceOfFund: string): BudgetClassification {
  if (sourceOfFund === 'Personnel Services (PS)') return 'PS';
  if (sourceOfFund === 'Maintenance and Other Operating Expenses (MOOE)') return 'MOOE';
  if (sourceOfFund === 'Capital Outlay (CO)') return 'CO';
  return 'GF';
}

function inferSourceOfFundFromActivity(
  act: ActivityComputed,
  parentProg?: Program
): string {
  if (act.sourceOfFund && SOURCE_OF_FUND_OPTIONS.includes(act.sourceOfFund)) {
    return act.sourceOfFund;
  }
  if (act.budgetClassification === 'PS') return 'Personnel Services (PS)';
  if (act.budgetClassification === 'CO') return 'Capital Outlay (CO)';
  if (act.budgetClassification === 'MOOE') {
    return 'Maintenance and Other Operating Expenses (MOOE)';
  }
  if (act.budgetClassification === 'GF') return 'General Fund (GF)';
  if (parentProg?.sourceOfFund && SOURCE_OF_FUND_OPTIONS.includes(parentProg.sourceOfFund)) {
    return parentProg.sourceOfFund;
  }
  return 'General Fund (GF)';
}

function buildMonthlyExpenditureMap(act?: ActivityComputed | null): Record<MonthKey, number> {
  const map = {} as Record<MonthKey, number>;
  for (const m of MONTHS) {
    map[m.key] = act ? round2(safeNum(act.monthly[m.key]?.financialActual)) : 0;
  }
  return map;
}

function buildMonthlyPhysicalActualMap(act?: ActivityComputed | null): Record<MonthKey, number> {
  const map = {} as Record<MonthKey, number>;
  for (const m of MONTHS) {
    map[m.key] = act ? safeNum(act.monthly[m.key]?.physicalActual) : 0;
  }
  return map;
}

function isSafeExternalUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ProgramsActivitiesModule({
  programs,
  activities,
  offices,
  fiscalYears,
  auditLogs = [],
  selectedFiscalYear,
  userRole,
  userUid,
  userName = '',
  userOfficeId = '',
  userOfficeName = '',
  globalSearchRequest = null,
  onCreateProgram,
  onUpdateProgram,
  onDeleteProgram,
  onCreateActivity,
  onUpdateActivity,
  onDeleteActivity,
  onBulkDeleteActivities,
  onReorderActivities,
}: ProgramsActivitiesModuleProps) {
  const isOfficeScoped = isOfficeScopedRole(userRole) && Boolean(userOfficeId);
  const canEditStructure = canEditPpaStructure(userRole);
  const canEditStatusRemarks = canEditStatusOrRemarks(userRole);
  const canBulkSelect = canEditStructure && Boolean(onBulkDeleteActivities);

  const [search, setSearch] = useState('');
  const [officeFilter, setOfficeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortField, setSortField] = useState<
    'ref' | 'approved' | 'revised' | 'expenditure' | null
  >(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [collapsedPrograms, setCollapsedPrograms] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Bulk selection state
  const [selectedActivityIds, setSelectedActivityIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Drag-and-drop PPA reordering state
  const [draggedAct, setDraggedAct] = useState<{ id: string; scopeKey: string } | null>(null);
  const [dragOverActId, setDragOverActId] = useState<string | null>(null);
  const [reorderingBusy, setReorderingBusy] = useState(false);
  const canDragReorder =
    canEditStructure && Boolean(onReorderActivities) && sortField === null && !reorderingBusy;

  // Sync external Global Search jump requests
  useEffect(() => {
    if (!globalSearchRequest) return;
    setSearch(globalSearchRequest.query || '');
    setOfficeFilter(
      !isOfficeScoped && globalSearchRequest.officeId ? globalSearchRequest.officeId : 'ALL'
    );
    setStatusFilter('ALL');
    setCollapsedPrograms({});
    setPage(1);
  }, [globalSearchRequest, isOfficeScoped]);

  // Modals
  const [programModalOpen, setProgramModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [progForm, setProgForm] = useState({
    title: '',
    targetOutputs: '',
    budget: 0,
    monthlyPhysicalTarget: createEmptyMonthlyPhysicalTargets(),
    sourceOfFund: SOURCE_OF_FUND_OPTIONS[3],
    gadFund: false,
    status: 'PENDING' as ImplementationStatus,
    officeId: isOfficeScoped ? userOfficeId : offices[0]?.id || '',
    parentProgramId: '',
  });

  const currentMonthKey: MonthKey = MONTHS[new Date().getMonth()]?.key || 'jan';
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityComputed | null>(null);
  const [monthlyExpenditures, setMonthlyExpenditures] = useState<Record<MonthKey, number>>(() =>
    buildMonthlyExpenditureMap(null)
  );
  const [monthlyPhysicalActuals, setMonthlyPhysicalActuals] = useState<Record<MonthKey, number>>(
    () => buildMonthlyPhysicalActualMap(null)
  );
  const [actForm, setActForm] = useState({
    programId: '',
    subprogramId: '',
    description: '',
    targetOutputs: '',
    officeId: isOfficeScoped ? userOfficeId : offices[0]?.id || '',
    sourceOfFund: SOURCE_OF_FUND_OPTIONS[1],
    month: currentMonthKey,
    expenditure: 0,
    physicalActual: 0,
    remarks: '',
  });

  const [detailActivity, setDetailActivity] = useState<ActivityComputed | null>(null);
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('');
  const [newMilestoneDueDate, setNewMilestoneDueDate] = useState('');
  const [milestoneBusy, setMilestoneBusy] = useState(false);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);
  const [newEvidenceTitle, setNewEvidenceTitle] = useState('');
  const [newEvidenceNote, setNewEvidenceNote] = useState('');
  const [newEvidenceUrl, setNewEvidenceUrl] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);

  const [actEvidenceDraft, setActEvidenceDraft] = useState<ActivityEvidenceItem[]>([]);
  const [formEvTitle, setFormEvTitle] = useState('');
  const [formEvNote, setFormEvNote] = useState('');
  const [formEvUrl, setFormEvUrl] = useState('');
  const [formEvError, setFormEvError] = useState<string | null>(null);

  const [supplementalProgram, setSupplementalProgram] = useState<Program | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'program' | 'activity' | 'bulk_activity';
    id: string;
    ids?: string[];
    label: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNewMilestoneTitle('');
    setNewMilestoneDueDate('');
    setMilestoneError(null);
    setNewEvidenceTitle('');
    setNewEvidenceNote('');
    setNewEvidenceUrl('');
    setEvidenceError(null);
  }, [detailActivity?.id]);

  const programModalRef = useModalFocusTrap<HTMLDivElement>(
    programModalOpen,
    () => setProgramModalOpen(false)
  );
  const activityModalRef = useModalFocusTrap<HTMLDivElement>(
    activityModalOpen,
    () => setActivityModalOpen(false)
  );
  const detailModalRef = useModalFocusTrap<HTMLDivElement>(
    Boolean(detailActivity),
    () => setDetailActivity(null)
  );

  const fyPrograms = useMemo(
    () =>
      programs
        .filter((p) => selectedFiscalYear === 'ALL' || p.fiscalYear === selectedFiscalYear)
        .sort((a, b) => a.orderIndex - b.orderIndex || a.aipRefCode.localeCompare(b.aipRefCode)),
    [programs, selectedFiscalYear]
  );

  const topPrograms = useMemo(() => fyPrograms.filter((p) => !p.parentProgramId), [fyPrograms]);
  const subprogramsByParent = useMemo(() => {
    const map = new Map<string, Program[]>();
    for (const p of fyPrograms) {
      if (p.parentProgramId) {
        const list = map.get(p.parentProgramId) || [];
        list.push(p);
        map.set(p.parentProgramId, list);
      }
    }
    return map;
  }, [fyPrograms]);

  const filteredActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = activities.filter((a) => {
      if (selectedFiscalYear !== 'ALL' && a.fiscalYear !== selectedFiscalYear) return false;
      if (officeFilter !== 'ALL' && a.officeId !== officeFilter) return false;
      if (q) {
        const hay = `${a.referenceNumber} ${a.description} ${a.targetOutputs} ${a.officeName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (!sortField) {
      return [...list].sort((a, b) => {
        const orderDiff =
          (a.orderIndex ?? Number.MAX_SAFE_INTEGER) -
          (b.orderIndex ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) return orderDiff;
        return a.referenceNumber.localeCompare(b.referenceNumber);
      });
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortField === 'ref') return a.referenceNumber.localeCompare(b.referenceNumber) * dir;
      if (sortField === 'approved') return (a.approvedBudget - b.approvedBudget) * dir;
      if (sortField === 'revised') return (a.revisedBudget - b.revisedBudget) * dir;
      if (sortField === 'expenditure')
        return (a.annualFinancialActual - b.annualFinancialActual) * dir;
      return 0;
    });
  }, [activities, selectedFiscalYear, officeFilter, search, sortField, sortDir]);

  // Keep selected IDs synced to currently visible filtered activities
  const visibleSelectedIds = useMemo(() => {
    const visibleSet = new Set(filteredActivities.map((a) => a.id));
    return selectedActivityIds.filter((id) => visibleSet.has(id));
  }, [selectedActivityIds, filteredActivities]);

  const selectedSet = useMemo(() => new Set(visibleSelectedIds), [visibleSelectedIds]);

  const toggleSort = (field: 'ref' | 'approved' | 'revised' | 'expenditure') => {
    if (sortField === field) {
      if (sortDir === 'asc') setSortDir('desc');
      else setSortField(null);
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const toggleSelectActivity = (id: string) => {
    setSelectedActivityIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectGroup = (ids: string[]) => {
    if (ids.length === 0) return;
    const allSelected = ids.every((id) => selectedSet.has(id));
    setSelectedActivityIds((prev) => {
      if (allSelected) {
        const drop = new Set(ids);
        return prev.filter((id) => !drop.has(id));
      }
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return Array.from(next);
    });
  };

  const getActivityScopeKey = (act: ActivityComputed) =>
    `${act.programId}::${act.subprogramId || 'DIRECT'}`;

  const handleActivityDragStart = (
    e: React.DragEvent<HTMLTableRowElement>,
    act: ActivityComputed
  ) => {
    if (!canDragReorder) {
      e.preventDefault();
      return;
    }
    const scopeKey = getActivityScopeKey(act);
    setDraggedAct({ id: act.id, scopeKey });
    setDragOverActId(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', act.id);
  };

  const handleActivityDragOver = (
    e: React.DragEvent<HTMLTableRowElement>,
    targetAct: ActivityComputed
  ) => {
    if (!draggedAct || !canDragReorder) return;
    if (
      draggedAct.id === targetAct.id ||
      draggedAct.scopeKey !== getActivityScopeKey(targetAct)
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverActId !== targetAct.id) {
      setDragOverActId(targetAct.id);
    }
  };

  const handleActivityDrop = async (
    e: React.DragEvent<HTMLTableRowElement>,
    targetAct: ActivityComputed
  ) => {
    e.preventDefault();
    if (!draggedAct || !onReorderActivities || !canDragReorder) {
      setDraggedAct(null);
      setDragOverActId(null);
      return;
    }
    const targetScope = getActivityScopeKey(targetAct);
    if (draggedAct.id === targetAct.id || draggedAct.scopeKey !== targetScope) {
      setDraggedAct(null);
      setDragOverActId(null);
      return;
    }

    const siblings = activities
      .filter(
        (a) =>
          a.programId === targetAct.programId &&
          (a.subprogramId || null) === (targetAct.subprogramId || null) &&
          (selectedFiscalYear === 'ALL' || a.fiscalYear === selectedFiscalYear)
      )
      .sort((a, b) => {
        const orderDiff =
          (a.orderIndex ?? Number.MAX_SAFE_INTEGER) -
          (b.orderIndex ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) return orderDiff;
        return a.referenceNumber.localeCompare(b.referenceNumber);
      });

    const fromIndex = siblings.findIndex((a) => a.id === draggedAct.id);
    const toIndex = siblings.findIndex((a) => a.id === targetAct.id);

    setDraggedAct(null);
    setDragOverActId(null);

    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const reordered = [...siblings];
    const [movedItem] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedItem);

    const updates = reordered.map((item, idx) => ({
      id: item.id,
      orderIndex: idx + 1,
    }));

    setReorderingBusy(true);
    try {
      await onReorderActivities(updates);
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setReorderingBusy(false);
    }
  };

  const handleActivityDragEnd = () => {
    setDraggedAct(null);
    setDragOverActId(null);
  };

  const visibleTopPrograms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && officeFilter === 'ALL' && statusFilter === 'ALL') return topPrograms;
    const matchedProgIds = new Set(filteredActivities.map((a) => a.programId));
    return topPrograms.filter((p) => {
      const progStatus = p.status || 'PENDING';
      if (statusFilter !== 'ALL' && progStatus !== statusFilter) return false;
      if (q || officeFilter !== 'ALL') {
        if (matchedProgIds.has(p.id)) return true;
        if (officeFilter !== 'ALL' && p.officeId !== officeFilter) return false;
        if (q) {
          return `${p.aipRefCode} ${p.title} ${p.targetOutputs || ''} ${p.officeName}`.toLowerCase().includes(q);
        }
      }
      return true;
    });
  }, [topPrograms, filteredActivities, search, officeFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleTopPrograms.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedPrograms = visibleTopPrograms.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selectedParentProgram = useMemo(
    () => programs.find((p) => p.id === actForm.programId) || null,
    [programs, actForm.programId]
  );

  const ppaBudgetPreview = useMemo(() => {
    const siblingActs = activities.filter((a) => a.programId === actForm.programId);
    const siblingsExceptCurrent = editingActivity
      ? siblingActs.filter((a) => a.id !== editingActivity.id)
      : siblingActs;

    const currentActivityUtilized = round2(
      MONTHS.reduce((sum, m) => sum + safeNum(monthlyExpenditures[m.key]), 0)
    );

    const isPsExempt = isPersonnelServicesFund(actForm.sourceOfFund);
    let approvedAmount = 0;
    let revisedAmount = 0;
    let utilizedAmount = 0;

    if (editingActivity && editingActivity.approvedBudget > 0) {
      approvedAmount = editingActivity.approvedBudget;
      const hasMixedFunds =
        editingActivity.ps > 0 &&
        (safeNum(editingActivity.gf) > 0 ||
          editingActivity.mooe > 0 ||
          editingActivity.co > 0);
      revisedAmount = calculateRevisedBudgetByFund(
        approvedAmount,
        actForm.sourceOfFund,
        hasMixedFunds
          ? {
              gf: editingActivity.gf,
              ps: editingActivity.ps,
              mooe: editingActivity.mooe,
              co: editingActivity.co,
            }
          : undefined
      );
      utilizedAmount = currentActivityUtilized;
    } else {
      const programApproved =
        selectedParentProgram && safeNum(selectedParentProgram.budget) > 0
          ? round2(safeNum(selectedParentProgram.budget))
          : 0;
      const sumActivitiesApproved = round2(
        siblingActs.reduce((acc, a) => acc + a.approvedBudget, 0)
      );
      approvedAmount = programApproved > 0 ? programApproved : sumActivitiesApproved;
      revisedAmount = calculateRevisedBudgetByFund(approvedAmount, actForm.sourceOfFund);

      const otherSiblingsUtilized = siblingsExceptCurrent.reduce(
        (acc, a) => acc + a.annualFinancialActual,
        0
      );
      utilizedAmount = round2(otherSiblingsUtilized + currentActivityUtilized);
    }

    const remainingAmount = round2(revisedAmount - utilizedAmount);
    return {
      approvedAmount,
      revisedAmount,
      utilizedAmount,
      remainingAmount,
      isPsExempt,
      isProgramLevel: !(editingActivity && editingActivity.approvedBudget > 0),
    };
  }, [
    activities,
    actForm.programId,
    actForm.sourceOfFund,
    monthlyExpenditures,
    editingActivity,
    selectedParentProgram,
  ]);

  const resolveActiveFiscalYear = () =>
    selectedFiscalYear === 'ALL'
      ? fiscalYears.find((f) => f.isDefault)?.year || fiscalYears[0]?.year || '2026'
      : selectedFiscalYear;

  const openNewProgram = () => {
    setEditingProgram(null);
    setProgForm({
      title: '',
      targetOutputs: '',
      budget: 0,
      monthlyPhysicalTarget: createEmptyMonthlyPhysicalTargets(),
      sourceOfFund: SOURCE_OF_FUND_OPTIONS[3],
      gadFund: false,
      status: 'PENDING',
      officeId: isOfficeScoped ? userOfficeId : offices[0]?.id || '',
      parentProgramId: '',
    });
    setProgramModalOpen(true);
  };

  const openEditProgram = (prog: Program) => {
    setEditingProgram(prog);
    setProgForm({
      title: prog.title,
      targetOutputs: prog.targetOutputs || '',
      budget: prog.budget ?? 0,
      monthlyPhysicalTarget: normalizeMonthlyPhysicalTargets(prog.monthlyPhysicalTarget),
      sourceOfFund: prog.sourceOfFund || SOURCE_OF_FUND_OPTIONS[3],
      gadFund: Boolean(prog.gadFund),
      status: prog.status || 'PENDING',
      officeId: isOfficeScoped ? userOfficeId : prog.officeId,
      parentProgramId: prog.parentProgramId || '',
    });
    setProgramModalOpen(true);
  };

  const handleSaveProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!progForm.title.trim()) return;
    setSaving(true);
    try {
      const targetOfficeId = isOfficeScoped ? userOfficeId : progForm.officeId;
      const office = offices.find((o) => o.id === targetOfficeId);
      const now = new Date().toISOString();
      const budgetAmount = round2(safeNum(progForm.budget));
      const monthlyPhysicalTarget = normalizeMonthlyPhysicalTargets(
        progForm.monthlyPhysicalTarget
      );
      const monthlyTargetSum = sumMonthlyPhysicalTargets(monthlyPhysicalTarget);
      const physicalTargetValue =
        monthlyTargetSum > 0
          ? monthlyTargetSum
          : Math.max(0, safeNum(editingProgram?.physicalTarget));
      const fundSource = progForm.sourceOfFund.trim();
      const targetOutputsValue = progForm.targetOutputs.trim();

      if (editingProgram) {
        await onUpdateProgram({
          ...editingProgram,
          title: progForm.title.trim(),
          targetOutputs: targetOutputsValue,
          budget: budgetAmount,
          physicalTarget: physicalTargetValue,
          monthlyPhysicalTarget,
          sourceOfFund: fundSource,
          gadFund: progForm.gadFund,
          status: progForm.status,
          officeId: office?.id || targetOfficeId,
          officeName: office?.name || userOfficeName || editingProgram.officeName,
          parentProgramId: progForm.parentProgramId || null,
          updatedAt: now,
        });
      } else {
        const parentProg = progForm.parentProgramId
          ? programs.find((p) => p.id === progForm.parentProgramId)
          : undefined;
        const activeFy = parentProg?.fiscalYear || resolveActiveFiscalYear();
        const subCount = progForm.parentProgramId
          ? programs.filter((p) => p.parentProgramId === progForm.parentProgramId).length
          : 0;
        const autoRefCode = progForm.parentProgramId
          ? `${parentProg?.aipRefCode || 'PRG'}-${String(subCount + 1).padStart(2, '0')}`
          : `PRG-${String(programs.filter((p) => !p.parentProgramId).length + 1).padStart(3, '0')}`;

        await onCreateProgram({
          id: `prog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          aipRefCode: autoRefCode,
          title: progForm.title.trim(),
          targetOutputs: targetOutputsValue,
          sector: parentProg?.sector || 'General Public Services',
          budget: budgetAmount,
          physicalTarget: physicalTargetValue,
          monthlyPhysicalTarget,
          sourceOfFund: fundSource,
          gadFund: progForm.gadFund,
          status: progForm.status,
          fiscalYear: activeFy,
          officeId: office?.id || targetOfficeId || '',
          officeName: office?.name || userOfficeName || 'MPDO',
          parentProgramId: progForm.parentProgramId || null,
          orderIndex: programs.length + 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      setProgramModalOpen(false);
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setSaving(false);
    }
  };

  const openNewActivity = (programId?: string, subprogramId?: string) => {
    const defaultProg = programId || topPrograms[0]?.id || '';
    const prog = programs.find((p) => p.id === defaultProg);
    const defaultSource = prog?.sourceOfFund?.trim() || SOURCE_OF_FUND_OPTIONS[3];
    setEditingActivity(null);
    setMonthlyExpenditures(buildMonthlyExpenditureMap(null));
    setMonthlyPhysicalActuals(buildMonthlyPhysicalActualMap(null));
    setActForm({
      programId: defaultProg,
      subprogramId: subprogramId || '',
      description: '',
      targetOutputs: '',
      officeId: isOfficeScoped ? userOfficeId : prog?.officeId || offices[0]?.id || '',
      sourceOfFund: defaultSource,
      month: currentMonthKey,
      expenditure: 0,
      physicalActual: 0,
      remarks: '',
    });
    setActEvidenceDraft([]);
    setFormEvTitle('');
    setFormEvNote('');
    setFormEvUrl('');
    setFormEvError(null);
    setActivityModalOpen(true);
  };

  const openEditActivity = (act: ActivityComputed) => {
    const parentProg = programs.find((p) => p.id === act.programId);
    const expMap = buildMonthlyExpenditureMap(act);
    const physMap = buildMonthlyPhysicalActualMap(act);
    const firstActiveMonth =
      MONTHS.find((m) => safeNum(expMap[m.key]) > 0 || safeNum(physMap[m.key]) > 0)?.key ||
      MONTHS.find(
        (m) =>
          safeNum(act.monthly[m.key]?.financialTarget) > 0 ||
          safeNum(act.monthly[m.key]?.physicalTarget) > 0
      )?.key ||
      currentMonthKey;

    setEditingActivity(act);
    setMonthlyExpenditures(expMap);
    setMonthlyPhysicalActuals(physMap);
    setActForm({
      programId: act.programId,
      subprogramId: act.subprogramId || '',
      description: act.description,
      targetOutputs: act.targetOutputs,
      officeId: isOfficeScoped ? userOfficeId : act.officeId,
      sourceOfFund: inferSourceOfFundFromActivity(act, parentProg),
      month: firstActiveMonth,
      expenditure: expMap[firstActiveMonth] ?? 0,
      physicalActual: physMap[firstActiveMonth] ?? 0,
      remarks: act.remarks,
    });
    setActEvidenceDraft(Array.isArray(act.evidence) ? [...act.evidence] : []);
    setFormEvTitle('');
    setFormEvNote('');
    setFormEvUrl('');
    setFormEvError(null);
    setActivityModalOpen(true);
  };

  const handleSaveActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actForm.programId) return;
    setSaving(true);
    try {
      const targetOfficeId = isOfficeScoped
        ? userOfficeId
        : actForm.officeId || offices[0]?.id || '';
      const office = offices.find((o) => o.id === targetOfficeId);
      const now = new Date().toISOString();
      const parentProg = programs.find((p) => p.id === actForm.programId);
      const effectiveSource = editingActivity
        ? editingActivity.sourceOfFund || actForm.sourceOfFund
        : parentProg?.sourceOfFund?.trim() || actForm.sourceOfFund;
      const mappedClass = sourceOfFundToBudgetClass(effectiveSource);

      const finalMonthlyExp = {
        ...monthlyExpenditures,
        [actForm.month]: round2(safeNum(actForm.expenditure)),
      };
      const finalMonthlyPhys = {
        ...monthlyPhysicalActuals,
        [actForm.month]: Math.max(0, safeNum(actForm.physicalActual)),
      };

      const resolvedDescription = editingActivity
        ? actForm.description.trim() ||
          parentProg?.targetOutputs?.trim() ||
          actForm.targetOutputs.trim() ||
          parentProg?.title?.trim() ||
          'Project / Activity'
        : parentProg?.targetOutputs?.trim() ||
          actForm.targetOutputs.trim() ||
          parentProg?.title?.trim() ||
          'Project / Activity';

      if (editingActivity) {
        const updatedMonthly = { ...editingActivity.monthly };
        for (const m of MONTHS) {
          updatedMonthly[m.key] = {
            ...updatedMonthly[m.key],
            financialActual: round2(safeNum(finalMonthlyExp[m.key])),
            physicalActual: Math.max(0, safeNum(finalMonthlyPhys[m.key])),
          };
        }
        await onUpdateActivity({
          ...editingActivity,
          programId: actForm.programId,
          subprogramId: actForm.subprogramId || null,
          description: resolvedDescription,
          targetOutputs: actForm.targetOutputs.trim(),
          officeId: office?.id || targetOfficeId,
          officeName: office?.name || userOfficeName || editingActivity.officeName,
          sourceOfFund: effectiveSource,
          budgetClassification: editingActivity.budgetClassification || mappedClass,
          monthly: updatedMonthly,
          status: editingActivity.status || parentProg?.status || 'PENDING',
          remarks: actForm.remarks.trim(),
          evidence: actEvidenceDraft,
          updatedBy: userUid,
          updatedAt: now,
        });
      } else {
        const activeFy = parentProg?.fiscalYear || resolveActiveFiscalYear();
        const siblings = activities.filter((a) => a.programId === actForm.programId);
        const existingRefs = new Set(siblings.map((a) => a.referenceNumber.toLowerCase()));
        let nextSeq = siblings.length + 1;
        let autoRefNumber = `${parentProg?.aipRefCode || 'PPA'}-${String(nextSeq).padStart(2, '0')}`;
        while (existingRefs.has(autoRefNumber.toLowerCase())) {
          nextSeq += 1;
          autoRefNumber = `${parentProg?.aipRefCode || 'PPA'}-${String(nextSeq).padStart(2, '0')}`;
        }

        const monthly = createEmptyMonthlyData();
        for (const m of MONTHS) {
          monthly[m.key] = {
            ...monthly[m.key],
            financialActual: round2(safeNum(finalMonthlyExp[m.key])),
            physicalActual: Math.max(0, safeNum(finalMonthlyPhys[m.key])),
          };
        }
        await onCreateActivity({
          id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          programId: actForm.programId,
          subprogramId: actForm.subprogramId || null,
          fiscalYear: activeFy,
          referenceNumber: autoRefNumber,
          description: resolvedDescription,
          targetOutputs: actForm.targetOutputs.trim(),
          officeId: office?.id || targetOfficeId || '',
          officeName: office?.name || userOfficeName || 'MPDO',
          sourceOfFund: effectiveSource,
          budgetClassification: mappedClass,
          orderIndex: nextSeq,
          gf: 0,
          ps: 0,
          mooe: 0,
          co: 0,
          withheldAmount: 0,
          supplementalBudget1: 0,
          supplementalBudget2: 0,
          supplementalBudget3: 0,
          supplementalBudget4: 0,
          supplementalBudget5: 0,
          monthly,
          status: parentProg?.status || 'PENDING',
          completionPct: 0,
          remarks: actForm.remarks.trim(),
          milestones: [],
          evidence: actEvidenceDraft,
          createdBy: userUid,
          updatedBy: userUid,
          createdAt: now,
          updatedAt: now,
        });
      }
      setActivityModalOpen(false);
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setSaving(false);
    }
  };

  const handleAddFormEvidence = () => {
    const title = formEvTitle.trim();
    const note = formEvNote.trim();
    const url = formEvUrl.trim();
    if (!title && !note && !url) {
      setFormEvError('Provide a supporting note or external document link.');
      return;
    }
    if (url && !isSafeExternalUrl(url)) {
      setFormEvError('Document URL must start with https:// or http://');
      return;
    }
    setFormEvError(null);
    const nextItem: ActivityEvidenceItem = {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || (url ? 'External Document Link' : 'Supporting Note'),
      note,
      url,
      addedByUid: userUid,
      addedByName: userName || userOfficeName || 'Monitoring Personnel',
      addedAt: new Date().toISOString(),
    };
    setActEvidenceDraft((prev) => [...prev, nextItem]);
    setFormEvTitle('');
    setFormEvNote('');
    setFormEvUrl('');
  };

  const toggleCollapse = (id: string) => {
    setCollapsedPrograms((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0 sm:min-w-[260px]">
          <div className="relative flex-1 min-w-0 sm:min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search ref no., activity, target output, office..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-8 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {isOfficeScoped ? (
            <div className="rounded-lg border border-blue-200 dark:border-sky-800 bg-blue-50/70 dark:bg-sky-950/40 px-3 py-2 text-xs font-semibold text-[#163A5F] dark:text-sky-300">
              Office Scope: {userOfficeName}
            </div>
          ) : (
            <select
              value={officeFilter}
              onChange={(e) => {
                setOfficeFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
            >
              <option value="ALL">All Offices</option>
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code}
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {canEditStructure && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => openNewProgram()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 transition-colors"
            >
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              <span>Add Program</span>
            </button>
            <button
              type="button"
              onClick={() => openNewActivity()}
              disabled={topPrograms.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e4b7a] disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add Project / Activity</span>
            </button>
          </div>
        )}
      </div>

      {(() => {
        const overPrograms = visibleTopPrograms.filter((p) => {
          const pActs = filteredActivities.filter((a) => a.programId === p.id);
          return summarizeProgram(p, pActs).remainingBudget < 0;
        });
        if (overPrograms.length === 0) return null;
        return (
          <div
            role="alert"
            className="no-print rounded-xl border border-red-200 dark:border-red-900/70 bg-red-50/90 dark:bg-red-950/40 px-4 py-3 text-xs text-red-900 dark:text-red-200 flex items-start gap-3"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#DC2626] dark:text-red-400" aria-hidden="true" />
            <span>
              <strong className="font-semibold">Budget Ceiling Alert:</strong> {overPrograms.length}{' '}
              program{overPrograms.length === 1 ? '' : 's'} currently exceed{overPrograms.length === 1 ? 's' : ''} revised budget allocation (
              {overPrograms
                .slice(0, 3)
                .map((p) => p.aipRefCode)
                .join(', ')}
              {overPrograms.length > 3 ? ` +${overPrograms.length - 3} more` : ''}).
            </span>
          </div>
        );
      })()}

      {/* Bulk Selection Actions Bar */}
      {canBulkSelect && visibleSelectedIds.length > 0 && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2563EB]/30 dark:border-sky-700 bg-blue-50/90 dark:bg-sky-950/50 px-4 py-3 shadow-sm animate-fade-in">
          <div className="flex items-center gap-2.5">
            <CheckSquare className="h-4 w-4 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
            <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">
              {visibleSelectedIds.length}{' '}
              {visibleSelectedIds.length === 1 ? 'activity' : 'activities'} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedActivityIds([])}
              className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:underline"
            >
              Clear selection
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEditStructure && onBulkDeleteActivities && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() =>
                  setConfirmDelete({
                    type: 'bulk_activity',
                    id: 'bulk',
                    ids: visibleSelectedIds,
                    label: `${visibleSelectedIds.length} selected ${
                      visibleSelectedIds.length === 1 ? 'activity' : 'activities'
                    }`,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Delete Selected</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Program Hierarchy */}
      {pagedPrograms.length === 0 ? (
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">No Programs Found</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {search || officeFilter !== 'ALL' || statusFilter !== 'ALL'
              ? 'Try clearing your active search or filters.'
              : 'Create an LGU Program first or import your Monitoring Template.xlsx workbook.'}
          </p>
          {canEditStructure && !search && officeFilter === 'ALL' && statusFilter === 'ALL' && (
            <button
              type="button"
              onClick={() => openNewProgram()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#163A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e4b7a] transition-colors"
            >
              <FolderPlus className="h-4 w-4" />
              <span>Add First Program</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {pagedPrograms.map((prog) => {
            const subprogs = subprogramsByParent.get(prog.id) || [];
            const directActivities = filteredActivities.filter(
              (a) => a.programId === prog.id && !a.subprogramId
            );
            const allProgActivities = filteredActivities.filter((a) => a.programId === prog.id);
            const progSummary = summarizeProgram(prog, allProgActivities);
            const isCollapsed = collapsedPrograms[prog.id];
            const progActivityIds = allProgActivities.map((a) => a.id);
            const allProgSelected =
              progActivityIds.length > 0 && progActivityIds.every((id) => selectedSet.has(id));

            return (
              <div
                key={prog.id}
                className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                {/* Program Header Row */}
                <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50/90 dark:bg-slate-800/70 px-5 py-4 border-b border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(prog.id)}
                      className="rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors"
                      aria-label={isCollapsed ? 'Expand program' : 'Collapse program'}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#2563EB] dark:text-sky-400">
                          {prog.aipRefCode}
                        </span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-600 dark:text-slate-400">FY {prog.fiscalYear}</span>
                        {prog.sourceOfFund && (
                          <>
                            <span className="text-xs text-slate-400">·</span>
                            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                              {prog.sourceOfFund}
                            </span>
                          </>
                        )}
                        {prog.gadFund !== undefined && (
                          <>
                            <span className="text-xs text-slate-400">·</span>
                            <span
                              className={`text-xs font-medium ${
                                prog.gadFund
                                  ? 'text-teal-700 dark:text-teal-300'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              GAD Fund: {prog.gadFund ? 'Yes' : 'No'}
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="text-[15px] sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate leading-snug">
                        {prog.title}
                      </h3>
                      {prog.targetOutputs?.trim() && (
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 truncate">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            Target Outputs:
                          </span>{' '}
                          {prog.targetOutputs}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Approved Budget</p>
                      <p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        {formatPHP(progSummary.approvedBudget)}
                      </p>
                      {safeNum(prog.supplementalBudget) !== 0 && (
                        <div className="space-y-0.5">
                          <p
                            className={`font-mono text-[10px] font-semibold tabular-nums ${
                              safeNum(prog.supplementalBudget) > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            Supp:{' '}
                            {safeNum(prog.supplementalBudget) > 0
                              ? `+${formatPHP(safeNum(prog.supplementalBudget))}`
                              : formatPHP(safeNum(prog.supplementalBudget))}
                          </p>
                          {(() => {
                            const activeSlots = getProgramSupplementalBreakdown(prog).orderedSlots.filter(
                              (slot) => slot.amount !== 0
                            );
                            if (activeSlots.length === 0) return null;
                            return (
                              <p className="font-mono text-[9.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                                {activeSlots
                                  .map(
                                    (slot) =>
                                      `SB${slot.slotNumber}: ${slot.amount > 0 ? `+${formatPHP(slot.amount)}` : formatPHP(slot.amount)}`
                                  )
                                  .join(' · ')}
                              </p>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {isPersonnelServicesFund(prog.sourceOfFund) ||
                        (progSummary.approvedBudget > 0 &&
                          progSummary.revisedBudget === progSummary.approvedBudget)
                          ? 'Revised Budget (PS Exempt)'
                          : 'Revised Budget (-15%)'}
                      </p>
                      <p className="font-mono text-sm font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                        {formatPHP(progSummary.revisedBudget)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Expenditure</p>
                      <p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                        {formatPHP(progSummary.annualFinancialActual)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Remaining Budget</p>
                      <p
                        className={`font-mono text-sm font-bold tabular-nums ${
                          progSummary.remainingBudget < 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {formatPHP(progSummary.remainingBudget)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Activities</p>
                      <p className="font-mono text-sm font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
                        {allProgActivities.length}
                      </p>
                    </div>
                    {progSummary.annualPhysicalTarget > 0 && (
                      <div className="text-right">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Physical Target</p>
                        <p className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                          {formatQty(progSummary.annualPhysicalActual)} /{' '}
                          {formatQty(progSummary.annualPhysicalTarget)}
                        </p>
                      </div>
                    )}
                    <div
                      className="min-w-[140px]"
                      title={`Financial Accomplishment: ${formatPct(progSummary.budgetUtilizationPct)} (${formatPHP(progSummary.annualFinancialActual)} / ${formatPHP(progSummary.revisedBudget)} × 100)${
                        progSummary.annualPhysicalTarget > 0
                          ? ` · Physical Accomplishment: ${formatPct(progSummary.physicalAccomplishmentPct)} (${formatQty(progSummary.annualPhysicalActual)} / ${formatQty(progSummary.annualPhysicalTarget)})`
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Accomplishment</span>
                        <span className="font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                          {formatPct(progSummary.budgetUtilizationPct)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#163A5F] dark:bg-sky-400 transition-all"
                          style={{
                            width: `${Math.min(100, Math.max(0, progSummary.budgetUtilizationPct))}%`,
                          }}
                        />
                      </div>
                      {progSummary.annualPhysicalTarget > 0 && (
                        <p className="mt-0.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 text-right tabular-nums">
                          Phys: {formatPct(progSummary.physicalAccomplishmentPct)}
                        </p>
                      )}
                    </div>

                    {canEditStructure && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSupplementalProgram(prog)}
                          title="Add or subtract supplemental budget for this program"
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 whitespace-nowrap transition-colors"
                        >
                          <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Supplemental Budget</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openNewActivity(prog.id)}
                          title="Add activity to this program"
                          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap transition-colors"
                        >
                          + Activity
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditProgram(prog)}
                          className="rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                          aria-label="Edit program"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDelete({ type: 'program', id: prog.id, label: prog.title })
                          }
                          className="rounded-lg p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
                          aria-label="Delete program"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    <StatusBadge status={prog.status || 'PENDING'} compact />
                  </div>
                </div>

                {/* Activities Table */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">
                          {canBulkSelect && (
                            <th className="py-2.5 pl-4 pr-2 w-9">
                              <input
                                type="checkbox"
                                checked={allProgSelected}
                                disabled={progActivityIds.length === 0}
                                onChange={() => toggleSelectGroup(progActivityIds)}
                                aria-label={`Select all activities in ${prog.title}`}
                                className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                              />
                            </th>
                          )}
                          <th className="py-2.5 px-4">
                            <button
                              type="button"
                              onClick={() => toggleSort('ref')}
                              className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              <span>Ref No.</span>
                              <ArrowUpDown className="h-3 w-3 opacity-60" />
                            </button>
                          </th>
                          <th className="py-2.5 px-4">Target Outputs</th>
                          <th className="py-2.5 px-4">Actual Output</th>
                          <th className="py-2.5 px-4">Office</th>
                          <th className="py-2.5 px-4">Class</th>
                          <th className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => toggleSort('expenditure')}
                              className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              <span>Expenditure</span>
                              <ArrowUpDown className="h-3 w-3 opacity-60" />
                            </button>
                          </th>
                          <th className="py-2.5 px-4 text-right">Physical Actual</th>
                          <th className="py-2.5 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-[13px]">
                        {directActivities.length === 0 && subprogs.length === 0 ? (
                          <tr>
                            <td
                              colSpan={canBulkSelect ? 9 : 8}
                              className="py-5 px-4 text-center text-xs text-slate-500 dark:text-slate-400"
                            >
                              No matching projects or activities under this program.
                            </td>
                          </tr>
                        ) : (
                          <>
                            {directActivities.map((act) => {
                              const bd = resolveActivityBudgetDisplay(act, prog, progSummary);
                              const isChecked = selectedSet.has(act.id);
                              const isDragging = draggedAct?.id === act.id;
                              const isDropTarget = dragOverActId === act.id;
                              return (
                                <tr
                                  key={act.id}
                                  draggable={canDragReorder}
                                  onDragStart={(e) => handleActivityDragStart(e, act)}
                                  onDragOver={(e) => handleActivityDragOver(e, act)}
                                  onDragLeave={() => {
                                    if (dragOverActId === act.id) setDragOverActId(null);
                                  }}
                                  onDrop={(e) => handleActivityDrop(e, act)}
                                  onDragEnd={handleActivityDragEnd}
                                  className={`transition-colors ${
                                    isDragging
                                      ? 'opacity-50 bg-blue-50/50 dark:bg-sky-950/30'
                                      : isDropTarget
                                        ? 'ring-2 ring-inset ring-[#2563EB] bg-blue-50/80 dark:bg-sky-950/40'
                                        : isChecked
                                          ? 'bg-blue-50/70 dark:bg-sky-950/30'
                                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                                  }`}
                                >
                                  {canBulkSelect && (
                                    <td className="py-2.5 pl-4 pr-2">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleSelectActivity(act.id)}
                                        aria-label={`Select activity ${act.referenceNumber}`}
                                        className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                                      />
                                    </td>
                                  )}
                                  <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                    <div className="inline-flex items-center gap-1.5">
                                      {canEditStructure && onReorderActivities && (
                                        <span
                                          className={`no-print inline-flex items-center ${
                                            canDragReorder
                                              ? 'cursor-grab active:cursor-grabbing text-slate-400 hover:text-[#2563EB] dark:hover:text-sky-400'
                                              : 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                                          }`}
                                          title={
                                            sortField !== null
                                              ? 'Clear active column sort to drag and reorder PPA priority'
                                              : 'Drag row to reorder PPA priority sequence'
                                          }
                                          aria-label={`Drag handle for ${act.referenceNumber}`}
                                        >
                                          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                                        </span>
                                      )}
                                      <span>{act.referenceNumber}</span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100 max-w-xs">
                                    <div className="line-clamp-2">
                                      {act.description || prog.targetOutputs || '—'}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 max-w-[200px]">
                                    {act.targetOutputs}
                                  </td>
                                  <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400">
                                    {act.officeName}
                                  </td>
                                  <td className="py-2.5 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                    {act.budgetClassification}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                    {formatPHP(bd.expenditure)}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                    {formatQty(act.annualPhysicalActual)}
                                  </td>
                                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center gap-1">
                                      {(act.evidence?.length || 0) > 0 && (
                                        <button
                                          type="button"
                                          onClick={() => setDetailActivity(act)}
                                          className="inline-flex items-center gap-1 rounded-md bg-blue-50 dark:bg-sky-950/60 px-1.5 py-1 text-[11px] font-semibold text-[#2563EB] dark:text-sky-300 hover:bg-blue-100 dark:hover:bg-sky-900/70"
                                          title={`${act.evidence!.length} evidence attachment(s) — click to view`}
                                        >
                                          <Paperclip className="h-3 w-3" aria-hidden="true" />
                                          <span>{act.evidence!.length}</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setDetailActivity(act)}
                                        className="rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                        title="View details, milestones & evidence"
                                      >
                                        <Eye className="h-4 w-4" />
                                      </button>
                                      {canEditStatusRemarks && (
                                        <button
                                          type="button"
                                          onClick={() => openEditActivity(act)}
                                          className="rounded-lg p-1.5 text-[#2563EB] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-slate-800"
                                          title="Edit activity"
                                        >
                                          <Edit3 className="h-4 w-4" />
                                        </button>
                                      )}
                                      {canEditStructure && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConfirmDelete({
                                              type: 'activity',
                                              id: act.id,
                                              label: act.description,
                                            })
                                          }
                                          className="rounded-lg p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60"
                                          title="Delete activity"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}

                            {/* Subprograms and their activities */}
                            {subprogs.map((sub) => {
                              const subActs = filteredActivities.filter(
                                (a) => a.subprogramId === sub.id
                              );
                              return (
                                <Fragment key={sub.id}>
                                  <tr className="bg-slate-50/80 dark:bg-slate-800/50">
                                    {canBulkSelect && <td />}
                                    <td className="py-2 px-4 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                                      {sub.aipRefCode}
                                    </td>
                                    <td
                                      colSpan={6}
                                      className="py-2 px-4 text-xs font-bold text-[#163A5F] dark:text-sky-400"
                                    >
                                      Subprogram: {sub.title}
                                    </td>
                                    <td className="py-2 px-4 text-right whitespace-nowrap">
                                      {canEditStructure && (
                                        <div className="inline-flex items-center gap-1">
                                          <button
                                            type="button"
                                            onClick={() => setSupplementalProgram(sub)}
                                            title="Add or subtract supplemental budget for this subprogram"
                                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/70"
                                          >
                                            <PlusCircle className="h-3 w-3" aria-hidden="true" />
                                            <span>Supplemental</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openNewActivity(prog.id, sub.id)}
                                            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                          >
                                            + Activity
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setConfirmDelete({
                                                type: 'program',
                                                id: sub.id,
                                                label: sub.title,
                                              })
                                            }
                                            className="rounded-lg p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60"
                                            title="Delete Subprogram"
                                            aria-label={`Delete subprogram ${sub.title}`}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                  {subActs.map((act) => {
                                    const bd = resolveActivityBudgetDisplay(act, prog, progSummary);
                                    const isChecked = selectedSet.has(act.id);
                                    const isDragging = draggedAct?.id === act.id;
                                    const isDropTarget = dragOverActId === act.id;
                                    return (
                                      <tr
                                        key={act.id}
                                        draggable={canDragReorder}
                                        onDragStart={(e) => handleActivityDragStart(e, act)}
                                        onDragOver={(e) => handleActivityDragOver(e, act)}
                                        onDragLeave={() => {
                                          if (dragOverActId === act.id) setDragOverActId(null);
                                        }}
                                        onDrop={(e) => handleActivityDrop(e, act)}
                                        onDragEnd={handleActivityDragEnd}
                                        className={`transition-colors ${
                                          isDragging
                                            ? 'opacity-50 bg-blue-50/50 dark:bg-sky-950/30'
                                            : isDropTarget
                                              ? 'ring-2 ring-inset ring-[#2563EB] bg-blue-50/80 dark:bg-sky-950/40'
                                              : isChecked
                                                ? 'bg-blue-50/70 dark:bg-sky-950/30'
                                                : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                                        }`}
                                      >
                                        {canBulkSelect && (
                                          <td className="py-2.5 pl-4 pr-2">
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={() => toggleSelectActivity(act.id)}
                                              aria-label={`Select activity ${act.referenceNumber}`}
                                              className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                                            />
                                          </td>
                                        )}
                                        <td className="py-2.5 pl-8 pr-4 font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                          <div className="inline-flex items-center gap-1.5">
                                            {canEditStructure && onReorderActivities && (
                                              <span
                                                className={`no-print inline-flex items-center ${
                                                  canDragReorder
                                                    ? 'cursor-grab active:cursor-grabbing text-slate-400 hover:text-[#2563EB] dark:hover:text-sky-400'
                                                    : 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                                                }`}
                                                title={
                                                  sortField !== null
                                                    ? 'Clear active column sort to drag and reorder PPA priority'
                                                    : 'Drag row to reorder PPA priority sequence'
                                                }
                                                aria-label={`Drag handle for ${act.referenceNumber}`}
                                              >
                                                <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                                              </span>
                                            )}
                                            <span>{act.referenceNumber}</span>
                                          </div>
                                        </td>
                                        <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                                          {act.description || prog.targetOutputs || '—'}
                                        </td>
                                        <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400">
                                          {act.targetOutputs}
                                        </td>
                                        <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400">
                                          {act.officeName}
                                        </td>
                                        <td className="py-2.5 px-4 font-mono text-xs text-slate-700 dark:text-slate-300">
                                          {act.budgetClassification}
                                        </td>
                                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                          {formatPHP(bd.expenditure)}
                                        </td>
                                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                          {formatQty(act.annualPhysicalActual)}
                                        </td>
                                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                          <div className="inline-flex items-center gap-1">
                                            {(act.evidence?.length || 0) > 0 && (
                                              <button
                                                type="button"
                                                onClick={() => setDetailActivity(act)}
                                                className="inline-flex items-center gap-1 rounded-md bg-blue-50 dark:bg-sky-950/60 px-1.5 py-1 text-[11px] font-semibold text-[#2563EB] dark:text-sky-300 hover:bg-blue-100 dark:hover:bg-sky-900/70"
                                                title={`${act.evidence!.length} evidence attachment(s) — click to view`}
                                              >
                                                <Paperclip className="h-3 w-3" aria-hidden="true" />
                                                <span>{act.evidence!.length}</span>
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => setDetailActivity(act)}
                                              className="rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                                              title="View Details, Milestones & Evidence"
                                              aria-label={`View details for ${act.referenceNumber}`}
                                            >
                                              <Eye className="h-4 w-4" />
                                            </button>
                                            {canEditStatusRemarks && (
                                              <button
                                                type="button"
                                                onClick={() => openEditActivity(act)}
                                                className="rounded-lg p-1.5 text-[#2563EB] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-slate-800"
                                                title="Edit Activity"
                                                aria-label={`Edit ${act.referenceNumber}`}
                                              >
                                                <Edit3 className="h-4 w-4" />
                                              </button>
                                            )}
                                            {canEditStructure && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setConfirmDelete({
                                                    type: 'activity',
                                                    id: act.id,
                                                    label: act.description,
                                                  })
                                                }
                                                className="rounded-lg p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60"
                                                title="Delete Activity"
                                                aria-label={`Delete ${act.referenceNumber}`}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <span className="text-slate-600 dark:text-slate-400">
                Page {safePage} of {totalPages} ({visibleTopPrograms.length} Programs)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Program Modal */}
      {programModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] dark:bg-slate-950/75 p-4 overflow-y-auto">
          <div
            ref={programModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="program-modal-title"
            className="my-6 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 id="program-modal-title" className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                {editingProgram ? 'Edit Program' : 'Add New LGU Program'}
              </h3>
              <button
                type="button"
                onClick={() => setProgramModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close program modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveProgram} className="mt-4 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Program Title *</label>
                <input
                  required
                  type="text"
                  value={progForm.title}
                  onChange={(e) => setProgForm({ ...progForm, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  placeholder="e.g., Agricultural Productivity & Infrastructure Program"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Target Outputs
                </label>
                <input
                  type="text"
                  value={progForm.targetOutputs}
                  onChange={(e) => setProgForm({ ...progForm, targetOutputs: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  placeholder="Enter target outputs (e.g., 500 Farmers Assisted / 2 Road Segments)"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Budget (₱) *</label>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0"
                    value={progForm.budget}
                    onChange={(e) =>
                      setProgForm({ ...progForm, budget: safeNum(e.target.value) })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Source of Fund *
                  </label>
                  <select
                    required
                    value={progForm.sourceOfFund}
                    onChange={(e) => setProgForm({ ...progForm, sourceOfFund: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  >
                    {progForm.sourceOfFund &&
                      !SOURCE_OF_FUND_OPTIONS.includes(progForm.sourceOfFund) && (
                        <option value={progForm.sourceOfFund}>{progForm.sourceOfFund}</option>
                      )}
                    {SOURCE_OF_FUND_OPTIONS.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-3.5 py-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="block text-slate-500 dark:text-slate-400">
                    Approved Budget
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatPHP(
                      Math.max(
                        0,
                        round2(
                          safeNum(progForm.budget) +
                            safeNum(editingProgram?.supplementalBudget)
                        )
                      )
                    )}
                  </span>
                  {editingProgram && safeNum(editingProgram.supplementalBudget) !== 0 && (
                    <span className="block text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      Includes Net Supplemental:{' '}
                      {safeNum(editingProgram.supplementalBudget) > 0
                        ? `+${formatPHP(safeNum(editingProgram.supplementalBudget))}`
                        : formatPHP(safeNum(editingProgram.supplementalBudget))}
                    </span>
                  )}
                </div>
                <div className="sm:text-right">
                  <span className="block text-slate-500 dark:text-slate-400">
                    {isPersonnelServicesFund(progForm.sourceOfFund)
                      ? 'Revised Budget (PS Exempt from 15%)'
                      : 'Revised Budget (Approved − 15%)'}
                  </span>
                  <span className="font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                    {formatPHP(
                      calculateRevisedBudgetByFund(
                        Math.max(
                          0,
                          round2(
                            safeNum(progForm.budget) +
                              safeNum(editingProgram?.supplementalBudget)
                          )
                        ),
                        progForm.sourceOfFund
                      )
                    )}
                  </span>
                </div>
              </div>

              <div>
                <span className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  GAD Fund? *
                </span>
                <div
                  className="mt-1.5 grid grid-cols-2 gap-2.5"
                  role="radiogroup"
                  aria-label="GAD Fund"
                >
                  <label
                    className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium cursor-pointer transition-colors ${
                      progForm.gadFund
                        ? 'border-[#163A5F] bg-blue-50/70 text-[#163A5F] dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-300'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gadFund"
                      value="yes"
                      checked={progForm.gadFund === true}
                      onChange={() => setProgForm((prev) => ({ ...prev, gadFund: true }))}
                      className="h-4 w-4 text-[#163A5F] focus:ring-[#2563EB]"
                    />
                    <span>Yes</span>
                  </label>
                  <label
                    className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium cursor-pointer transition-colors ${
                      !progForm.gadFund
                        ? 'border-[#163A5F] bg-blue-50/70 text-[#163A5F] dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-300'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gadFund"
                      value="no"
                      checked={progForm.gadFund === false}
                      onChange={() => setProgForm((prev) => ({ ...prev, gadFund: false }))}
                      className="h-4 w-4 text-[#163A5F] focus:ring-[#2563EB]"
                    />
                    <span>No</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Lead Office
                  </label>
                  <select
                    disabled={isOfficeScoped}
                    value={
                      isOfficeScoped
                        ? userOfficeId
                        : offices.some((o) => o.id === progForm.officeId)
                          ? progForm.officeId
                          : offices[0]?.id || ''
                    }
                    onChange={(e) => setProgForm({ ...progForm, officeId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50"
                  >
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} — {o.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Accomplishment Status *
                  </label>
                  <select
                    required
                    value={progForm.status}
                    onChange={(e) =>
                      setProgForm({
                        ...progForm,
                        status: e.target.value as ImplementationStatus,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Monthly Physical Target Breakdown (Jan–Dec) */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/80 px-3.5 py-2 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Physical Target by Month
                  </span>
                  <span className="font-mono text-xs font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                    Total: {formatQty(sumMonthlyPhysicalTargets(progForm.monthlyPhysicalTarget))}
                  </span>
                </div>
                {editingProgram &&
                  sumMonthlyPhysicalTargets(progForm.monthlyPhysicalTarget) === 0 &&
                  safeNum(editingProgram.physicalTarget) > 0 && (
                    <div className="px-3.5 py-1.5 bg-amber-50/70 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300">
                      Existing annual physical target: {formatQty(safeNum(editingProgram.physicalTarget))}. Enter monthly values below to allocate by month.
                    </div>
                  )}
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400">
                      <tr>
                        <th className="py-1.5 px-3.5 font-semibold">Month</th>
                        <th className="py-1.5 px-3.5 font-semibold text-right">Physical Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {MONTHS.map((m) => (
                        <tr key={m.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-1.5 px-3.5 font-medium text-slate-800 dark:text-slate-200">
                            {m.label}
                          </td>
                          <td className="py-1 px-3.5 text-right">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={progForm.monthlyPhysicalTarget[m.key]}
                              onChange={(e) =>
                                setProgForm((prev) => ({
                                  ...prev,
                                  monthlyPhysicalTarget: {
                                    ...prev.monthlyPhysicalTarget,
                                    [m.key]: Math.max(0, safeNum(e.target.value)),
                                  },
                                }))
                              }
                              className="w-36 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-right text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                              placeholder="0"
                              aria-label={`${m.label} Physical Target`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setProgramModalOpen(false)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#163A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e4b7a] disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Program'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Activity Modal */}
      {activityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] dark:bg-slate-950/75 p-4 overflow-y-auto">
          <div
            ref={activityModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-modal-title"
            className="my-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 id="activity-modal-title" className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                {editingActivity ? 'Edit Project / Activity' : 'Add Project / Activity'}
              </h3>
              <button
                type="button"
                onClick={() => setActivityModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close activity modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveActivity} className="mt-4 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Parent Program *</label>
                <select
                  required
                  disabled={!canEditStructure}
                  value={actForm.programId}
                  onChange={(e) => {
                    const nextProgId = e.target.value;
                    const nextProg = programs.find((p) => p.id === nextProgId);
                    setActForm((prev) => ({
                      ...prev,
                      programId: nextProgId,
                      subprogramId: '',
                      sourceOfFund:
                        !editingActivity && nextProg?.sourceOfFund?.trim()
                          ? nextProg.sourceOfFund.trim()
                          : prev.sourceOfFund,
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50"
                >
                  {topPrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.aipRefCode} — {p.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* PPA Approved, Recalculated Revised, & Remaining Budget Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-blue-200 dark:border-sky-800/60 bg-blue-50/70 dark:bg-slate-800/80 p-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    Approved Budget
                  </p>
                  <p className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatPHP(ppaBudgetPreview.approvedAmount)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {ppaBudgetPreview.isProgramLevel
                      ? 'Program Budget'
                      : 'Activity Approved Budget'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    Revised Budget
                  </p>
                  <p className="mt-1 font-mono text-base font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                    {formatPHP(ppaBudgetPreview.revisedAmount)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {ppaBudgetPreview.isPsExempt
                      ? 'PS Exempted (No 15% Deduction)'
                      : 'Approved − 15% (GF / CO / MOOE)'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    Remaining Budget
                  </p>
                  <p
                    className={`mt-1 font-mono text-base font-bold tabular-nums ${
                      ppaBudgetPreview.remainingAmount < 0
                        ? 'text-red-700 dark:text-red-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {formatPHP(ppaBudgetPreview.remainingAmount)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    Revised − Expenditure ({formatPHP(ppaBudgetPreview.utilizedAmount)})
                  </p>
                </div>
              </div>

              {ppaBudgetPreview.remainingAmount < 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs text-red-800 dark:text-red-200 flex items-start gap-2.5"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold">Budget Ceiling Warning:</strong> Cumulative expenditure ({formatPHP(ppaBudgetPreview.utilizedAmount)}) exceeds revised allocation ({formatPHP(ppaBudgetPreview.revisedAmount)}) by <strong className="font-mono">{formatPHP(Math.abs(ppaBudgetPreview.remainingAmount))}</strong>.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Actual Output
                </label>
                <input
                  disabled={!canEditStructure}
                  type="text"
                  value={actForm.targetOutputs}
                  onChange={(e) => setActForm({ ...actForm, targetOutputs: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50"
                  placeholder="Enter actual output realized"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Source of Fund *
                    <span className="ml-1.5 text-[10px] font-normal text-slate-400 dark:text-slate-500">
                      {editingActivity ? '(Locked on edit)' : '(Inherited from Program)'}
                    </span>
                  </label>
                  <select
                    required
                    disabled
                    value={actForm.sourceOfFund}
                    onChange={(e) => setActForm({ ...actForm, sourceOfFund: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/50 disabled:text-slate-500 dark:disabled:text-slate-400"
                  >
                    {actForm.sourceOfFund &&
                      !SOURCE_OF_FUND_OPTIONS.includes(actForm.sourceOfFund) && (
                        <option value={actForm.sourceOfFund}>{actForm.sourceOfFund}</option>
                      )}
                    {SOURCE_OF_FUND_OPTIONS.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Office / Implementing Unit
                  </label>
                  <select
                    disabled={!canEditStructure || isOfficeScoped}
                    value={isOfficeScoped ? userOfficeId : actForm.officeId}
                    onChange={(e) => setActForm({ ...actForm, officeId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50"
                  >
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.code} — {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Month, Expenditure & Physical Actual */}
              <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Month *</label>
                    <select
                      value={actForm.month}
                      onChange={(e) => {
                        const nextMonth = e.target.value as MonthKey;
                        setActForm((prev) => ({
                          ...prev,
                          month: nextMonth,
                          expenditure: monthlyExpenditures[nextMonth] ?? 0,
                          physicalActual: monthlyPhysicalActuals[nextMonth] ?? 0,
                        }));
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    >
                      {MONTHS.map((m) => {
                        const amt = safeNum(monthlyExpenditures[m.key]);
                        const phys = safeNum(monthlyPhysicalActuals[m.key]);
                        return (
                          <option key={m.key} value={m.key}>
                            {m.label}
                            {amt > 0 ? ` (${formatPHP(amt)})` : phys > 0 ? ` (Phys: ${phys})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Expenditure (₱)
                      </label>
                      <span className="font-mono text-xs font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
                        {formatPHP(safeNum(actForm.expenditure))}
                      </span>
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={actForm.expenditure}
                      onChange={(e) => {
                        const val = safeNum(e.target.value);
                        setMonthlyExpenditures((prev) => ({
                          ...prev,
                          [actForm.month]: val,
                        }));
                        setActForm((prev) => ({ ...prev, expenditure: val }));
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Physical Actual
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={actForm.physicalActual}
                      onChange={(e) => {
                        const val = Math.max(0, safeNum(e.target.value));
                        setMonthlyPhysicalActuals((prev) => ({
                          ...prev,
                          [actForm.month]: val,
                        }));
                        setActForm((prev) => ({ ...prev, physicalActual: val }));
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>

                {(() => {
                  const recordedMonths = MONTHS.filter(
                    (m) =>
                      safeNum(monthlyExpenditures[m.key]) > 0 ||
                      safeNum(monthlyPhysicalActuals[m.key]) > 0
                  );
                  if (recordedMonths.length === 0) return null;
                  return (
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                        <span>Recorded Monthly Entries (click a month to edit)</span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                          Total Exp:{' '}
                          {formatPHP(
                            recordedMonths.reduce(
                              (sum, m) => sum + safeNum(monthlyExpenditures[m.key]),
                              0
                            )
                          )}{' '}
                          · Total Phys Actual:{' '}
                          {formatQty(
                            recordedMonths.reduce(
                              (sum, m) => sum + safeNum(monthlyPhysicalActuals[m.key]),
                              0
                            )
                          )}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recordedMonths.map((m) => {
                          const isSelected = actForm.month === m.key;
                          const exp = safeNum(monthlyExpenditures[m.key]);
                          const phys = safeNum(monthlyPhysicalActuals[m.key]);
                          return (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() =>
                                setActForm((prev) => ({
                                  ...prev,
                                  month: m.key,
                                  expenditure: exp,
                                  physicalActual: phys,
                                }))
                              }
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                isSelected
                                  ? 'border-[#163A5F] bg-[#163A5F] text-white dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
                                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                              }`}
                            >
                              <span>{m.label}:</span>
                              <span className="font-mono font-semibold tabular-nums">
                                {formatPHP(exp)}
                                {phys > 0 ? ` · Phys ${formatQty(phys)}` : ''}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Remarks</label>
                <textarea
                  rows={2}
                  value={actForm.remarks}
                  onChange={(e) => setActForm({ ...actForm, remarks: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  placeholder="Implementation notes or observations..."
                />
              </div>

              {/* Supporting Evidence Notes & External Document Links */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Evidence Notes &amp; Document Links ({actEvidenceDraft.length})
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Optional notes or external URLs (http/https)
                  </span>
                </div>

                {actEvidenceDraft.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {actEvidenceDraft.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">
                            {ev.title || (ev.url ? 'External Document Link' : 'Supporting Note')}
                          </p>
                          {ev.note && (
                            <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">
                              {ev.note}
                            </p>
                          )}
                          {ev.url && isSafeExternalUrl(ev.url) && (
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] dark:text-sky-400 hover:underline break-all"
                            >
                              <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span>{ev.url}</span>
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setActEvidenceDraft((prev) => prev.filter((item) => item.id !== ev.id))
                          }
                          className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                          title="Remove evidence attachment"
                          aria-label={`Remove ${ev.title || 'evidence'}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {formEvError && (
                  <p className="text-xs font-medium text-red-600 dark:text-red-400">{formEvError}</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={formEvTitle}
                    onChange={(e) => setFormEvTitle(e.target.value)}
                    placeholder="Document / note label (e.g., Inspection Report)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                  />
                  <input
                    type="url"
                    value={formEvUrl}
                    onChange={(e) => setFormEvUrl(e.target.value)}
                    placeholder="External document URL (https://...)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={formEvNote}
                    onChange={(e) => setFormEvNote(e.target.value)}
                    placeholder="Supporting text note or reference details..."
                    className="flex-1 min-w-[200px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddFormEvidence}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Attach Note / URL</span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActivityModalOpen(false)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#163A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e4b7a] disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Activity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailActivity && (() => {
        const liveDetailActivity =
          activities.find((a) => a.id === detailActivity.id) || detailActivity;
        const milestones = Array.isArray(liveDetailActivity.milestones)
          ? liveDetailActivity.milestones
          : [];
        const completedMilestoneCount = milestones.filter(
          (m) => m.status === 'Completed'
        ).length;
        const milestoneTotal = milestones.length;
        const milestoneCompletionPct =
          milestoneTotal > 0 ? Math.round((completedMilestoneCount / milestoneTotal) * 100) : 0;

        const persistMilestones = async (nextMilestones: ActivityMilestone[]) => {
          setMilestoneBusy(true);
          setMilestoneError(null);
          try {
            const now = new Date().toISOString();
            const updated: Activity = {
              ...liveDetailActivity,
              milestones: nextMilestones,
              updatedBy: userUid,
              updatedAt: now,
            };
            await onUpdateActivity(updated);
            setDetailActivity({
              ...liveDetailActivity,
              milestones: nextMilestones,
              updatedBy: userUid,
              updatedAt: now,
            });
          } catch (err) {
            setMilestoneError(
              err instanceof Error ? err.message : 'Unable to save milestone changes.'
            );
          } finally {
            setMilestoneBusy(false);
          }
        };

        const handleAddMilestone = async (e: React.FormEvent) => {
          e.preventDefault();
          const title = newMilestoneTitle.trim();
          if (!title) return;
          const nextItem: ActivityMilestone = {
            id: `ms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title,
            status: 'Pending',
            ...(newMilestoneDueDate.trim() ? { dueDate: newMilestoneDueDate.trim() } : {}),
          };
          await persistMilestones([...milestones, nextItem]);
          setNewMilestoneTitle('');
          setNewMilestoneDueDate('');
        };

        const handleUpdateMilestoneStatus = async (
          milestoneId: string,
          nextStatus: MilestoneStatus
        ) => {
          const now = new Date().toISOString();
          const next = milestones.map((m) =>
            m.id === milestoneId
              ? {
                  ...m,
                  status: nextStatus,
                  completedAt:
                    nextStatus === 'Completed' ? m.completedAt || now : undefined,
                }
              : m
          );
          await persistMilestones(next);
        };

        const handleDeleteMilestone = async (milestoneId: string) => {
          await persistMilestones(milestones.filter((m) => m.id !== milestoneId));
        };

        const evidenceItems = Array.isArray(liveDetailActivity.evidence)
          ? liveDetailActivity.evidence
          : [];

        const persistEvidence = async (nextEvidence: ActivityEvidenceItem[]) => {
          setEvidenceBusy(true);
          setEvidenceError(null);
          try {
            const now = new Date().toISOString();
            const updated: Activity = {
              ...liveDetailActivity,
              evidence: nextEvidence,
              updatedBy: userUid,
              updatedAt: now,
            };
            await onUpdateActivity(updated);
            setDetailActivity({
              ...liveDetailActivity,
              evidence: nextEvidence,
              updatedBy: userUid,
              updatedAt: now,
            });
          } catch (err) {
            setEvidenceError(
              err instanceof Error ? err.message : 'Unable to save evidence attachment.'
            );
          } finally {
            setEvidenceBusy(false);
          }
        };

        const handleAddEvidence = async (e: React.FormEvent) => {
          e.preventDefault();
          const title = newEvidenceTitle.trim();
          const note = newEvidenceNote.trim();
          const url = newEvidenceUrl.trim();
          if (!title && !note && !url) {
            setEvidenceError('Provide a supporting note or external document link.');
            return;
          }
          if (url && !isSafeExternalUrl(url)) {
            setEvidenceError('Document URL must be a valid https:// or http:// link.');
            return;
          }
          const nextItem: ActivityEvidenceItem = {
            id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: title || (url ? 'External Document Link' : 'Supporting Note'),
            note,
            url,
            addedByUid: userUid,
            addedByName: userName || userOfficeName || 'Monitoring Personnel',
            addedAt: new Date().toISOString(),
          };
          await persistEvidence([...evidenceItems, nextItem]);
          setNewEvidenceTitle('');
          setNewEvidenceNote('');
          setNewEvidenceUrl('');
        };

        const handleDeleteEvidence = async (evidenceId: string) => {
          await persistEvidence(evidenceItems.filter((item) => item.id !== evidenceId));
        };

        const parentProg = programs.find((p) => p.id === liveDetailActivity.programId);
        const progSum = parentProg
          ? summarizeProgram(
              parentProg,
              activities.filter((a) => a.programId === parentProg.id)
            )
          : undefined;
        const bd = resolveActivityBudgetDisplay(liveDetailActivity, parentProg, progSum);
        const activeMonths = MONTHS.filter(
          (m) =>
            safeNum(liveDetailActivity.monthly[m.key]?.financialActual) > 0 ||
            safeNum(liveDetailActivity.monthly[m.key]?.physicalActual) > 0
        );

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] dark:bg-slate-950/75 p-4 overflow-y-auto">
          <div
            ref={detailModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-modal-title"
            className="my-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <p className="font-mono text-xs font-semibold text-[#2563EB] dark:text-sky-400">
                  {liveDetailActivity.referenceNumber} · FY {liveDetailActivity.fiscalYear}
                </p>
                <h3 id="detail-modal-title" className="mt-1 text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                  {liveDetailActivity.description}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailActivity(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close detail modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

                <div className="mt-4 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Implementing Unit</span>
                      <p className="font-medium text-slate-900 dark:text-slate-100">{liveDetailActivity.officeName}</p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Source of Fund</span>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {liveDetailActivity.sourceOfFund || liveDetailActivity.budgetClassification}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Actual Output</span>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {liveDetailActivity.targetOutputs || '—'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Approved Budget</span>
                      <p className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatPHP(bd.approvedBudget)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {bd.isPsExempt
                          ? 'Revised Budget (PS Exempted from 15%)'
                          : 'Revised Budget (Approved − 15%)'}
                      </span>
                      <p className="font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                        {formatPHP(bd.revisedBudget)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Expenditure / Remaining Budget</span>
                      <p className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatPHP(bd.expenditure)} /{' '}
                        <span
                          className={
                            bd.remainingBudget < 0
                              ? 'text-red-600 dark:text-red-400 font-semibold'
                              : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          }
                        >
                          {formatPHP(bd.remainingBudget)}
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Physical Actual</span>
                      <p className="font-mono font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                        {formatQty(liveDetailActivity.annualPhysicalActual)}
                      </p>
                    </div>
                  </div>

                  {/* Linked Tasks & Milestones Completion Progress Bar */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          Linked Tasks &amp; Milestones Progress
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Completion is calculated from linked milestones marked as Completed
                        </p>
                      </div>
                      <span className="font-mono text-xs font-bold text-[#163A5F] dark:text-sky-400 tabular-nums">
                        {completedMilestoneCount} of {milestoneTotal} Completed ({milestoneCompletionPct}%)
                      </span>
                    </div>

                    <div
                      role="progressbar"
                      aria-valuenow={milestoneCompletionPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Linked tasks completion progress"
                      className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                    >
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          milestoneCompletionPct === 100
                            ? 'bg-emerald-600 dark:bg-emerald-400'
                            : milestoneCompletionPct > 0
                            ? 'bg-[#2563EB] dark:bg-sky-400'
                            : 'bg-slate-400 dark:bg-slate-600'
                        }`}
                        style={{ width: `${milestoneCompletionPct}%` }}
                      />
                    </div>

                    {milestoneError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-xs text-red-700 dark:text-red-300"
                      >
                        {milestoneError}
                      </div>
                    )}

                    {milestones.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-1">
                        No linked tasks or milestones added yet.{canEditStructure ? ' Add a milestone below to track task-level completion.' : ''}
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-200/80 dark:divide-slate-700/80 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                        {milestones.map((ms) => {
                          const isDone = ms.status === 'Completed';
                          const isInProg = ms.status === 'In Progress';
                          return (
                            <div
                              key={ms.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                            >
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                {canEditStructure ? (
                                  <button
                                    type="button"
                                    disabled={milestoneBusy}
                                    onClick={() =>
                                      void handleUpdateMilestoneStatus(
                                        ms.id,
                                        isDone ? 'Pending' : 'Completed'
                                      )
                                    }
                                    className="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 disabled:opacity-50"
                                    title={isDone ? 'Mark as Pending' : 'Mark as Completed'}
                                    aria-label={isDone ? `Mark ${ms.title} as Pending` : `Mark ${ms.title} as Completed`}
                                  >
                                    {isDone ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                    ) : isInProg ? (
                                      <Clock className="h-4 w-4 text-[#2563EB] dark:text-sky-400" />
                                    ) : (
                                      <Circle className="h-4 w-4" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="mt-0.5 shrink-0">
                                    {isDone ? (
                                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                    ) : isInProg ? (
                                      <Clock className="h-4 w-4 text-[#2563EB] dark:text-sky-400" />
                                    ) : (
                                      <Circle className="h-4 w-4 text-slate-400" />
                                    )}
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <p
                                    className={`font-medium break-words ${
                                      isDone
                                        ? 'line-through text-slate-400 dark:text-slate-500'
                                        : 'text-slate-800 dark:text-slate-200'
                                    }`}
                                  >
                                    {ms.title}
                                  </p>
                                  {(ms.dueDate || ms.completedAt) && (
                                    <p className="mt-0.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                      {ms.dueDate ? `Due ${ms.dueDate}` : ''}
                                      {ms.dueDate && ms.completedAt ? ' · ' : ''}
                                      {ms.completedAt
                                        ? `Completed ${new Date(ms.completedAt).toLocaleDateString('en-PH')}`
                                        : ''}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {canEditStructure ? (
                                  <>
                                    <select
                                      aria-label={`Status for ${ms.title}`}
                                      disabled={milestoneBusy}
                                      value={ms.status}
                                      onChange={(e) =>
                                        void handleUpdateMilestoneStatus(
                                          ms.id,
                                          e.target.value as MilestoneStatus
                                        )
                                      }
                                      className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 focus:border-[#2563EB] focus:outline-none disabled:opacity-50"
                                    >
                                      <option value="Pending">Pending</option>
                                      <option value="In Progress">In Progress</option>
                                      <option value="Completed">Completed</option>
                                    </select>
                                    <button
                                      type="button"
                                      disabled={milestoneBusy}
                                      onClick={() => void handleDeleteMilestone(ms.id)}
                                      className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                                      title="Remove milestone"
                                      aria-label={`Remove ${ms.title}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <span
                                    className={`font-semibold text-[11px] ${
                                      isDone
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : isInProg
                                        ? 'text-[#2563EB] dark:text-sky-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                  >
                                    {ms.status}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {canEditStructure && (
                      <form
                        onSubmit={handleAddMilestone}
                        className="flex flex-wrap items-center gap-2 pt-1"
                      >
                        <input
                          type="text"
                          value={newMilestoneTitle}
                          onChange={(e) => setNewMilestoneTitle(e.target.value)}
                          placeholder="Add linked task or milestone (e.g., Procurement Posting, Site Inspection)..."
                          disabled={milestoneBusy}
                          className="flex-1 min-w-[200px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                        />
                        <input
                          type="date"
                          aria-label="Milestone due date"
                          value={newMilestoneDueDate}
                          onChange={(e) => setNewMilestoneDueDate(e.target.value)}
                          disabled={milestoneBusy}
                          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-700 dark:text-slate-200 focus:border-[#2563EB] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={milestoneBusy || !newMilestoneTitle.trim()}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{milestoneBusy ? 'Saving...' : 'Add Task'}</span>
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Evidence Notes & External Document Links */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                          <Paperclip className="h-3.5 w-3.5 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
                          <span>Evidence Notes &amp; Supporting Document Links</span>
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Attach verification notes or external document URLs for evidence-based reporting
                        </p>
                      </div>
                      <span className="font-mono text-xs font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
                        {evidenceItems.length} {evidenceItems.length === 1 ? 'attachment' : 'attachments'}
                      </span>
                    </div>

                    {evidenceError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-xs text-red-700 dark:text-red-300"
                      >
                        {evidenceError}
                      </div>
                    )}

                    {evidenceItems.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-1">
                        No supporting notes or external document links attached yet.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-200/80 dark:divide-slate-700/80 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                        {evidenceItems.map((ev) => (
                          <div
                            key={ev.id}
                            className="flex items-start justify-between gap-3 px-3 py-2.5 text-xs"
                          >
                            <div className="min-w-0 space-y-1 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                                <span className="font-semibold text-slate-900 dark:text-slate-100 break-words">
                                  {ev.title || (ev.url ? 'External Document Link' : 'Supporting Note')}
                                </span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                  {ev.addedByName ? `${ev.addedByName} · ` : ''}
                                  {ev.addedAt ? new Date(ev.addedAt).toLocaleDateString('en-PH') : ''}
                                </span>
                              </div>
                              {ev.note && (
                                <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                                  {ev.note}
                                </p>
                              )}
                              {ev.url && isSafeExternalUrl(ev.url) && (
                                <a
                                  href={ev.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 font-medium text-[#2563EB] dark:text-sky-400 hover:underline break-all"
                                >
                                  <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>{ev.url}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                </a>
                              )}
                            </div>
                            {canEditStructure && (
                              <button
                                type="button"
                                disabled={evidenceBusy}
                                onClick={() => void handleDeleteEvidence(ev.id)}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                                title="Remove evidence attachment"
                                aria-label={`Remove ${ev.title || 'evidence'}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {canEditStructure && (
                      <form onSubmit={handleAddEvidence} className="space-y-2 pt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={newEvidenceTitle}
                            onChange={(e) => setNewEvidenceTitle(e.target.value)}
                            placeholder="Label / Title (e.g., Accomplishment Report, Site Photos)"
                            disabled={evidenceBusy}
                            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                          />
                          <input
                            type="url"
                            value={newEvidenceUrl}
                            onChange={(e) => setNewEvidenceUrl(e.target.value)}
                            placeholder="External document URL (https://...)"
                            disabled={evidenceBusy}
                            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                          />
                        </div>
                        <div className="flex flex-wrap items-start gap-2">
                          <textarea
                            rows={2}
                            value={newEvidenceNote}
                            onChange={(e) => setNewEvidenceNote(e.target.value)}
                            placeholder="Attach supporting note, document reference, or verification summary..."
                            disabled={evidenceBusy}
                            className="flex-1 min-w-[220px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={
                              evidenceBusy ||
                              (!newEvidenceTitle.trim() &&
                                !newEvidenceNote.trim() &&
                                !newEvidenceUrl.trim())
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{evidenceBusy ? 'Saving...' : 'Attach Evidence'}</span>
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  {/* Visual Lifecycle & Progress Timeline Chart */}
                  <PpaTimelineChart
                    activity={liveDetailActivity}
                    program={parentProg}
                    budgetDisplay={bd}
                  />

                  {activeMonths.length > 0 && (
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Monthly Entries Recorded
                      </span>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {activeMonths.map((m) => (
                          <div
                            key={m.key}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs"
                          >
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {m.label}:{' '}
                            </span>
                            <span className="font-mono font-semibold text-[#163A5F] dark:text-sky-400 tabular-nums">
                              {formatPHP(liveDetailActivity.monthly[m.key].financialActual)}
                              {liveDetailActivity.monthly[m.key].physicalActual > 0
                                ? ` · Phys ${formatQty(liveDetailActivity.monthly[m.key].physicalActual)}`
                                : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Program Accomplishment Status &amp; Activity Remarks</span>
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <StatusBadge status={parentProg?.status || liveDetailActivity.status} />
                      <span className="text-sm text-slate-700 dark:text-slate-300">
                        {liveDetailActivity.remarks || 'No remarks recorded.'}
                      </span>
                    </div>
                  </div>

                  {(() => {
                    const relatedHistory = auditLogs
                      .filter(
                        (l) =>
                          (l.entityId === liveDetailActivity.id ||
                            (parentProg && l.entityId === parentProg.id)) &&
                          Array.isArray(l.changes) &&
                          l.changes.length > 0
                      )
                      .slice(0, 8);
                    if (relatedHistory.length === 0) return null;
                    return (
                      <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                          <History className="h-3.5 w-3.5 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
                          <span>Recent Change History ({relatedHistory.length})</span>
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {relatedHistory.map((log) => (
                            <div
                              key={log.id}
                              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-2.5 text-xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                <span className="font-semibold text-slate-700 dark:text-slate-200">
                                  {log.userName} ({log.action})
                                </span>
                                <span className="font-mono">
                                  {new Date(log.timestamp).toLocaleString('en-PH')}
                                </span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-2">
                                {log.changes!.map((ch, idx) => (
                                  <div
                                    key={`${log.id}-ch-${idx}`}
                                    className="rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px]"
                                  >
                                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                      {ch.field}:
                                    </span>{' '}
                                    <span className="line-through text-red-600 dark:text-red-400">
                                      {ch.before || '—'}
                                    </span>{' '}
                                    →{' '}
                                    <span className="font-medium text-emerald-700 dark:text-emerald-400">
                                      {ch.after || '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailActivity(null)}
                className="rounded-lg bg-[#163A5F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e4b7a] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      <SupplementalBudgetModal
        program={supplementalProgram}
        programActivities={
          supplementalProgram
            ? activities.filter(
                (a) =>
                  a.programId === supplementalProgram.id ||
                  a.subprogramId === supplementalProgram.id
              )
            : []
        }
        userUid={userUid}
        userName={userName || userOfficeName || 'Monitoring User'}
        onClose={() => setSupplementalProgram(null)}
        onSaveProgram={onUpdateProgram}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={
          confirmDelete?.type === 'program'
            ? 'Delete Program'
            : confirmDelete?.type === 'bulk_activity'
              ? 'Delete Selected Activities'
              : 'Delete Activity'
        }
        message={
          confirmDelete?.type === 'program'
            ? `Are you sure you want to delete "${confirmDelete.label}"? All activities and remarks grouped under this program will also be removed.`
            : confirmDelete?.type === 'bulk_activity'
              ? `Are you sure you want to delete ${confirmDelete.label}? Linked monitoring observations will also be removed and recorded in the audit log.`
              : `Are you sure you want to delete "${confirmDelete?.label}"? This action will be recorded in the audit log.`
        }
        confirmLabel={confirmDelete?.type === 'bulk_activity' ? 'Delete Selected' : 'Delete Record'}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          if (confirmDelete.type === 'program') {
            await onDeleteProgram(confirmDelete.id);
          } else if (confirmDelete.type === 'bulk_activity' && confirmDelete.ids && onBulkDeleteActivities) {
            await onBulkDeleteActivities(confirmDelete.ids);
            setSelectedActivityIds([]);
          } else {
            await onDeleteActivity(confirmDelete.id);
          }
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
