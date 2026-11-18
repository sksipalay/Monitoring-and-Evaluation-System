import { z } from 'zod';

const MONTH_KEYS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

const NonNegNumber = z.number().finite().min(0).max(10_000_000_000);
const FiniteSignedNumber = z.number().finite().min(-10_000_000_000).max(10_000_000_000);

const SafeDateString = z
  .string()
  .max(32)
  .refine(
    (s) => s === '' || /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s),
    'Invalid date format (expected YYYY-MM-DD)'
  );

const MonthlyEntrySchema = z.object({
  physicalTarget: NonNegNumber,
  financialTarget: NonNegNumber,
  physicalActual: NonNegNumber,
  financialActual: NonNegNumber,
});

const MonthlyMapShape: Record<(typeof MONTH_KEYS)[number], typeof MonthlyEntrySchema> = {
  jan: MonthlyEntrySchema,
  feb: MonthlyEntrySchema,
  mar: MonthlyEntrySchema,
  apr: MonthlyEntrySchema,
  may: MonthlyEntrySchema,
  jun: MonthlyEntrySchema,
  jul: MonthlyEntrySchema,
  aug: MonthlyEntrySchema,
  sep: MonthlyEntrySchema,
  oct: MonthlyEntrySchema,
  nov: MonthlyEntrySchema,
  dec: MonthlyEntrySchema,
};

export const MonthlyMonitoringMapSchema = z.object(MonthlyMapShape);

const MonthlyPhysicalTargetMapSchema = z
  .object({
    jan: NonNegNumber.optional(),
    feb: NonNegNumber.optional(),
    mar: NonNegNumber.optional(),
    apr: NonNegNumber.optional(),
    may: NonNegNumber.optional(),
    jun: NonNegNumber.optional(),
    jul: NonNegNumber.optional(),
    aug: NonNegNumber.optional(),
    sep: NonNegNumber.optional(),
    oct: NonNegNumber.optional(),
    nov: NonNegNumber.optional(),
    dec: NonNegNumber.optional(),
  })
  .optional();

export const StatusEnum = z.enum([
  'COMPLETED',
  'ON-GOING',
  'PENDING',
  'NOT IMPLEMENTED',
]);

export const RoleEnum = z.enum(['ADMINISTRATOR', 'ENCODER', 'VIEWER']);

export const BudgetClassEnum = z.enum([
  'GF',
  'PS',
  'MOOE',
  'CO',
  'PS / MOOE',
  'MOOE / CO',
  'PS / MOOE / CO',
]);

export const IdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Record ID is required.')
    .max(120, 'Record ID is too long.')
    .regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid record identifier format.'),
});

export const BackupFileParamSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, 'Backup filename is required.')
    .max(180)
    .regex(/^[A-Za-z0-9_.-]+\.json$/, 'Invalid backup snapshot filename.'),
});

export const AuditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(50),
});

export const LoginSchema = z.object({
  userId: z.string().trim().min(1, 'Account ID is required.').max(120),
  passcode: z.string().max(128).optional().default(''),
});

export const FirebaseLoginSchema = z.object({
  idToken: z.string().min(20, 'Firebase ID token is invalid.').max(12_000),
});

export const ProgramSupplementalLogSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.enum(['ADD', 'SUBTRACT']),
  amount: NonNegNumber,
  signedAmount: FiniteSignedNumber,
  notes: z.string().max(1000).optional(),
  updatedBy: z.string().max(120),
  updatedByName: z.string().max(160),
  timestamp: z.string().max(64),
});

export const ProgramSchema = z.object({
  id: z.string().trim().min(1, 'Program ID is required.').max(120),
  fiscalYear: z.string().trim().regex(/^\d{4}$/, 'Fiscal Year must be 4 digits'),
  aipRefCode: z.string().trim().min(1, 'AIP Reference Code is required.').max(80),
  title: z.string().trim().min(1, 'Program Title is required.').max(300),
  sector: z.string().trim().max(160).default('General Public Services'),
  budget: NonNegNumber.optional().default(0),
  supplementalBudget: FiniteSignedNumber.optional().default(0),
  supplementalLogs: z.array(ProgramSupplementalLogSchema).max(500).optional(),
  physicalTarget: NonNegNumber.optional().default(0),
  monthlyPhysicalTarget: MonthlyPhysicalTargetMapSchema,
  sourceOfFund: z.string().max(160).optional().default(''),
  gadFund: z.boolean().optional().default(false),
  officeId: z.string().trim().min(1, 'Implementing Office ID is required.').max(120),
  officeName: z.string().trim().min(1, 'Implementing Office Name is required.').max(200),
  parentProgramId: z.string().max(120).nullable().optional().default(null),
  orderIndex: z.number().int().min(0).max(100_000).optional().default(0),
  createdAt: z.string().max(64).optional(),
  updatedAt: z.string().max(64).optional(),
});

export const ActivitySchema = z
  .object({
    id: z.string().trim().min(1, 'Activity ID is required.').max(120),
    programId: z.string().trim().min(1, 'Parent Program ID is required.').max(120),
    subprogramId: z.string().max(120).nullable().optional().default(null),
    fiscalYear: z.string().trim().regex(/^\d{4}$/, 'Fiscal Year must be 4 digits'),
    referenceNumber: z.string().trim().min(1, 'PPA Reference Number is required.').max(80),
    description: z.string().trim().min(1, 'PPA Description is required.').max(600),
    targetOutputs: z.string().max(600).optional().default(''),
    officeId: z.string().trim().min(1, 'Implementing Office ID is required.').max(120),
    officeName: z.string().trim().min(1, 'Implementing Office Name is required.').max(200),
    sourceOfFund: z.string().max(160).optional().default(''),
    budgetClassification: BudgetClassEnum.optional().default('GF'),
    gf: NonNegNumber.optional().default(0),
    ps: NonNegNumber.default(0),
    mooe: NonNegNumber.default(0),
    co: NonNegNumber.default(0),
    withheldAmount: NonNegNumber.default(0),
    supplementalBudget1: FiniteSignedNumber.optional().default(0),
    supplementalBudget2: FiniteSignedNumber.optional().default(0),
    supplementalBudget3: FiniteSignedNumber.optional().default(0),
    supplementalBudget4: FiniteSignedNumber.optional().default(0),
    supplementalBudget5: FiniteSignedNumber.optional().default(0),
    monthly: MonthlyMonitoringMapSchema,
    status: StatusEnum.default('PENDING'),
    remarks: z.string().max(4000).optional().default(''),
    orderIndex: z.number().int().min(0).max(100_000).optional(),
    startDate: SafeDateString.optional().default(''),
    endDate: SafeDateString.optional().default(''),
    createdBy: z.string().max(120).optional(),
    updatedBy: z.string().max(120).optional(),
    createdAt: z.string().max(64).optional(),
    updatedAt: z.string().max(64).optional(),
  })
  .superRefine((act, ctx) => {
    if (act.startDate && act.endDate && act.endDate < act.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date cannot be earlier than start date.',
      });
    }
  });

export const ReorderActivitiesSchema = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120),
        orderIndex: z.number().int().min(0).max(100_000),
      })
    )
    .min(1)
    .max(1000),
});

export const RemarkSchema = z.object({
  id: z.string().trim().min(1, 'Remark ID is required.').max(120),
  activityId: z.string().trim().min(1, 'Activity ID is required.').max(120),
  observation: z
    .string()
    .trim()
    .min(1, 'Monitoring observation cannot be empty.')
    .max(4000),
  monitoringDate: z
    .string()
    .trim()
    .min(1, 'Monitoring date is required.')
    .max(32)
    .refine(
      (s) => /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s),
      'Invalid monitoring date format (expected YYYY-MM-DD)'
    ),
  createdAt: z.string().max(64).optional(),
});

export const OfficeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(24),
  name: z.string().trim().min(1).max(160),
  headName: z.string().trim().max(140).optional().default('Department Head'),
  createdAt: z.string().max(64).optional(),
});

export const FiscalYearSchema = z.object({
  id: z.string().trim().min(1).max(60),
  year: z.string().trim().regex(/^\d{4}$/, 'Year must be a 4-digit number'),
  label: z.string().trim().min(1).max(40),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  createdAt: z.string().max(64).optional(),
});

export const UserSchema = z.object({
  id: z.string().trim().min(1).max(120),
  uid: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(160),
  displayName: z.string().trim().min(1).max(160),
  role: RoleEnum,
  officeId: z.string().trim().min(1).max(120),
  officeName: z.string().trim().min(1).max(200),
  position: z.string().trim().max(160).optional().default('Monitoring Personnel'),
  passcode: z.string().max(128).optional(),
  clearPasscode: z.boolean().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string().max(64).optional(),
  updatedAt: z.string().max(64).optional(),
});

export const SystemSettingsSchema = z.object({
  appName: z.string().trim().min(1).max(140).optional(),
  appLogoDataUrl: z.string().max(3_200_000).optional(),
  municipalityName: z.string().trim().min(1).max(160),
  provinceName: z.string().trim().min(1).max(160),
  officeTitle: z.string().trim().min(1).max(200),
  defaultFiscalYear: z.string().trim().regex(/^\d{4}$/),
  preparedByName: z.string().trim().max(160),
  preparedByTitle: z.string().trim().max(160),
  reviewedByName: z.string().trim().max(160),
  reviewedByTitle: z.string().trim().max(160),
  approvedByName: z.string().trim().max(160),
  approvedByTitle: z.string().trim().max(160),
  firebaseWebConfigJson: z.string().max(8000).optional().default(''),
  theme: z.enum(['light', 'dark']).optional(),
});

export const UploadedDocumentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(260),
  fileSize: z.number().int().min(0).max(50_000_000),
  fiscalYear: z.string().trim().regex(/^\d{4}$/),
  recordsImported: z.number().int().min(0).max(100_000),
  uploadedByUid: z.string().max(120).optional(),
  uploadedByName: z.string().max(160).optional(),
  uploadedAt: z.string().max(64).optional(),
  notes: z.string().max(1000).optional().default(''),
});

export const ImportBatchSchema = z.object({
  newPrograms: z.array(ProgramSchema).max(500).default([]),
  newActivities: z.array(ActivitySchema).max(1500).default([]),
  updatedActivities: z.array(ActivitySchema).max(1500).default([]),
  newOffices: z.array(OfficeSchema).max(200).optional().default([]),
  uploadedDocument: UploadedDocumentSchema,
});

export const ClientAuditLogSchema = z.object({
  action: z.enum(['EXPORT']),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().trim().max(120).default(''),
  summary: z.string().trim().min(1).max(500),
  details: z.string().max(1000).optional().default(''),
});

export const ProgramRequestSchema = z.object({ program: ProgramSchema });
export const ActivityRequestSchema = z.object({ activity: ActivitySchema });
export const RemarkRequestSchema = z.object({ remark: RemarkSchema });
export const OfficeRequestSchema = z.object({ office: OfficeSchema });
export const FiscalYearRequestSchema = z.object({ fiscalYear: FiscalYearSchema });
export const UserRequestSchema = z.object({ user: UserSchema });
export const SettingsRequestSchema = z.object({ settings: SystemSettingsSchema });

export const RestoreBackupSchema = z.object({
  snapshot: z.object({
    offices: z.array(OfficeSchema).min(1).max(500),
    users: z.array(
      z.object({
        id: z.string().trim().min(1).max(120),
        uid: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(160),
        displayName: z.string().trim().min(1).max(160),
        role: RoleEnum,
        officeId: z.string().trim().min(1).max(120),
        officeName: z.string().trim().min(1).max(200),
        position: z.string().trim().max(160),
        passcodeHash: z.string().max(500).nullable().optional(),
        passcode: z.string().max(128).nullable().optional(),
        isActive: z.boolean(),
        createdAt: z.string().max(64),
        updatedAt: z.string().max(64),
      })
    ).min(1).max(2000),
    fiscalYears: z.array(FiscalYearSchema).min(1).max(100),
    programs: z.array(ProgramSchema).max(5000),
    activities: z.array(ActivitySchema).max(20_000),
    remarksLogs: z.array(
      z.object({
        id: z.string().trim().min(1).max(120),
        activityId: z.string().trim().min(1).max(120),
        authorUid: z.string().max(120),
        authorName: z.string().max(160),
        authorRole: RoleEnum,
        observation: z.string().max(4000),
        monitoringDate: SafeDateString,
        createdAt: z.string().max(64),
      })
    ).max(50_000).default([]),
    uploadedDocuments: z.array(UploadedDocumentSchema).max(5000).default([]),
    settings: SystemSettingsSchema,
  }),
});
