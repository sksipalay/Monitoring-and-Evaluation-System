import {
  Activity,
  FiscalYear,
  Office,
  Program,
  SystemSettings,
  UserAccount,
} from '../types/ppa';
import { createEmptyMonthlyData } from './calculations';

export const DEFAULT_OFFICES: Office[] = [
  {
    id: 'off-mpdo',
    code: 'MPDO',
    name: 'Municipal Planning and Development Office',
    headName: 'EnP. Municipal Planning Coordinator',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-mayor',
    code: 'OM',
    name: 'Office of the Municipal Mayor',
    headName: 'Hon. Municipal Mayor',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-meo',
    code: 'MEO',
    name: 'Municipal Engineering Office',
    headName: 'Engr. Municipal Engineer',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-mao',
    code: 'MAO',
    name: 'Municipal Agriculture Office',
    headName: 'Municipal Agriculturist',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-mswdo',
    code: 'MSWDO',
    name: 'Municipal Social Welfare and Development Office',
    headName: 'MSWDO Officer',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-mho',
    code: 'MHO',
    name: 'Municipal Health Office',
    headName: 'Municipal Health Officer',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-mdrrmo',
    code: 'MDRRMO',
    name: 'Municipal Disaster Risk Reduction and Management Office',
    headName: 'LDRRMO III',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-menro',
    code: 'MENRO',
    name: 'Municipal Environment and Natural Resources Office',
    headName: 'MENRO Designate',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-mbo',
    code: 'MBO',
    name: 'Municipal Budget Office',
    headName: 'Municipal Budget Officer',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'off-mto',
    code: 'MTO',
    name: 'Municipal Treasurer Office',
    headName: 'Municipal Treasurer',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export const DEFAULT_FISCAL_YEARS: FiscalYear[] = [
  {
    id: 'fy-2025',
    year: '2025',
    label: 'FY 2025',
    isActive: true,
    isDefault: false,
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'fy-2026',
    year: '2026',
    label: 'FY 2026',
    isActive: true,
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export function buildOfficeEncoderAccount(
  office: Office,
  existingUsers: UserAccount[]
): UserAccount {
  const slug =
    office.code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'office';
  const emailSlug = slug.replace(/-/g, '') || 'office';

  let candidateEmail = `${emailSlug}@municipalityofbula.gov.ph`;
  let suffix = 2;
  const usedEmails = new Set(existingUsers.map((u) => u.email.toLowerCase()));
  while (usedEmails.has(candidateEmail.toLowerCase())) {
    candidateEmail = `${emailSlug}${suffix}@municipalityofbula.gov.ph`;
    suffix += 1;
  }

  let candidateId = `usr-office-${slug}`;
  const usedIds = new Set(existingUsers.map((u) => u.id));
  if (usedIds.has(candidateId)) {
    candidateId = `usr-office-${slug}-${Date.now().toString(36)}`;
  }

  const now = new Date().toISOString();
  return {
    id: candidateId,
    uid: candidateId,
    email: candidateEmail,
    displayName: `${office.code} Monitoring Account`,
    role: 'ENCODER',
    officeId: office.id,
    officeName: office.name,
    position: `${office.code} Monitoring Focal Person`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function ensureAllOfficeAccounts(
  offices: Office[],
  users: UserAccount[]
): { users: UserAccount[]; created: UserAccount[] } {
  const nextUsers = [...users];
  const created: UserAccount[] = [];

  for (const office of offices) {
    const hasEncoderForOffice = nextUsers.some(
      (u) =>
        u.officeId === office.id &&
        (u.role === 'ENCODER' || (office.id === 'off-mpdo' && u.role === 'ADMINISTRATOR'))
    );
    if (!hasEncoderForOffice) {
      const account = buildOfficeEncoderAccount(office, nextUsers);
      nextUsers.push(account);
      created.push(account);
    }
  }

  return { users: nextUsers, created };
}

const BASE_DEFAULT_USERS: UserAccount[] = [
  {
    id: 'usr-admin-bula',
    uid: 'usr-admin-bula',
    email: 'stephenkent.sipalay@municipalityofbula.gov.ph',
    displayName: 'Stephen Kent Sipalay (MPDO Admin)',
    role: 'ADMINISTRATOR',
    officeId: 'off-mpdo',
    officeName: 'Municipal Planning and Development Office',
    position: 'MPDO System Administrator',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'usr-encoder-bula',
    uid: 'usr-encoder-bula',
    email: 'planning.encoder@municipalityofbula.gov.ph',
    displayName: 'MPDO Monitoring Account',
    role: 'ENCODER',
    officeId: 'off-mpdo',
    officeName: 'Municipal Planning and Development Office',
    position: 'Planning Officer II',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'usr-viewer-bula',
    uid: 'usr-viewer-bula',
    email: 'executive.viewer@municipalityofbula.gov.ph',
    displayName: 'Hon. Office Reviewer (Read-Only)',
    role: 'VIEWER',
    officeId: 'off-mayor',
    officeName: 'Office of the Municipal Mayor',
    position: 'Executive Reviewer',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export const DEFAULT_USERS: UserAccount[] = ensureAllOfficeAccounts(
  DEFAULT_OFFICES,
  BASE_DEFAULT_USERS
).users;

export const DEFAULT_APP_NAME = 'LGU Bula Program Project and Activity Monitoring System';

export const DEFAULT_SETTINGS: SystemSettings = {
  appName: DEFAULT_APP_NAME,
  appLogoDataUrl: '',
  municipalityName: 'Municipality of Bula',
  provinceName: 'Province of Camarines Sur',
  officeTitle: 'Municipal Planning and Development Office (MPDO)',
  defaultFiscalYear: '2026',
  preparedByName: 'Stephen Kent Sipalay',
  preparedByTitle: 'Planning Officer / MPDO Monitoring Lead',
  reviewedByName: 'Municipal Planning & Dev. Coordinator',
  reviewedByTitle: 'MPDC, LGU Bula',
  approvedByName: 'Hon. Municipal Mayor',
  approvedByTitle: 'Local Chief Executive, Municipality of Bula',
  firebaseWebConfigJson: '',
  theme: 'light',
};

export function buildSampleLGUBulaDataset(): {
  programs: Program[];
  activities: Activity[];
} {
  const now = new Date().toISOString();

  const programs: Program[] = [
    {
      id: 'prog-1000',
      fiscalYear: '2026',
      aipRefCode: '1000-001',
      title: 'General Public Services & Governance Modernization Program',
      sector: 'General Public Services',
      budget: 3700000,
      sourceOfFund: 'General Fund',
      officeId: 'off-mpdo',
      officeName: 'Municipal Planning and Development Office',
      parentProgramId: null,
      orderIndex: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prog-3000-health',
      fiscalYear: '2026',
      aipRefCode: '3000-001',
      title: 'Municipal Health & Nutrition Services Enhancement Program',
      sector: 'Social Services',
      budget: 1650000,
      sourceOfFund: 'General Fund',
      officeId: 'off-mho',
      officeName: 'Municipal Health Office',
      parentProgramId: null,
      orderIndex: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prog-3000-social',
      fiscalYear: '2026',
      aipRefCode: '3000-002',
      title: 'Social Welfare & Community Protection Program',
      sector: 'Social Services',
      budget: 2250000,
      sourceOfFund: '20% Local Development Fund (LDF)',
      officeId: 'off-mswdo',
      officeName: 'Municipal Social Welfare and Development Office',
      parentProgramId: null,
      orderIndex: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prog-8000-agri',
      fiscalYear: '2026',
      aipRefCode: '8000-001',
      title: 'Agricultural Productivity & Farm-to-Market Infrastructure Program',
      sector: 'Economic Services',
      budget: 2400000,
      sourceOfFund: '20% Local Development Fund (LDF)',
      officeId: 'off-mao',
      officeName: 'Municipal Agriculture Office',
      parentProgramId: null,
      orderIndex: 4,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prog-9000-drrm',
      fiscalYear: '2026',
      aipRefCode: '9000-001',
      title: 'Local Disaster Risk Reduction and Climate Resilience Program',
      sector: 'Other Services',
      budget: 770000,
      sourceOfFund: '5% LDRRMF',
      officeId: 'off-mdrrmo',
      officeName: 'Municipal Disaster Risk Reduction and Management Office',
      parentProgramId: null,
      orderIndex: 5,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const m1 = createEmptyMonthlyData();
  m1.jan = { physicalTarget: 1, financialTarget: 150000, physicalActual: 1, financialActual: 148500 };
  m1.feb = { physicalTarget: 1, financialTarget: 150000, physicalActual: 1, financialActual: 150000 };
  m1.mar = { physicalTarget: 2, financialTarget: 300000, physicalActual: 2, financialActual: 295000 };
  m1.apr = { physicalTarget: 1, financialTarget: 200000, physicalActual: 1, financialActual: 198000 };
  m1.may = { physicalTarget: 1, financialTarget: 200000, physicalActual: 1, financialActual: 200000 };
  m1.jun = { physicalTarget: 2, financialTarget: 250000, physicalActual: 2, financialActual: 245000 };

  const m2 = createEmptyMonthlyData();
  m2.feb = { physicalTarget: 1, financialTarget: 400000, physicalActual: 1, financialActual: 390000 };
  m2.apr = { physicalTarget: 1, financialTarget: 450000, physicalActual: 1, financialActual: 445000 };
  m2.jun = { physicalTarget: 1, financialTarget: 500000, physicalActual: 1, financialActual: 480000 };
  m2.aug = { physicalTarget: 1, financialTarget: 450000, physicalActual: 0.5, financialActual: 210000 };
  m2.oct = { physicalTarget: 1, financialTarget: 400000, physicalActual: 0, financialActual: 0 };

  const m3 = createEmptyMonthlyData();
  m3.jan = { physicalTarget: 500, financialTarget: 250000, physicalActual: 500, financialActual: 248000 };
  m3.mar = { physicalTarget: 500, financialTarget: 250000, physicalActual: 520, financialActual: 250000 };
  m3.may = { physicalTarget: 500, financialTarget: 250000, physicalActual: 480, financialActual: 241000 };
  m3.jul = { physicalTarget: 500, financialTarget: 250000, physicalActual: 500, financialActual: 249500 };
  m3.sep = { physicalTarget: 500, financialTarget: 250000, physicalActual: 460, financialActual: 230000 };
  m3.nov = { physicalTarget: 500, financialTarget: 250000, physicalActual: 0, financialActual: 0 };

  const m4 = createEmptyMonthlyData();
  m4.mar = { physicalTarget: 1, financialTarget: 1200000, physicalActual: 0, financialActual: 0 };
  m4.jun = { physicalTarget: 1, financialTarget: 1300000, physicalActual: 0, financialActual: 0 };

  const m5 = createEmptyMonthlyData();
  m5.feb = { physicalTarget: 150, financialTarget: 300000, physicalActual: 150, financialActual: 298500 };
  m5.apr = { physicalTarget: 150, financialTarget: 300000, physicalActual: 150, financialActual: 299000 };
  m5.jun = { physicalTarget: 150, financialTarget: 300000, physicalActual: 150, financialActual: 300000 };
  m5.aug = { physicalTarget: 150, financialTarget: 300000, physicalActual: 150, financialActual: 295000 };

  const m6 = createEmptyMonthlyData();
  m6.may = { physicalTarget: 2, financialTarget: 600000, physicalActual: 0, financialActual: 0 };
  m6.sep = { physicalTarget: 2, financialTarget: 600000, physicalActual: 0, financialActual: 0 };

  const m7 = createEmptyMonthlyData();
  m7.jan = { physicalTarget: 2, financialTarget: 180000, physicalActual: 2, financialActual: 175000 };
  m7.apr = { physicalTarget: 2, financialTarget: 180000, physicalActual: 2, financialActual: 179000 };
  m7.jul = { physicalTarget: 2, financialTarget: 180000, physicalActual: 1, financialActual: 95000 };
  m7.oct = { physicalTarget: 2, financialTarget: 180000, physicalActual: 0, financialActual: 0 };

  const activities: Activity[] = [
    {
      id: 'act-1000-01',
      programId: 'prog-1000',
      subprogramId: null,
      fiscalYear: '2026',
      referenceNumber: '1000-001-01',
      description: 'Digitization of Municipal Planning Records & GIS Updating',
      targetOutputs: '8 Barangay GIS & CBMS Datasets Updated',
      officeId: 'off-mpdo',
      officeName: 'Municipal Planning and Development Office',
      budgetClassification: 'MOOE / CO',
      ps: 450000,
      mooe: 500000,
      co: 300000,
      withheldAmount: 0,
      supplementalBudget1: 100000,
      supplementalBudget2: 0,
      supplementalBudget3: 0,
      supplementalBudget4: 0,
      supplementalBudget5: 0,
      monthly: m1,
      status: 'COMPLETED',
      remarks: 'All 8 target datasets completed and validated by MPDO.',
      createdBy: 'usr-admin-bula',
      updatedBy: 'usr-admin-bula',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'act-1000-02',
      programId: 'prog-1000',
      subprogramId: null,
      fiscalYear: '2026',
      referenceNumber: '1000-001-02',
      description: 'Rehabilitation & Upgrading of Municipal Hall Public Service Wing',
      targetOutputs: '5 Service Counters Renovated & Accessible',
      officeId: 'off-meo',
      officeName: 'Municipal Engineering Office',
      budgetClassification: 'CO',
      ps: 0,
      mooe: 200000,
      co: 2000000,
      withheldAmount: 100000,
      supplementalBudget1: 0,
      supplementalBudget2: 250000,
      supplementalBudget3: 0,
      supplementalBudget4: 0,
      supplementalBudget5: 0,
      monthly: m2,
      status: 'ON-GOING',
      remarks: 'Phase 4 structural finishing currently underway; 100K reserve withheld.',
      createdBy: 'usr-admin-bula',
      updatedBy: 'usr-admin-bula',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'act-3000-01',
      programId: 'prog-3000-health',
      subprogramId: null,
      fiscalYear: '2026',
      referenceNumber: '3000-001-01',
      description: 'Maternal, Infant & Barangay Immunization Medical Outreach',
      targetOutputs: '3,000 Beneficiaries Served Across 33 Barangays',
      officeId: 'off-mho',
      officeName: 'Municipal Health Office',
      budgetClassification: 'PS / MOOE',
      ps: 600000,
      mooe: 900000,
      co: 0,
      withheldAmount: 0,
      supplementalBudget1: 150000,
      supplementalBudget2: 0,
      supplementalBudget3: 0,
      supplementalBudget4: 0,
      supplementalBudget5: 0,
      monthly: m3,
      status: 'ON-GOING',
      remarks: 'Q1-Q3 barangay outreach waves completed; Nov schedule prepared.',
      createdBy: 'usr-admin-bula',
      updatedBy: 'usr-admin-bula',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'act-3000-02',
      programId: 'prog-3000-social',
      subprogramId: null,
      fiscalYear: '2026',
      referenceNumber: '3000-002-01',
      description: 'Construction of Senior Citizens & PWD Multi-Purpose Center',
      targetOutputs: '2 Building Phases Completed',
      officeId: 'off-mswdo',
      officeName: 'Municipal Social Welfare and Development Office',
      budgetClassification: 'CO',
      ps: 0,
      mooe: 100000,
      co: 2400000,
      withheldAmount: 250000,
      supplementalBudget1: 0,
      supplementalBudget2: 0,
      supplementalBudget3: 0,
      supplementalBudget4: 0,
      supplementalBudget5: 0,
      monthly: m4,
      status: 'PENDING',
      remarks: 'Awaiting BAC notice of award and site clearance.',
      createdBy: 'usr-admin-bula',
      updatedBy: 'usr-admin-bula',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'act-8000-01',
      programId: 'prog-8000-agri',
      subprogramId: null,
      fiscalYear: '2026',
      referenceNumber: '8000-001-01',
      description: 'Certified Rice Seed & Organic Fertilizer Subsidy Distribution',
      targetOutputs: '600 Local Farmers Assisted',
      officeId: 'off-mao',
      officeName: 'Municipal Agriculture Office',
      budgetClassification: 'MOOE',
      ps: 0,
      mooe: 1200000,
      co: 0,
      withheldAmount: 0,
      supplementalBudget1: 0,
      supplementalBudget2: 0,
      supplementalBudget3: 0,
      supplementalBudget4: 0,
      supplementalBudget5: 0,
      monthly: m5,
      status: 'COMPLETED',
      remarks: 'Full wet and dry season distribution accomplished.',
      createdBy: 'usr-admin-bula',
      updatedBy: 'usr-admin-bula',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'act-8000-02',
      programId: 'prog-8000-agri',
      subprogramId: null,
      fiscalYear: '2026',
      referenceNumber: '8000-001-02',
      description: 'Concreting of Barangay San Ramon – Fabrica Farm-to-Market Road',
      targetOutputs: '4 Road Segments (1.6 km Total)',
      officeId: 'off-meo',
      officeName: 'Municipal Engineering Office',
      budgetClassification: 'CO',
      ps: 0,
      mooe: 0,
      co: 1200000,
      withheldAmount: 0,
      supplementalBudget1: 0,
      supplementalBudget2: 0,
      supplementalBudget3: 0,
      supplementalBudget4: 0,
      supplementalBudget5: 0,
      monthly: m6,
      status: 'NOT IMPLEMENTED',
      remarks: 'Deferred pending right-of-way documentation from barangay council.',
      createdBy: 'usr-admin-bula',
      updatedBy: 'usr-admin-bula',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'act-9000-01',
      programId: 'prog-9000-drrm',
      subprogramId: null,
      fiscalYear: '2026',
      referenceNumber: '9000-001-01',
      description: 'Early Warning Flood Monitoring & Barangay Rescue Equipment Rollout',
      targetOutputs: '8 Flood-Prone Barangays Equipped & Trained',
      officeId: 'off-mdrrmo',
      officeName: 'Municipal Disaster Risk Reduction and Management Office',
      budgetClassification: 'MOOE / CO',
      ps: 120000,
      mooe: 240000,
      co: 360000,
      withheldAmount: 0,
      supplementalBudget1: 50000,
      supplementalBudget2: 0,
      supplementalBudget3: 0,
      supplementalBudget4: 0,
      supplementalBudget5: 0,
      monthly: m7,
      status: 'ON-GOING',
      remarks: '5 of 8 barangays completed; final batch scheduled Q4.',
      createdBy: 'usr-admin-bula',
      updatedBy: 'usr-admin-bula',
      createdAt: now,
      updatedAt: now,
    },
  ];

  return { programs, activities };
}
