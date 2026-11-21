import {
  Activity,
  ActivityComputed,
  ImplementationStatus,
  MonthKey,
  MonthlyEntry,
  MonthlyMonitoringMap,
  Program,
} from '../types/ppa';

export const MONTHS: { key: MonthKey; label: string; short: string; index: number }[] = [
  { key: 'jan', label: 'January', short: 'Jan', index: 0 },
  { key: 'feb', label: 'February', short: 'Feb', index: 1 },
  { key: 'mar', label: 'March', short: 'Mar', index: 2 },
  { key: 'apr', label: 'April', short: 'Apr', index: 3 },
  { key: 'may', label: 'May', short: 'May', index: 4 },
  { key: 'jun', label: 'June', short: 'Jun', index: 5 },
  { key: 'jul', label: 'July', short: 'Jul', index: 6 },
  { key: 'aug', label: 'August', short: 'Aug', index: 7 },
  { key: 'sep', label: 'September', short: 'Sep', index: 8 },
  { key: 'oct', label: 'October', short: 'Oct', index: 9 },
  { key: 'nov', label: 'November', short: 'Nov', index: 10 },
  { key: 'dec', label: 'December', short: 'Dec', index: 11 },
];

export const STATUS_OPTIONS: ImplementationStatus[] = [
  'COMPLETED',
  'ON-GOING',
  'PENDING',
  'NOT IMPLEMENTED',
];

export function safeNum(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (typeof val === 'string') {
    const cleaned = val.replace(/[₱,\s]/g, '');
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function round2(val: number): number {
  return Math.round((safeNum(val) + Number.EPSILON) * 100) / 100;
}

export function createEmptyMonthlyEntry(): MonthlyEntry {
  return {
    physicalTarget: 0,
    financialTarget: 0,
    physicalActual: 0,
    financialActual: 0,
  };
}

export function createEmptyMonthlyData(): MonthlyMonitoringMap {
  return {
    jan: createEmptyMonthlyEntry(),
    feb: createEmptyMonthlyEntry(),
    mar: createEmptyMonthlyEntry(),
    apr: createEmptyMonthlyEntry(),
    may: createEmptyMonthlyEntry(),
    jun: createEmptyMonthlyEntry(),
    jul: createEmptyMonthlyEntry(),
    aug: createEmptyMonthlyEntry(),
    sep: createEmptyMonthlyEntry(),
    oct: createEmptyMonthlyEntry(),
    nov: createEmptyMonthlyEntry(),
    dec: createEmptyMonthlyEntry(),
  };
}

export function normalizeMonthlyData(
  partial?: Partial<MonthlyMonitoringMap> | null
): MonthlyMonitoringMap {
  const base = createEmptyMonthlyData();
  if (!partial) return base;
  for (const m of MONTHS) {
    const entry = partial[m.key];
    if (entry) {
      base[m.key] = {
        physicalTarget: safeNum(entry.physicalTarget),
        financialTarget: round2(safeNum(entry.financialTarget)),
        physicalActual: safeNum(entry.physicalActual),
        financialActual: round2(safeNum(entry.financialActual)),
      };
    }
  }
  return base;
}

export function createEmptyMonthlyPhysicalTargets(): Record<MonthKey, number> {
  return {
    jan: 0,
    feb: 0,
    mar: 0,
    apr: 0,
    may: 0,
    jun: 0,
    jul: 0,
    aug: 0,
    sep: 0,
    oct: 0,
    nov: 0,
    dec: 0,
  };
}

export function normalizeMonthlyPhysicalTargets(
  partial?: Partial<Record<MonthKey, number>> | null
): Record<MonthKey, number> {
  const base = createEmptyMonthlyPhysicalTargets();
  if (!partial) return base;
  for (const m of MONTHS) {
    base[m.key] = Math.max(0, safeNum(partial[m.key]));
  }
  return base;
}

export function sumMonthlyPhysicalTargets(
  targets?: Partial<Record<MonthKey, number>> | null
): number {
  if (!targets) return 0;
  let total = 0;
  for (const m of MONTHS) {
    total += Math.max(0, safeNum(targets[m.key]));
  }
  return Math.round(total * 10000) / 10000;
}

export function isPersonnelServicesFund(source?: string | null): boolean {
  const s = (source || '').trim().toUpperCase();
  if (!s) return false;
  return (
    s === 'PS' ||
    s === 'PERSONNEL SERVICES' ||
    s === 'PERSONNEL SERVICES (PS)' ||
    s.includes('(PS)') ||
    s.includes('PERSONNEL SERVICES')
  );
}

export function classifyFundBucket(source?: string | null): 'PS' | 'MOOE' | 'CO' | 'GF' {
  const s = (source || '').trim().toUpperCase();
  if (!s) return 'GF';
  if (isPersonnelServicesFund(s)) return 'PS';
  if (
    s === 'MOOE' ||
    s.includes('(MOOE)') ||
    s.includes('MAINTENANCE AND OTHER OPERATING')
  ) {
    return 'MOOE';
  }
  if (s === 'CO' || s.includes('(CO)') || s.includes('CAPITAL OUTLAY')) {
    return 'CO';
  }
  if (s === 'GF' || s.includes('(GF)') || s.includes('GENERAL FUND')) {
    return 'GF';
  }
  return 'GF';
}

export function inferFundAmounts(
  approvedBudget: number,
  sourceOfFund?: string | null
): { gf: number; ps: number; mooe: number; co: number } {
  const amount = round2(approvedBudget);
  if (amount <= 0) return { gf: 0, ps: 0, mooe: 0, co: 0 };
  const bucket = classifyFundBucket(sourceOfFund);
  if (bucket === 'PS') return { gf: 0, ps: amount, mooe: 0, co: 0 };
  if (bucket === 'MOOE') return { gf: 0, ps: 0, mooe: amount, co: 0 };
  if (bucket === 'CO') return { gf: 0, ps: 0, mooe: 0, co: amount };
  return { gf: amount, ps: 0, mooe: 0, co: 0 };
}

/**
 * 15% reservation ("Approved − 15%") applies only to General Fund (GF),
 * Capital Outlay (CO), and Maintenance and Other Operating Expenses (MOOE).
 * Personnel Services (PS) is exempted from the 15% reservation.
 */
export function calculateRevisedBudgetByFund(
  approvedBudget: number,
  sourceOfFund?: string | null,
  breakdown?: { gf?: number; ps?: number; mooe?: number; co?: number }
): number {
  const total = round2(safeNum(approvedBudget));
  if (total <= 0) return 0;

  if (breakdown) {
    const gf = round2(safeNum(breakdown.gf));
    const ps = round2(safeNum(breakdown.ps));
    const mooe = round2(safeNum(breakdown.mooe));
    const co = round2(safeNum(breakdown.co));
    if (gf > 0 || ps > 0 || mooe > 0 || co > 0) {
      if (isPersonnelServicesFund(sourceOfFund) && mooe === 0 && co === 0 && gf === 0) {
        return total;
      }
      return round2(ps + (gf + mooe + co) * 0.85);
    }
  }

  if (isPersonnelServicesFund(sourceOfFund)) {
    return total;
  }

  return round2(total * 0.85);
}

export function calculateSignedRevisedDelta(
  signedAmount: number,
  sourceOfFund?: string | null
): number {
  const amt = round2(safeNum(signedAmount));
  if (amt === 0) return 0;
  if (isPersonnelServicesFund(sourceOfFund)) {
    return amt;
  }
  return round2(amt * 0.85);
}

function applySignedFundBucketDelta(
  buckets: { gf: number; ps: number; mooe: number; co: number },
  signedDelta: number,
  sourceOfFund?: string | null
): { gf: number; ps: number; mooe: number; co: number } {
  const delta = round2(signedDelta);
  if (delta === 0) return buckets;
  const primary = classifyFundBucket(sourceOfFund);
  const next = { ...buckets };

  const key =
    primary === 'PS'
      ? 'ps'
      : primary === 'MOOE'
        ? 'mooe'
        : primary === 'CO'
          ? 'co'
          : 'gf';

  if (delta > 0) {
    next[key] = round2(next[key] + delta);
    return next;
  }

  let remainingToDeduct = Math.abs(delta);
  const order: ('gf' | 'ps' | 'mooe' | 'co')[] = [
    key,
    ...(['gf', 'ps', 'mooe', 'co'] as const).filter((k) => k !== key),
  ];
  for (const k of order) {
    if (remainingToDeduct <= 0) break;
    const take = Math.min(next[k], remainingToDeduct);
    next[k] = round2(next[k] - take);
    remainingToDeduct = round2(remainingToDeduct - take);
  }
  return next;
}

export function computeActivityMetrics(activity: Activity): ActivityComputed {
  const gf = round2(safeNum(activity.gf));
  const ps = round2(safeNum(activity.ps));
  const mooe = round2(safeNum(activity.mooe));
  const co = round2(safeNum(activity.co));
  const withheldAmount = round2(safeNum(activity.withheldAmount));
  const s1 = round2(safeNum(activity.supplementalBudget1));
  const s2 = round2(safeNum(activity.supplementalBudget2));
  const s3 = round2(safeNum(activity.supplementalBudget3));
  const s4 = round2(safeNum(activity.supplementalBudget4));
  const s5 = round2(safeNum(activity.supplementalBudget5));

  const approvedBudget = round2(gf + ps + mooe + co);
  const totalSupplemental = round2(s1 + s2 + s3 + s4 + s5);
  const revisedBudget = calculateRevisedBudgetByFund(
    approvedBudget,
    activity.sourceOfFund || activity.budgetClassification,
    { gf, ps, mooe, co }
  );

  const monthly = normalizeMonthlyData(activity.monthly);

  let annualPhysicalTarget = 0;
  let annualFinancialTarget = 0;
  let annualPhysicalActual = 0;
  let annualFinancialActual = 0;

  for (const m of MONTHS) {
    const row = monthly[m.key];
    annualPhysicalTarget += safeNum(row.physicalTarget);
    annualFinancialTarget += safeNum(row.financialTarget);
    annualPhysicalActual += safeNum(row.physicalActual);
    annualFinancialActual += safeNum(row.financialActual);
  }

  annualPhysicalTarget = Math.round(annualPhysicalTarget * 10000) / 10000;
  annualPhysicalActual = Math.round(annualPhysicalActual * 10000) / 10000;
  annualFinancialTarget = round2(annualFinancialTarget);
  annualFinancialActual = round2(annualFinancialActual);

  const remainingBudget = round2(revisedBudget - annualFinancialActual);

  const physicalAccomplishmentPct =
    annualPhysicalTarget > 0
      ? round2((annualPhysicalActual / annualPhysicalTarget) * 100)
      : 0;

  const financialAccomplishmentPct =
    annualFinancialTarget > 0
      ? round2((annualFinancialActual / annualFinancialTarget) * 100)
      : 0;

  const budgetUtilizationPct =
    revisedBudget > 0
      ? round2((annualFinancialActual / revisedBudget) * 100)
      : 0;

  return {
    ...activity,
    gf,
    ps,
    mooe,
    co,
    withheldAmount,
    supplementalBudget1: s1,
    supplementalBudget2: s2,
    supplementalBudget3: s3,
    supplementalBudget4: s4,
    supplementalBudget5: s5,
    monthly,
    approvedBudget,
    totalSupplemental,
    revisedBudget,
    annualPhysicalTarget,
    annualFinancialTarget,
    annualPhysicalActual,
    annualFinancialActual,
    remainingBudget,
    budgetUtilizationPct,
    physicalAccomplishmentPct,
    financialAccomplishmentPct,
  };
}

export function inferProgramFundBreakdown(
  program: Program,
  approvedBudget: number
): { gf: number; ps: number; mooe: number; co: number } {
  return inferFundAmounts(approvedBudget, program.sourceOfFund);
}

export interface ProgramSupplementalSlot {
  slotNumber: number;
  label: string;
  amount: number;
}

export interface ProgramSupplementalBreakdown {
  byNumber: Record<number, number>;
  orderedSlots: ProgramSupplementalSlot[];
  total: number;
}

export function getProgramSupplementalBreakdown(
  program?: Program | null
): ProgramSupplementalBreakdown {
  const byNumber: Record<number, number> = {};
  if (!program) {
    return { byNumber, orderedSlots: [], total: 0 };
  }

  const logs = Array.isArray(program.supplementalLogs) ? program.supplementalLogs : [];
  let loggedSum = 0;
  for (const entry of logs) {
    const slot = Math.max(1, Math.floor(safeNum(entry.supplementalNumber) || 1));
    const signed = round2(safeNum(entry.signedAmount));
    byNumber[slot] = round2((byNumber[slot] || 0) + signed);
    loggedSum = round2(loggedSum + signed);
  }

  const total = round2(safeNum(program.supplementalBudget));
  const residual = round2(total - loggedSum);
  if (Math.abs(residual) >= 0.01) {
    byNumber[1] = round2((byNumber[1] || 0) + residual);
  }

  const slotNums = Object.keys(byNumber)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n >= 1);
  const maxSlot = Math.max(5, ...slotNums);
  const orderedSlots: ProgramSupplementalSlot[] = [];
  for (let i = 1; i <= maxSlot; i++) {
    const amt = round2(byNumber[i] || 0);
    if (i <= 5 || amt !== 0 || byNumber[i] !== undefined) {
      orderedSlots.push({
        slotNumber: i,
        label: `Supplemental Budget ${i}`,
        amount: amt,
      });
    }
  }

  return { byNumber, orderedSlots, total };
}

export interface ProgramSummary {
  program: Program;
  activityCount: number;
  gf: number;
  ps: number;
  mooe: number;
  co: number;
  approvedBudget: number;
  withheldAmount: number;
  totalSupplemental: number;
  revisedBudget: number;
  annualPhysicalTarget: number;
  annualPhysicalActual: number;
  annualFinancialTarget: number;
  annualFinancialActual: number;
  remainingBudget: number;
  physicalAccomplishmentPct: number;
  financialAccomplishmentPct: number;
  budgetUtilizationPct: number;
}

export function summarizeProgram(
  program: Program,
  computedActivities: ActivityComputed[]
): ProgramSummary {
  const items = computedActivities.filter(
    (a) => a.programId === program.id || a.subprogramId === program.id
  );
  // Deduplicate in case an activity has both programId and subprogramId matching
  const seen = new Set<string>();
  const uniqueItems: ActivityComputed[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      uniqueItems.push(item);
    }
  }

  let gf = 0;
  let ps = 0;
  let mooe = 0;
  let co = 0;
  let activitiesApproved = 0;
  let withheldAmount = 0;
  let totalSupplemental = 0;
  let activitiesRevised = 0;
  let annualPhysicalTarget = 0;
  let annualPhysicalActual = 0;
  let annualFinancialTarget = 0;
  let annualFinancialActual = 0;

  for (const a of uniqueItems) {
    gf += a.gf;
    ps += a.ps;
    mooe += a.mooe;
    co += a.co;
    activitiesApproved += a.approvedBudget;
    withheldAmount += a.withheldAmount;
    totalSupplemental += a.totalSupplemental;
    activitiesRevised += a.revisedBudget;
    annualPhysicalTarget += a.annualPhysicalTarget;
    annualPhysicalActual += a.annualPhysicalActual;
    annualFinancialTarget += a.annualFinancialTarget;
    annualFinancialActual += a.annualFinancialActual;
  }

  activitiesApproved = round2(activitiesApproved);
  const programBudget = round2(safeNum(program.budget));
  const programSupplemental = round2(safeNum(program.supplementalBudget));
  const useProgramBudget = activitiesApproved === 0 && (programBudget > 0 || programSupplemental !== 0);

  let approvedBudget = 0;
  let revisedBudget = 0;

  const effectiveProgramSource =
    program.sourceOfFund ||
    (ps > 0 && gf === 0 && mooe === 0 && co === 0 ? 'PS' : '');

  if (useProgramBudget) {
    approvedBudget = Math.max(0, round2(programBudget + programSupplemental));
    revisedBudget = calculateRevisedBudgetByFund(approvedBudget, effectiveProgramSource);
    const breakdown = inferFundAmounts(approvedBudget, effectiveProgramSource);
    gf = breakdown.gf;
    ps = breakdown.ps;
    mooe = breakdown.mooe;
    co = breakdown.co;
  } else {
    const effectiveDelta = Math.max(-activitiesApproved, programSupplemental);
    approvedBudget = Math.max(0, round2(activitiesApproved + effectiveDelta));
    revisedBudget = Math.max(
      0,
      round2(
        activitiesRevised +
          calculateSignedRevisedDelta(effectiveDelta, effectiveProgramSource)
      )
    );
    const adjustedBuckets = applySignedFundBucketDelta(
      { gf, ps, mooe, co },
      effectiveDelta,
      effectiveProgramSource
    );
    gf = adjustedBuckets.gf;
    ps = adjustedBuckets.ps;
    mooe = adjustedBuckets.mooe;
    co = adjustedBuckets.co;
  }

  const monthlyTargetsSum = sumMonthlyPhysicalTargets(program.monthlyPhysicalTarget);
  const programPhysicalTarget =
    monthlyTargetsSum > 0
      ? monthlyTargetsSum
      : Math.round(safeNum(program.physicalTarget) * 10000) / 10000;
  const effectivePhysicalTarget =
    programPhysicalTarget > 0
      ? programPhysicalTarget
      : Math.round(annualPhysicalTarget * 10000) / 10000;
  const roundedPhysicalActual = Math.round(annualPhysicalActual * 10000) / 10000;

  annualFinancialActual = round2(annualFinancialActual);
  const remainingBudget = round2(revisedBudget - annualFinancialActual);

  return {
    program,
    activityCount: uniqueItems.length,
    gf: round2(gf),
    ps: round2(ps),
    mooe: round2(mooe),
    co: round2(co),
    approvedBudget,
    withheldAmount: round2(withheldAmount),
    totalSupplemental: round2(totalSupplemental + programSupplemental),
    revisedBudget,
    annualPhysicalTarget: effectivePhysicalTarget,
    annualPhysicalActual: roundedPhysicalActual,
    annualFinancialTarget: round2(annualFinancialTarget),
    annualFinancialActual,
    remainingBudget,
    physicalAccomplishmentPct:
      effectivePhysicalTarget > 0
        ? round2((roundedPhysicalActual / effectivePhysicalTarget) * 100)
        : 0,
    financialAccomplishmentPct:
      annualFinancialTarget > 0
        ? round2((annualFinancialActual / annualFinancialTarget) * 100)
        : 0,
    budgetUtilizationPct:
      revisedBudget > 0 ? round2((annualFinancialActual / revisedBudget) * 100) : 0,
  };
}

export interface ActivityBudgetDisplay {
  gf: number;
  ps: number;
  mooe: number;
  co: number;
  isPsExempt: boolean;
  approvedBudget: number;
  revisedBudget: number;
  expenditure: number;
  remainingBudget: number;
  utilizationPct: number;
  accomplishmentPct: number;
  isProgramBudget: boolean;
}

export function resolveActivityBudgetDisplay(
  activity: ActivityComputed,
  program?: Program,
  programSummary?: ProgramSummary
): ActivityBudgetDisplay {
  const expenditure = round2(activity.annualFinancialActual);
  if (activity.approvedBudget > 0) {
    const remainingBudget = round2(activity.revisedBudget - expenditure);
    const pct =
      activity.revisedBudget > 0 ? round2((expenditure / activity.revisedBudget) * 100) : 0;
    const isPsExempt =
      isPersonnelServicesFund(activity.sourceOfFund) ||
      (activity.ps > 0 && activity.gf === 0 && activity.mooe === 0 && activity.co === 0);
    return {
      gf: activity.gf,
      ps: activity.ps,
      mooe: activity.mooe,
      co: activity.co,
      isPsExempt,
      approvedBudget: activity.approvedBudget,
      revisedBudget: activity.revisedBudget,
      expenditure,
      remainingBudget,
      utilizationPct: pct,
      accomplishmentPct: pct,
      isProgramBudget: false,
    };
  }

  const progBudget = program
    ? Math.max(0, round2(safeNum(program.budget) + safeNum(program.supplementalBudget)))
    : 0;
  if (progBudget > 0) {
    const effectiveSource =
      activity.sourceOfFund || program?.sourceOfFund || activity.budgetClassification;
    const fundAmounts = inferFundAmounts(progBudget, effectiveSource);
    const revisedBudget = calculateRevisedBudgetByFund(progBudget, effectiveSource);
    const isPsExempt = isPersonnelServicesFund(effectiveSource);
    const totalProgExpenditure = programSummary ? programSummary.annualFinancialActual : expenditure;
    const remainingBudget = round2(revisedBudget - totalProgExpenditure);
    return {
      ...fundAmounts,
      isPsExempt,
      approvedBudget: progBudget,
      revisedBudget,
      expenditure,
      remainingBudget,
      utilizationPct:
        revisedBudget > 0 ? round2((totalProgExpenditure / revisedBudget) * 100) : 0,
      accomplishmentPct:
        revisedBudget > 0 ? round2((expenditure / revisedBudget) * 100) : 0,
      isProgramBudget: true,
    };
  }

  return {
    gf: 0,
    ps: 0,
    mooe: 0,
    co: 0,
    isPsExempt: isPersonnelServicesFund(activity.sourceOfFund || activity.budgetClassification),
    approvedBudget: 0,
    revisedBudget: 0,
    expenditure,
    remainingBudget: round2(0 - expenditure),
    utilizationPct: 0,
    accomplishmentPct: 0,
    isProgramBudget: false,
  };
}

export interface DashboardSummary {
  totalPrograms: number;
  totalActivities: number;
  totalApprovedBudget: number;
  totalRevisedBudget: number;
  totalBudgetUtilized: number;
  remainingBudget: number;
  totalGF: number;
  totalPS: number;
  totalMOOE: number;
  totalCO: number;
  totalWithheld: number;
  totalSupplemental: number;
  totalPhysicalTarget: number;
  totalPhysicalActual: number;
  totalFinancialTarget: number;
  totalFinancialActual: number;
  overallPhysicalPct: number;
  overallFinancialPct: number;
  budgetUtilizationPct: number;
  completedCount: number;
  ongoingCount: number;
  pendingCount: number;
  notImplementedCount: number;
  monthlySeries: {
    month: string;
    monthKey: MonthKey;
    physicalTarget: number;
    physicalActual: number;
    financialTarget: number;
    financialActual: number;
    physicalPct: number;
    financialPct: number;
  }[];
}

export function computeDashboardSummary(
  programs: Program[],
  computedActivities: ActivityComputed[]
): DashboardSummary {
  const uniqueProgramIds = new Set(programs.map((p) => p.id));
  const totalPrograms = uniqueProgramIds.size;
  const totalActivities = computedActivities.length;

  let totalGF = 0;
  let totalPS = 0;
  let totalMOOE = 0;
  let totalCO = 0;
  let totalApprovedBudget = 0;
  let totalWithheld = 0;
  let totalSupplemental = 0;
  let totalRevisedBudget = 0;
  let totalPhysicalTarget = 0;
  let totalPhysicalActual = 0;
  let totalFinancialTarget = 0;
  let totalFinancialActual = 0;

  let completedCount = 0;
  let ongoingCount = 0;
  let pendingCount = 0;
  let notImplementedCount = 0;

  const monthlyAccum: Record<MonthKey, MonthlyEntry> = createEmptyMonthlyData();
  const approvedByProgram = new Map<string, number>();

  for (const a of computedActivities) {
    totalGF += a.gf;
    totalPS += a.ps;
    totalMOOE += a.mooe;
    totalCO += a.co;
    totalApprovedBudget += a.approvedBudget;
    totalWithheld += a.withheldAmount;
    totalSupplemental += a.totalSupplemental;
    totalRevisedBudget += a.revisedBudget;
    totalPhysicalTarget += a.annualPhysicalTarget;
    totalPhysicalActual += a.annualPhysicalActual;
    totalFinancialTarget += a.annualFinancialTarget;
    totalFinancialActual += a.annualFinancialActual;

    approvedByProgram.set(
      a.programId,
      (approvedByProgram.get(a.programId) || 0) + a.approvedBudget
    );
    if (a.subprogramId) {
      approvedByProgram.set(
        a.subprogramId,
        (approvedByProgram.get(a.subprogramId) || 0) + a.approvedBudget
      );
    }

    for (const m of MONTHS) {
      monthlyAccum[m.key].physicalTarget += a.monthly[m.key].physicalTarget;
      monthlyAccum[m.key].physicalActual += a.monthly[m.key].physicalActual;
      monthlyAccum[m.key].financialTarget += a.monthly[m.key].financialTarget;
      monthlyAccum[m.key].financialActual += a.monthly[m.key].financialActual;
    }
  }

  // Reflect Program.budget & Program.monthlyPhysicalTarget across programs
  const seenPrograms = new Set<string>();
  const physicalTargetByProgram = new Map<string, number>();
  const activityMonthlyPhysicalTargets = new Map<string, Record<MonthKey, number>>();
  for (const a of computedActivities) {
    physicalTargetByProgram.set(
      a.programId,
      (physicalTargetByProgram.get(a.programId) || 0) + a.annualPhysicalTarget
    );
    const map = activityMonthlyPhysicalTargets.get(a.programId) || createEmptyMonthlyPhysicalTargets();
    for (const m of MONTHS) {
      map[m.key] += safeNum(a.monthly[m.key].physicalTarget);
    }
    activityMonthlyPhysicalTargets.set(a.programId, map);
  }
  for (const p of programs) {
    if (seenPrograms.has(p.id)) continue;
    seenPrograms.add(p.id);
    const progStatus = p.status || 'PENDING';
    if (progStatus === 'COMPLETED') completedCount++;
    else if (progStatus === 'ON-GOING') ongoingCount++;
    else if (progStatus === 'PENDING') pendingCount++;
    else if (progStatus === 'NOT IMPLEMENTED') notImplementedCount++;
    const progBudget = round2(safeNum(p.budget));
    const progSupp = round2(safeNum(p.supplementalBudget));
    totalSupplemental = round2(totalSupplemental + progSupp);
    const actApproved = round2(approvedByProgram.get(p.id) || 0);
    const progActsForSource = computedActivities.filter(
      (a) => a.programId === p.id || a.subprogramId === p.id
    );
    const allChildPsOnly =
      progActsForSource.length > 0 &&
      progActsForSource.every((a) => a.ps > 0 && a.gf === 0 && a.mooe === 0 && a.co === 0);
    const effectiveProgSource = p.sourceOfFund || (allChildPsOnly ? 'PS' : '');

    if (actApproved === 0) {
      const effectiveProgBudget = Math.max(0, round2(progBudget + progSupp));
      if (effectiveProgBudget > 0) {
        totalApprovedBudget += effectiveProgBudget;
        totalRevisedBudget += calculateRevisedBudgetByFund(effectiveProgBudget, effectiveProgSource);
        const breakdown = inferFundAmounts(effectiveProgBudget, effectiveProgSource);
        totalGF += breakdown.gf;
        totalPS += breakdown.ps;
        totalMOOE += breakdown.mooe;
        totalCO += breakdown.co;
      }
    } else if (progSupp !== 0) {
      const effectiveDelta = Math.max(-actApproved, progSupp);
      totalApprovedBudget += effectiveDelta;
      totalRevisedBudget = Math.max(
        0,
        round2(totalRevisedBudget + calculateSignedRevisedDelta(effectiveDelta, effectiveProgSource))
      );
      const adjusted = applySignedFundBucketDelta(
        { gf: totalGF, ps: totalPS, mooe: totalMOOE, co: totalCO },
        effectiveDelta,
        effectiveProgSource
      );
      totalGF = adjusted.gf;
      totalPS = adjusted.ps;
      totalMOOE = adjusted.mooe;
      totalCO = adjusted.co;
    }
    const monthlyTargetsSum = sumMonthlyPhysicalTargets(p.monthlyPhysicalTarget);
    const progPhysTarget =
      monthlyTargetsSum > 0 ? monthlyTargetsSum : safeNum(p.physicalTarget);
    const actPhysTarget = physicalTargetByProgram.get(p.id) || 0;
    if (monthlyTargetsSum > 0 && p.monthlyPhysicalTarget) {
      // Program monthly physical targets take precedence over individual activity targets for this program
      totalPhysicalTarget = totalPhysicalTarget - actPhysTarget + monthlyTargetsSum;
      const actMonthlyMap = activityMonthlyPhysicalTargets.get(p.id);
      for (const m of MONTHS) {
        const actMonthVal = actMonthlyMap ? safeNum(actMonthlyMap[m.key]) : 0;
        const progMonthVal = Math.max(0, safeNum(p.monthlyPhysicalTarget[m.key]));
        monthlyAccum[m.key].physicalTarget =
          monthlyAccum[m.key].physicalTarget - actMonthVal + progMonthVal;
      }
    } else if (progPhysTarget > 0 && actPhysTarget === 0) {
      totalPhysicalTarget += progPhysTarget;
    }
  }

  totalApprovedBudget = round2(totalApprovedBudget);
  totalRevisedBudget = round2(totalRevisedBudget);
  totalFinancialActual = round2(totalFinancialActual);

  const remainingBudget = round2(totalRevisedBudget - totalFinancialActual);
  const overallPhysicalPct =
    totalPhysicalTarget > 0
      ? round2((totalPhysicalActual / totalPhysicalTarget) * 100)
      : 0;
  const overallFinancialPct =
    totalRevisedBudget > 0
      ? round2((totalFinancialActual / totalRevisedBudget) * 100)
      : 0;
  const budgetUtilizationPct =
    totalRevisedBudget > 0
      ? round2((totalFinancialActual / totalRevisedBudget) * 100)
      : 0;

  const monthlySeries = MONTHS.map((m) => {
    const pt = Math.round(monthlyAccum[m.key].physicalTarget * 10000) / 10000;
    const pa = Math.round(monthlyAccum[m.key].physicalActual * 10000) / 10000;
    const ft = round2(monthlyAccum[m.key].financialTarget);
    const fa = round2(monthlyAccum[m.key].financialActual);
    return {
      month: m.short,
      monthKey: m.key,
      physicalTarget: pt,
      physicalActual: pa,
      financialTarget: ft,
      financialActual: fa,
      physicalPct: pt > 0 ? round2((pa / pt) * 100) : 0,
      financialPct: ft > 0 ? round2((fa / ft) * 100) : 0,
    };
  });

  return {
    totalPrograms,
    totalActivities,
    totalApprovedBudget,
    totalRevisedBudget,
    totalBudgetUtilized: totalFinancialActual,
    remainingBudget,
    totalGF: round2(totalGF),
    totalPS: round2(totalPS),
    totalMOOE: round2(totalMOOE),
    totalCO: round2(totalCO),
    totalWithheld: round2(totalWithheld),
    totalSupplemental: round2(totalSupplemental),
    totalPhysicalTarget: Math.round(totalPhysicalTarget * 10000) / 10000,
    totalPhysicalActual: Math.round(totalPhysicalActual * 10000) / 10000,
    totalFinancialTarget: round2(totalFinancialTarget),
    totalFinancialActual,
    overallPhysicalPct,
    overallFinancialPct,
    budgetUtilizationPct,
    completedCount,
    ongoingCount,
    pendingCount,
    notImplementedCount,
    monthlySeries,
  };
}

export function formatPHP(amount: number): string {
  const num = safeNum(amount);
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `-₱${formatted}` : `₱${formatted}`;
}

export function formatCompactPHP(amount: number): string {
  const num = safeNum(amount);
  if (Math.abs(num) >= 1_000_000) {
    return `₱${(num / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(num) >= 1_000) {
    return `₱${(num / 1_000).toFixed(1)}K`;
  }
  return formatPHP(num);
}

export function formatQty(val: number): string {
  const num = safeNum(val);
  if (Number.isInteger(num)) return num.toLocaleString('en-PH');
  return num.toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatPct(val: number): string {
  const num = safeNum(val);
  return `${num.toFixed(2)}%`;
}

export interface GadComplianceSummary {
  totalBudgetApproved: number;
  totalBudgetRevised: number;
  mandatoryFivePctTarget: number;
  gadProgramCount: number;
  gadActivityCount: number;
  gadApprovedBudget: number;
  gadRevisedBudget: number;
  gadExpenditure: number;
  gadRemainingBudget: number;
  gadShareApprovedPct: number;
  gadShareRevisedPct: number;
  gadUtilizationPct: number;
  varianceFromTarget: number;
  isCompliant: boolean;
  gadPrograms: ProgramSummary[];
}

export function computeGadComplianceSummary(
  programs: Program[],
  computedActivities: ActivityComputed[]
): GadComplianceSummary {
  const dash = computeDashboardSummary(programs, computedActivities);
  const gadRawPrograms = programs.filter((p) => Boolean(p.gadFund));
  const gadProgramRows = gadRawPrograms.map((p) => summarizeProgram(p, computedActivities));

  const gadApprovedBudget = round2(
    gadProgramRows.reduce((sum, s) => sum + s.approvedBudget, 0)
  );
  const gadRevisedBudget = round2(
    gadProgramRows.reduce((sum, s) => sum + s.revisedBudget, 0)
  );
  const gadExpenditure = round2(
    gadProgramRows.reduce((sum, s) => sum + s.annualFinancialActual, 0)
  );
  const gadRemainingBudget = round2(gadRevisedBudget - gadExpenditure);
  const gadActivityCount = gadProgramRows.reduce((sum, s) => sum + s.activityCount, 0);

  const mandatoryFivePctTarget = round2(dash.totalApprovedBudget * 0.05);
  const gadShareApprovedPct =
    dash.totalApprovedBudget > 0
      ? round2((gadApprovedBudget / dash.totalApprovedBudget) * 100)
      : 0;
  const gadShareRevisedPct =
    dash.totalRevisedBudget > 0
      ? round2((gadRevisedBudget / dash.totalRevisedBudget) * 100)
      : 0;
  const gadUtilizationPct =
    gadRevisedBudget > 0 ? round2((gadExpenditure / gadRevisedBudget) * 100) : 0;
  const varianceFromTarget = round2(gadApprovedBudget - mandatoryFivePctTarget);
  const isCompliant = dash.totalApprovedBudget > 0 && gadShareApprovedPct >= 5;

  return {
    totalBudgetApproved: dash.totalApprovedBudget,
    totalBudgetRevised: dash.totalRevisedBudget,
    mandatoryFivePctTarget,
    gadProgramCount: gadProgramRows.length,
    gadActivityCount,
    gadApprovedBudget,
    gadRevisedBudget,
    gadExpenditure,
    gadRemainingBudget,
    gadShareApprovedPct,
    gadShareRevisedPct,
    gadUtilizationPct,
    varianceFromTarget,
    isCompliant,
    gadPrograms: gadProgramRows,
  };
}

