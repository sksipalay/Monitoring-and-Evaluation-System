import type { SidebarModule, UserAccount, UserRole } from '../types/ppa';

export const ALL_USER_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'ADMINISTRATOR',
  'OFFICE_HEAD',
  'ENCODER',
  'EVALUATOR',
  'VIEWER',
];

export const ALL_SIDEBAR_MODULES: SidebarModule[] = [
  'dashboard',
  'programs',
  'budget',
  'gad',
  'status',
  'evaluation',
  'reports',
  'excel',
  'users',
  'settings',
];

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Administrator',
  ADMINISTRATOR: 'Administrator (MPDO)',
  OFFICE_HEAD: 'Office Head',
  ENCODER: 'Office Encoder',
  EVALUATOR: 'M&E Evaluator',
  VIEWER: 'Viewer (Read-Only)',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN:
    'Highest authority: Full municipality-wide control, administrator management, security & privacy policy, backups, and immutable audit oversight.',
  ADMINISTRATOR:
    'MPDO System Administrator: Full access to all offices, PPAs, budgets, Excel imports, personnel management, and system settings.',
  OFFICE_HEAD:
    'Department / Office Head: Manages and reviews PPAs, budgets, monthly targets/actuals, statuses, and M&E observations for their assigned office.',
  ENCODER:
    'Office Monitoring Encoder: Creates and updates Programs, Activities, monthly accomplishments, and observations strictly for their assigned office.',
  EVALUATOR:
    'Monitoring & Evaluation Officer: Reviews PPAs across all offices, records field observations, and updates M&E remarks/status without deleting structural budgets.',
  VIEWER:
    'Executive / Read-Only Reviewer: Views dashboards, PPA registries, budgets, GAD summaries, and exports reports without editing records.',
};

export function getDefaultModulesForRole(role: UserRole): SidebarModule[] {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMINISTRATOR':
      return [...ALL_SIDEBAR_MODULES];
    case 'OFFICE_HEAD':
    case 'ENCODER':
      return ['dashboard', 'programs', 'budget', 'gad', 'status', 'evaluation', 'reports', 'excel'];
    case 'EVALUATOR':
      return ['dashboard', 'programs', 'budget', 'gad', 'status', 'evaluation', 'reports'];
    case 'VIEWER':
    default:
      return ['dashboard', 'programs', 'budget', 'gad', 'status', 'evaluation', 'reports'];
  }
}

export function getEffectiveModules(user: Pick<UserAccount, 'role' | 'allowedModules'> | null | undefined): SidebarModule[] {
  if (!user) return [];
  if (user.role === 'SUPER_ADMIN') {
    return [...ALL_SIDEBAR_MODULES];
  }
  if (Array.isArray(user.allowedModules) && user.allowedModules.length > 0) {
    const valid = user.allowedModules.filter((m): m is SidebarModule =>
      ALL_SIDEBAR_MODULES.includes(m)
    );
    if (valid.length > 0) {
      if (!valid.includes('dashboard')) {
        return ['dashboard', ...valid];
      }
      return valid;
    }
  }
  return getDefaultModulesForRole(user.role);
}

export function hasModuleAccess(
  user: Pick<UserAccount, 'role' | 'allowedModules'> | null | undefined,
  module: SidebarModule
): boolean {
  if (!user) return false;
  return getEffectiveModules(user).includes(module);
}

export function isAdminRole(role?: UserRole | null): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMINISTRATOR';
}

export function isOfficeScopedRole(role?: UserRole | null): boolean {
  return role === 'ENCODER' || role === 'OFFICE_HEAD';
}

export function canEditPpaStructure(role?: UserRole | null): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'ADMINISTRATOR' ||
    role === 'OFFICE_HEAD' ||
    role === 'ENCODER'
  );
}

export function canEditStatusOrRemarks(role?: UserRole | null): boolean {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'ADMINISTRATOR' ||
    role === 'OFFICE_HEAD' ||
    role === 'ENCODER' ||
    role === 'EVALUATOR'
  );
}

export function canAddEvaluationRemarks(role?: UserRole | null): boolean {
  return canEditStatusOrRemarks(role);
}
