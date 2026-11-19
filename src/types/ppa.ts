export type UserRole =
  | 'SUPER_ADMIN'
  | 'ADMINISTRATOR'
  | 'OFFICE_HEAD'
  | 'ENCODER'
  | 'EVALUATOR'
  | 'VIEWER';

export type ApprovalStatus = 'APPROVED' | 'PENDING' | 'REJECTED';

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
  approvalStatus?: ApprovalStatus;
  mustChangePassword?: boolean;
  allowedModules?: SidebarModule[];
  lastLoginAt?: string;
  lastLoginIp?: string;
  privacyConsentAt?: string;
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

export type SessionNetworkScope = 'LOCAL' | 'PRIVATE' | 'PUBLIC' | 'UNKNOWN';

export interface ActiveSessionInfo {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: number;
  ipAddress: string;
  userAgent: string;
  isCurrent: boolean;
}

export interface AdminActiveSession extends ActiveSessionInfo {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  officeName: string;
  subnet: string;
  locationLabel: string;
  networkZone: string;
  scope: SessionNetworkScope;
}

export interface IpLocationGroup {
  key: string;
  ipAddress: string;
  subnet: string;
  locationLabel: string;
  networkZone: string;
  scope: SessionNetworkScope;
  sessionCount: number;
  userCount: number;
  lastActivityAt: string;
  users: {
    userId: string;
    displayName: string;
    role: UserRole;
    officeName: string;
  }[];
}

export interface SessionZoneBreakdown {
  zone: string;
  scope: SessionNetworkScope;
  sessionCount: number;
  uniqueIpCount: number;
  pct: number;
}

export interface ActiveSessionsOverview {
  totalActiveSessions: number;
  uniqueIpCount: number;
  uniqueUserCount: number;
  locationGroups: IpLocationGroup[];
  zoneBreakdown: SessionZoneBreakdown[];
  sessions: AdminActiveSession[];
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

export type MilestoneStatus = 'Pending' | 'In Progress' | 'Completed';

export interface ActivityMilestone {
  id: string;
  title: string;
  status: MilestoneStatus;
  dueDate?: string;
  completedAt?: string;
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
  milestones?: ActivityMilestone[];
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
  allowSelfRegistration?: boolean;
  sessionTimeoutMinutes?: number;
  autoBackupEnabled?: boolean;
  autoBackupIntervalHours?: number;
  backupRetentionCount?: number;
  privacyNoticeText?: string;
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
  demoSeedAllowed?: boolean;
}

export interface BackupInfo {
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  programCount: number;
  activityCount: number;
  sha256?: string;
  verified?: boolean;
  trigger?: 'MANUAL' | 'SCHEDULED';
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

export type ReportType =
  | 'annual_ppa'
  | 'monthly_accomplishment'
  | 'physical_accomplishment'
  | 'financial_accomplishment'
  | 'budget_utilization'
  | 'program_level'
  | 'gad_compliance'
  | 'completed_activities'
  | 'pending_not_implemented';

export type PaperSize = 'a4' | 'letter' | 'legal';
export type PageOrientation = 'portrait' | 'landscape';
export type TemplateFormat = 'xlsx' | 'docx' | 'pdf';
export type TemplateReportTarget = ReportType | 'excel_monitoring' | 'all_reports';

export interface TemplateAnalysisSummary {
  format: TemplateFormat;
  pageCountOrSheets: number;
  sheetOrPageNames: string[];
  paperSize?: string;
  orientation?: PageOrientation;
  detectedPlaceholders: string[];
  detectedColumns: string[];
  hasRowLoopTag?: boolean;
  hasAcroFormFields?: boolean;
  acroFormFields?: string[];
  detectedHeaderRow?: number;
  detectedSignatureSection?: boolean;
  detectedLogoOrImages?: boolean;
  warnings: string[];
}

export interface DocumentTemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  notes: string;
  analysis: TemplateAnalysisSummary;
  uploadedByUid: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  format: TemplateFormat;
  targetReport: TemplateReportTarget;
  isDefault: boolean;
  isActive: boolean;
  currentVersionId: string;
  currentVersionNumber: number;
  fileName: string;
  fileSize: number;
  sha256: string;
  analysis: TemplateAnalysisSummary;
  versions: DocumentTemplateVersion[];
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface ExportValidationReport {
  valid: boolean;
  recordCount: number;
  programCount: number;
  totalApprovedBudget: number;
  totalRevisedBudget: number;
  totalExpenditure: number;
  missingOptionalFieldsCount: number;
  estimatedPages: number;
  issues: ExportValidationIssue[];
}

