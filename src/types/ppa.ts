export type UserRole = 'ADMINISTRATOR' | 'ENCODER' | 'VIEWER';

export type ImplementationStatus =
  | 'COMPLETED'
  | 'ON-GOING'
  | 'PENDING'
  | 'NOT IMPLEMENTED';

export type BudgetClassification =
  | 'GF'
  | 'PS'
  | 'MOOE'
  | 'CO'
  | 'PS / MOOE'
  | 'MOOE / CO'
  | 'PS / MOOE / CO';

export type MonthKey =
  | 'jan'
  | 'feb'
  | 'mar'
  | 'apr'
  | 'may'
  | 'jun'
  | 'jul'
  | 'aug'
  | 'sep'
  | 'oct'
  | 'nov'
  | 'dec';

export interface MonthlyEntry {
  physicalTarget: number;
  financialTarget: number;
  physicalActual: number;
  financialActual: number;
}

export type MonthlyMonitoringMap = Record<MonthKey, MonthlyEntry>;

export interface UserAccount {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  officeId: string;
  officeName: string;
  position: string;
  passcode?: string;
  clearPasscode?: boolean;
  hasPasscode?: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthDirectoryUser {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  officeId: string;
  officeName: string;
  position: string;
  hasPasscode: boolean;
  isActive: boolean;
}

export interface Office {
  id: string;
  code: string;
  name: string;
  headName: string;
  createdAt: string;
}

export interface FiscalYear {
  id: string;
  year: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

export interface ProgramSupplementalLog {
  id: string;
  type: 'ADD' | 'SUBTRACT';
  amount: number;
  signedAmount: number;
  notes?: string;
  updatedBy: string;
  updatedByName: string;
  timestamp: string;
}

export interface Program {
  id: string;
  fiscalYear: string;
  aipRefCode: string;
  title: string;
  sector: string;
  budget?: number;
  supplementalBudget?: number;
  supplementalLogs?: ProgramSupplementalLog[];
  physicalTarget?: number;
  monthlyPhysicalTarget?: Partial<Record<MonthKey, number>>;
  sourceOfFund?: string;
  gadFund?: boolean;
  officeId: string;
  officeName: string;
  parentProgramId: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  programId: string;
  subprogramId: string | null;
  fiscalYear: string;
  referenceNumber: string;
  description: string;
  targetOutputs: string;
  officeId: string;
  officeName: string;
  sourceOfFund?: string;
  budgetClassification: BudgetClassification;
  gf?: number;
  ps: number;
  mooe: number;
  co: number;
  withheldAmount: number;
  supplementalBudget1: number;
  supplementalBudget2: number;
  supplementalBudget3: number;
  supplementalBudget4: number;
  supplementalBudget5: number;
  monthly: MonthlyMonitoringMap;
  status: ImplementationStatus;
  remarks: string;
  orderIndex?: number;
  startDate?: string;
  endDate?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityComputed extends Activity {
  gf: number;
  approvedBudget: number; // GF + PS + MOOE + CO
  totalSupplemental: number; // Sum of Supplemental 1..5
  revisedBudget: number; // PS exempted; GF/MOOE/CO less 15%
  annualPhysicalTarget: number;
  annualFinancialTarget: number;
  annualPhysicalActual: number;
  annualFinancialActual: number; // Total Budget Utilized
  remainingBudget: number; // Revised Budget - Annual Financial Actual
  budgetUtilizationPct: number; // (Annual Financial Actual / Revised Budget) * 100
  physicalAccomplishmentPct: number; // (Annual Physical Actual / Annual Physical Target) * 100
  financialAccomplishmentPct: number; // (Annual Financial Actual / Annual Financial Target) * 100
}

export interface RemarkLog {
  id: string;
  activityId: string;
  authorUid: string;
  authorName: string;
  authorRole: UserRole;
  observation: string;
  monitoringDate: string;
  createdAt: string;
}

export interface UploadedDocument {
  id: string;
  fileName: string;
  fileSize: number;
  fiscalYear: string;
  recordsImported: number;
  uploadedByUid: string;
  uploadedByName: string;
  uploadedAt: string;
  notes: string;
}

export type AuditActionType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'IMPORT'
  | 'EXPORT'
  | 'STATUS_CHANGE'
  | 'LOGIN'
  | 'AUTH_FAILED'
  | 'SETTINGS'
  | 'BACKUP'
  | 'RESTORE';

export interface AuditChangeDiff {
  field: string;
  before: string;
  after: string;
}

export interface AuditLog {
  id: string;
  userUid: string;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  userOfficeName?: string;
  action: AuditActionType;
  entityType: string;
  entityId: string;
  summary: string;
  details: string;
  changes?: AuditChangeDiff[];
  prevHash?: string;
  entryHash?: string;
  timestamp: string;
}

export interface SystemSettings {
  appName?: string;
  appLogoDataUrl?: string;
  municipalityName: string;
  provinceName: string;
  officeTitle: string;
  defaultFiscalYear: string;
  preparedByName: string;
  preparedByTitle: string;
  reviewedByName: string;
  reviewedByTitle: string;
  approvedByName: string;
  approvedByTitle: string;
  firebaseWebConfigJson: string;
  theme?: 'light' | 'dark';
}

export interface DatabasePayload {
  users: UserAccount[];
  offices: Office[];
  fiscalYears: FiscalYear[];
  programs: Program[];
  activities: Activity[];
  remarksLogs: RemarkLog[];
  uploadedDocuments: UploadedDocument[];
  auditLogs: AuditLog[];
  settings: SystemSettings;
  officeAccountsProvisioned?: boolean;
}

export interface BackupInfo {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  programCount: number;
  activityCount: number;
}

export interface AuditIntegrityResult {
  valid: boolean;
  totalChecked: number;
  brokenAuditId?: string;
  message: string;
}

export type SidebarModule =
  | 'dashboard'
  | 'programs'
  | 'budget'
  | 'gad'
  | 'status'
  | 'evaluation'
  | 'reports'
  | 'excel'
  | 'users'
  | 'settings';
