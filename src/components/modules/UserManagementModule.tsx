import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Globe,
  History,
  KeyRound,
  Laptop,
  Lock,
  MapPin,
  Network,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import {
  ActiveSessionsOverview,
  AdminActiveSession,
  ApprovalStatus,
  AuditIntegrityResult,
  AuditLog,
  Office,
  SessionNetworkScope,
  SidebarModule,
  UserAccount,
  UserRole,
} from '../../types/ppa';
import { buildAuditLog, dataService } from '../../services/dataService';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { buildCsvBlob, sanitizeCsvFileSegment } from '../../utils/csvExport';
import { triggerBlobDownload } from '../../utils/excelService';
import {
  ALL_SIDEBAR_MODULES,
  ALL_USER_ROLES,
  ROLE_LABELS,
  getDefaultModulesForRole,
  getEffectiveModules,
  isAdminRole,
  isOfficeScopedRole,
} from '../../utils/rbac';

interface UserManagementModuleProps {
  users: UserAccount[];
  offices: Office[];
  auditLogs: AuditLog[];
  currentUser: UserAccount;
  onCreateUser: (u: UserAccount) => Promise<void>;
  onUpdateUser: (u: UserAccount) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
  onProvisionOfficeAccounts: () => Promise<void>;
  onUserUpdated?: (user: UserAccount, auditLog?: AuditLog) => void;
  onNotify?: (type: 'success' | 'error', msg: string) => void;
}

const MODULE_LABELS: Record<SidebarModule, string> = {
  dashboard: 'Dashboard',
  programs: 'Programs & Activities',
  budget: 'Budget Management',
  gad: 'GAD Fund Summary',
  status: 'Accomplishment Status',
  evaluation: 'M&E Observations',
  reports: 'Reports & Printouts',
  excel: 'Excel Import/Export',
  users: 'User Management',
  settings: 'System Settings',
};

function validateClientPassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return 'Password must include at least one letter and one number.';
  }
  return null;
}

const SCOPE_COLORS: Record<SessionNetworkScope, { bar: string; badge: string }> = {
  PUBLIC: {
    bar: 'bg-[#2563EB] dark:bg-sky-400',
    badge: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
  },
  PRIVATE: {
    bar: 'bg-[#0D9488] dark:bg-teal-400',
    badge: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800',
  },
  LOCAL: {
    bar: 'bg-slate-600 dark:bg-slate-400',
    badge: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  },
  UNKNOWN: {
    bar: 'bg-amber-500 dark:bg-amber-400',
    badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
  },
};

function summarizeDeviceAgent(ua: string): string {
  if (!ua) return 'Unknown client';
  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/curl|node|undici/i.test(ua)) browser = 'CLI / API Client';

  let os = '';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}

export function UserManagementModule({
  users,
  offices,
  auditLogs,
  currentUser,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onProvisionOfficeAccounts,
  onUserUpdated,
  onNotify,
}: UserManagementModuleProps) {
  const isAdmin = isAdminRole(currentUser.role);
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const [activeTab, setActiveTab] = useState<'users' | 'sessions' | 'audit'>('users');
  const [officeFilter, setOfficeFilter] = useState('ALL');
  const [approvalFilter, setApprovalFilter] = useState<'ALL' | ApprovalStatus>('ALL');

  const [sessionsOverview, setSessionsOverview] = useState<ActiveSessionsOverview | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  // Server-paginated audit log state
  const [auditSearch, setAuditSearch] = useState('');
  const [auditSearchInput, setAuditSearchInput] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');
  const [auditUserFilter, setAuditUserFilter] = useState('ALL');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageData, setAuditPageData] = useState<{
    rows: AuditLog[];
    total: number;
    totalPages: number;
    loading: boolean;
  }>({
    rows: auditLogs.slice(0, 25),
    total: auditLogs.length,
    totalPages: 1,
    loading: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    role: 'ENCODER' as UserRole,
    officeId: offices[0]?.id || '',
    position: '',
    password: '',
    isActive: true,
    approvalStatus: 'APPROVED' as ApprovalStatus,
    mustChangePassword: true,
    allowedModules: getDefaultModulesForRole('ENCODER'),
  });
  const [confirmDelete, setConfirmDelete] = useState<UserAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [issuedTokenModal, setIssuedTokenModal] = useState<{
    user: UserAccount;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [verifyingChain, setVerifyingChain] = useState(false);
  const [exportingAuditCsv, setExportingAuditCsv] = useState(false);
  const [chainIntegrity, setChainIntegrity] = useState<AuditIntegrityResult | null>(null);
  const [expandedDiffIds, setExpandedDiffIds] = useState<Record<string, boolean>>({});
  const modalRef = useModalFocusTrap<HTMLDivElement>(modalOpen, () => setModalOpen(false));
  const tokenModalRef = useModalFocusTrap<HTMLDivElement>(
    Boolean(issuedTokenModal),
    () => setIssuedTokenModal(null)
  );

  const pendingCount = useMemo(
    () => users.filter((u) => u.approvalStatus === 'PENDING').length,
    [users]
  );

  const missingOfficeCount = useMemo(
    () =>
      offices.filter(
        (o) =>
          !users.some(
            (u) =>
              u.officeId === o.id &&
              (isOfficeScopedRole(u.role) || (o.id === 'off-mpdo' && isAdminRole(u.role)))
          )
      ).length,
    [offices, users]
  );

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => {
        if (officeFilter !== 'ALL' && u.officeId !== officeFilter) return false;
        if (approvalFilter !== 'ALL' && (u.approvalStatus || 'APPROVED') !== approvalFilter) {
          return false;
        }
        return true;
      }),
    [users, officeFilter, approvalFilter]
  );

  const auditUserOptions = useMemo(() => {
    const map = new Map<string, { uid: string; label: string }>();
    for (const u of users) {
      map.set(u.uid, {
        uid: u.uid,
        label: `${u.displayName} (${u.email})`,
      });
    }
    for (const log of [...auditLogs, ...auditPageData.rows]) {
      if (log.userUid && !map.has(log.userUid)) {
        map.set(log.userUid, {
          uid: log.userUid,
          label: log.userName ? `${log.userName} (${log.userEmail || log.userUid})` : log.userUid,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [users, auditLogs, auditPageData.rows]);

  const hasActiveAuditFilters =
    Boolean(auditSearch.trim()) ||
    auditActionFilter !== 'ALL' ||
    auditUserFilter !== 'ALL' ||
    Boolean(auditDateFrom) ||
    Boolean(auditDateTo);

  const fetchPaginatedAudits = useCallback(async () => {
    if (!isAdmin) return;
    setAuditPageData((prev) => ({ ...prev, loading: true }));
    try {
      const res = await dataService.getAuditLogsPaginated({
        page: auditPage,
        pageSize: 25,
        action: auditActionFilter,
        search: auditSearch,
        userUid: auditUserFilter,
        dateFrom: auditDateFrom,
        dateTo: auditDateTo,
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      });
      setAuditPageData({
        rows: res.auditLogs,
        total: res.total,
        totalPages: Math.max(1, res.totalPages),
        loading: false,
      });
    } catch {
      setAuditPageData((prev) => ({ ...prev, loading: false }));
    }
  }, [
    isAdmin,
    auditPage,
    auditActionFilter,
    auditSearch,
    auditUserFilter,
    auditDateFrom,
    auditDateTo,
  ]);

  const fetchSessionsOverview = useCallback(async () => {
    if (!isAdmin) return;
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const overview = await dataService.getActiveSessionsOverview();
      setSessionsOverview(overview);
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : 'Unable to load active session geographic overview.'
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab === 'audit') {
      void fetchPaginatedAudits();
    } else if (activeTab === 'sessions') {
      void fetchSessionsOverview();
    }
  }, [activeTab, fetchPaginatedAudits, fetchSessionsOverview, auditLogs.length]);

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          <Shield className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-[18px] font-semibold text-slate-900 dark:text-slate-100">
          Administrator Access Required
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Only Super Administrators and MPDO System Administrators can manage user accounts, permissions, and audit logs.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(null);
    setFormError(null);
    setForm({
      displayName: '',
      email: '',
      role: 'ENCODER',
      officeId: offices[0]?.id || '',
      position: '',
      password: '',
      isActive: true,
      approvalStatus: 'APPROVED',
      mustChangePassword: true,
      allowedModules: getDefaultModulesForRole('ENCODER'),
    });
    setModalOpen(true);
  };

  const openEdit = (u: UserAccount) => {
    if (u.role === 'SUPER_ADMIN' && !isSuperAdmin) {
      onNotify?.('error', 'Only a Super Administrator can edit Super Administrator accounts.');
      return;
    }
    setEditing(u);
    setFormError(null);
    setForm({
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      officeId: u.officeId,
      position: u.position,
      password: '',
      isActive: u.isActive,
      approvalStatus: u.approvalStatus || 'APPROVED',
      mustChangePassword: Boolean(u.mustChangePassword),
      allowedModules: getEffectiveModules(u),
    });
    setModalOpen(true);
  };

  const handleToggleModule = (mod: SidebarModule) => {
    if (mod === 'dashboard') return; // dashboard always required
    setForm((prev) => {
      const exists = prev.allowedModules.includes(mod);
      const next = exists
        ? prev.allowedModules.filter((m) => m !== mod)
        : [...prev.allowedModules, mod];
      return { ...prev, allowedModules: next };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.displayName.trim() || !form.email.trim()) {
      setFormError('Full name and email address are required.');
      return;
    }
    const trimmedPassword = form.password.trim();
    if (!editing && !trimmedPassword) {
      setFormError('A password (8+ chars, letters & numbers) is required for new accounts.');
      return;
    }
    if (trimmedPassword) {
      const pwErr = validateClientPassword(trimmedPassword);
      if (pwErr) {
        setFormError(pwErr);
        return;
      }
    }

    setSaving(true);
    try {
      const off = offices.find((o) => o.id === form.officeId);
      const now = new Date().toISOString();
      const modules = form.allowedModules.includes('dashboard')
        ? form.allowedModules
        : (['dashboard', ...form.allowedModules] as SidebarModule[]);

      if (editing) {
        await onUpdateUser({
          ...editing,
          displayName: form.displayName.trim(),
          email: form.email.trim(),
          role: form.role,
          officeId: off?.id || form.officeId,
          officeName: off?.name || editing.officeName,
          position: form.position.trim(),
          passcode: trimmedPassword || undefined,
          isActive: form.isActive,
          approvalStatus: form.approvalStatus,
          mustChangePassword: form.mustChangePassword,
          allowedModules: modules,
          updatedAt: now,
        });
      } else {
        const uid = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await onCreateUser({
          id: uid,
          uid,
          displayName: form.displayName.trim(),
          email: form.email.trim(),
          role: form.role,
          officeId: off?.id || '',
          officeName: off?.name || 'MPDO',
          position: form.position.trim() || 'Monitoring Personnel',
          passcode: trimmedPassword,
          isActive: form.isActive,
          approvalStatus: form.approvalStatus,
          mustChangePassword: form.mustChangePassword,
          allowedModules: modules,
          createdAt: now,
          updatedAt: now,
        });
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save user account.');
    } finally {
      setSaving(false);
    }
  };

  const handleApprovalDecision = async (user: UserAccount, decision: 'APPROVED' | 'REJECTED') => {
    setBusyUserId(user.id);
    try {
      const res = await dataService.approveUser(user.id, {
        approvalStatus: decision,
        isActive: decision === 'APPROVED',
      });
      onUserUpdated?.(res.user, res.auditLog);
      onNotify?.(
        'success',
        decision === 'APPROVED'
          ? `Approved registration for "${user.displayName}".`
          : `Declined registration for "${user.displayName}".`
      );
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Failed to update approval status.');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleIssueResetToken = async (user: UserAccount) => {
    if (user.role === 'SUPER_ADMIN' && !isSuperAdmin) {
      onNotify?.('error', 'Only a Super Administrator can issue reset tokens for a Super Administrator.');
      return;
    }
    setBusyUserId(user.id);
    try {
      const res = await dataService.issueResetToken(user.id, {
        expiresMinutes: 60,
        mustChangePassword: true,
      });
      setTokenCopied(false);
      setIssuedTokenModal({
        user,
        token: res.resetToken,
        expiresAt: res.expiresAt,
      });
      if (res.auditLog) {
        onUserUpdated?.(user, res.auditLog);
      }
      onNotify?.('success', `One-time recovery token issued for ${user.displayName}.`);
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to generate reset token.');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleVerifyChain = async () => {
    setVerifyingChain(true);
    try {
      const result = await dataService.verifyAuditChain();
      setChainIntegrity(result);
      onNotify?.(
        result.valid ? 'success' : 'error',
        result.message ||
          (result.valid
            ? `Audit log integrity verified across ${result.totalChecked} immutable entries.`
            : `Audit log integrity mismatch detected (${result.brokenAuditId || 'unknown entry'}).`)
      );
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to verify audit hash chain.');
    } finally {
      setVerifyingChain(false);
    }
  };

  const handleExportUsersCsv = () => {
    if (filteredUsers.length === 0) {
      onNotify?.('error', 'No users match the current filters to export.');
      return;
    }
    const headers = [
      'User ID',
      'Display Name',
      'Email',
      'Role Code',
      'Role Title',
      'Office',
      'Position',
      'Approval Status',
      'Account Status',
      'Password Configured',
      'Must Change Password',
      'Allowed Modules',
      'Last Sign-In',
      'Last Login IP',
      'Created At',
    ];
    const rows = filteredUsers.map((u) => {
      const modules = getEffectiveModules(u)
        .map((m) => MODULE_LABELS[m] || m)
        .join(' | ');
      return [
        u.id,
        u.displayName,
        u.email,
        u.role,
        ROLE_LABELS[u.role] || u.role,
        u.officeName,
        u.position,
        u.approvalStatus || 'APPROVED',
        u.isActive ? 'Active' : 'Inactive',
        u.hasPasscode ? 'Yes' : 'No',
        u.mustChangePassword ? 'Yes' : 'No',
        modules,
        u.lastLoginAt || '',
        u.lastLoginIp || '',
        u.createdAt,
      ];
    });
    const blob = buildCsvBlob(headers, rows);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const fileName = `LGU-Bula-System-Users-${dateStamp}.csv`;
    triggerBlobDownload(blob, fileName);
    const audit = buildAuditLog(
      currentUser,
      'EXPORT',
      'UserAccount',
      'users-csv',
      `Exported ${filteredUsers.length} system user accounts and roles to CSV`,
      fileName
    );
    void dataService
      .logAudit(audit)
      .then((res) => {
        if (res?.auditLog) {
          onUserUpdated?.(currentUser, res.auditLog);
        }
      })
      .catch(() => {});
    onNotify?.(
      'success',
      `Exported ${filteredUsers.length} system user${
        filteredUsers.length === 1 ? '' : 's'
      } to ${fileName}.`
    );
  };

  const handleExportAuditLogsCsv = async () => {
    setExportingAuditCsv(true);
    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const firstPage = await dataService.getAuditLogsPaginated({
        page: 1,
        pageSize: 200,
        action: auditActionFilter,
        search: auditSearch,
        userUid: auditUserFilter,
        dateFrom: auditDateFrom,
        dateTo: auditDateTo,
        tzOffsetMinutes,
      });

      const allLogs: AuditLog[] = [...firstPage.auditLogs];
      const maxPagesToFetch = Math.min(firstPage.totalPages || 1, 100);
      for (let p = 2; p <= maxPagesToFetch; p += 1) {
        const nextPage = await dataService.getAuditLogsPaginated({
          page: p,
          pageSize: 200,
          action: auditActionFilter,
          search: auditSearch,
          userUid: auditUserFilter,
          dateFrom: auditDateFrom,
          dateTo: auditDateTo,
          tzOffsetMinutes,
        });
        allLogs.push(...nextPage.auditLogs);
      }

      if (allLogs.length === 0) {
        onNotify?.(
          'error',
          hasActiveAuditFilters
            ? 'No audit log entries match the current filters to export.'
            : 'No audit log entries available to export.'
        );
        return;
      }

      const headers = [
        'Audit ID',
        'Timestamp (Local)',
        'Timestamp (ISO)',
        'User UID',
        'User Name',
        'User Email',
        'User Role',
        'Office',
        'Action',
        'Entity Type',
        'Entity ID',
        'Summary',
        'Details',
        'Field Changes',
        'Previous Hash',
        'Entry Hash',
      ];

      const rows = allLogs.map((l) => {
        const changesText = Array.isArray(l.changes)
          ? l.changes
              .map((c) => `${c.field}: ${c.before || '—'} -> ${c.after || '—'}`)
              .join(' | ')
          : '';
        return [
          l.id,
          l.timestamp ? new Date(l.timestamp).toLocaleString('en-PH') : '',
          l.timestamp,
          l.userUid,
          l.userName,
          l.userEmail,
          ROLE_LABELS[l.userRole] || l.userRole,
          l.userOfficeName || '',
          l.action,
          l.entityType,
          l.entityId,
          l.summary,
          l.details || '',
          changesText,
          l.prevHash || '',
          l.entryHash || '',
        ];
      });

      const blob = buildCsvBlob(headers, rows);
      const dateStamp = new Date().toISOString().slice(0, 10);
      const selectedUserOption =
        auditUserFilter !== 'ALL'
          ? auditUserOptions.find((u) => u.uid === auditUserFilter)
          : undefined;
      const userSeg = selectedUserOption
        ? `-${sanitizeCsvFileSegment(selectedUserOption.label.split(' (')[0] || selectedUserOption.uid)}`
        : '';
      const fileName = `LGU-Bula-Audit-Logs${userSeg}-${dateStamp}.csv`;
      triggerBlobDownload(blob, fileName);

      const audit = buildAuditLog(
        currentUser,
        'EXPORT',
        'AuditLog',
        'audit-logs-csv',
        `Exported ${allLogs.length} audit log entr${allLogs.length === 1 ? 'y' : 'ies'} to CSV`,
        fileName
      );
      void dataService
        .logAudit(audit)
        .then((res) => {
          if (res?.auditLog) {
            onUserUpdated?.(currentUser, res.auditLog);
          }
        })
        .catch(() => {});

      onNotify?.(
        'success',
        `Exported ${allLogs.length} audit log entr${allLogs.length === 1 ? 'y' : 'ies'} to ${fileName}.`
      );
    } catch (err) {
      onNotify?.(
        'error',
        err instanceof Error ? err.message : 'Unable to export audit logs to CSV.'
      );
    } finally {
      setExportingAuditCsv(false);
    }
  };

  const handleRevokeActiveSession = async (session: AdminActiveSession) => {
    if (session.userRole === 'SUPER_ADMIN' && !isSuperAdmin) {
      onNotify?.('error', 'Only a Super Administrator can terminate Super Administrator sessions.');
      return;
    }
    setRevokingSessionId(session.id);
    try {
      const res = await dataService.adminRevokeSession(session.id);
      if (res.auditLog) {
        onUserUpdated?.(currentUser, res.auditLog);
      }
      onNotify?.(
        'success',
        `Revoked active session for ${session.userName} (${session.ipAddress}).`
      );
      await fetchSessionsOverview();
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to revoke session.');
    } finally {
      setRevokingSessionId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Segmented Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'users'
                ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Personnel Accounts ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sessions')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'sessions'
                ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Active Sessions &amp; IP Map
            {sessionsOverview ? ` (${sessionsOverview.totalActiveSessions})` : ''}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'audit'
                ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            System Audit Logs ({auditPageData.total || auditLogs.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'users' && (
            <>
              <select
                aria-label="Filter by approval status"
                value={approvalFilter}
                onChange={(e) => setApprovalFilter(e.target.value as 'ALL' | ApprovalStatus)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none transition-colors"
              >
                <option value="ALL">All Statuses</option>
                <option value="APPROVED">Approved</option>
                <option value="PENDING">Pending ({pendingCount})</option>
                <option value="REJECTED">Rejected</option>
              </select>
              <select
                aria-label="Filter by office"
                value={officeFilter}
                onChange={(e) => setOfficeFilter(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none transition-colors"
              >
                <option value="ALL">All Offices ({users.length})</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} — {o.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={filteredUsers.length === 0}
                onClick={handleExportUsersCsv}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                title="Export visible system users and roles as CSV"
              >
                <Download className="h-3.5 w-3.5 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                <span>Export Users CSV</span>
              </button>
              {missingOfficeCount > 0 && (
                <button
                  type="button"
                  disabled={provisioning}
                  onClick={async () => {
                    setProvisioning(true);
                    try {
                      await onProvisionOfficeAccounts();
                    } catch {
                      /* Error notification handled in parent handler */
                    } finally {
                      setProvisioning(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#163A5F] dark:border-[#2563EB] px-3.5 py-2 text-xs font-semibold text-[#163A5F] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-sky-950/40 transition-colors disabled:opacity-50"
                >
                  <Building2 className="h-4 w-4" />
                  <span>
                    {provisioning
                      ? 'Provisioning...'
                      : `Create Missing Office Accounts (${missingOfficeCount})`}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={openNew}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white transition-colors shadow-xs"
              >
                <Plus className="h-4 w-4" />
                <span>Add Authorized User</span>
              </button>
            </>
          )}

          {activeTab === 'sessions' && (
            <button
              type="button"
              disabled={sessionsLoading}
              onClick={() => void fetchSessionsOverview()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{sessionsLoading ? 'Refreshing...' : 'Refresh Sessions'}</span>
            </button>
          )}

          <button
            type="button"
            disabled={exportingAuditCsv}
            onClick={() => void handleExportAuditLogsCsv()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
            title={
              hasActiveAuditFilters
                ? 'Export filtered audit log history as CSV'
                : 'Export current audit log history as CSV'
            }
          >
            <Download
              className={`h-3.5 w-3.5 text-[#163A5F] dark:text-sky-400 ${exportingAuditCsv ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
            <span>{exportingAuditCsv ? 'Exporting Audit Logs...' : 'Export Audit Logs'}</span>
          </button>
        </div>
      </div>

      {activeTab === 'users' && pendingCount > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/90 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong>{pendingCount}</strong> pending personnel registration{pendingCount === 1 ? '' : 's'} awaiting Administrator approval before access is granted.
          </span>
          <button
            type="button"
            onClick={() => setApprovalFilter((prev) => (prev === 'PENDING' ? 'ALL' : 'PENDING'))}
            className="rounded-md border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50"
          >
            {approvalFilter === 'PENDING' ? 'Show All Users' : 'Review Pending Queue'}
          </button>
        </div>
      )}

      {activeTab === 'users' ? (
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                  <th className="py-3 px-4">Name &amp; Position</th>
                  <th className="py-3 px-4">Email Address</th>
                  <th className="py-3 px-4">Office / Unit</th>
                  <th className="py-3 px-4">Role &amp; Access</th>
                  <th className="py-3 px-4">Credential Security</th>
                  <th className="py-3 px-4">Last Sign-In</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      No personnel accounts match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const approval = u.approvalStatus || 'APPROVED';
                    const isBusy = busyUserId === u.id;
                    const protectedSuperAdmin = u.role === 'SUPER_ADMIN' && !isSuperAdmin;
                    const moduleCount = getEffectiveModules(u).length;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {u.displayName}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {u.position}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-700 dark:text-slate-300">
                          {u.email}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-400 text-xs">
                          {u.officeName}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-xs text-[#163A5F] dark:text-sky-400">
                            {ROLE_LABELS[u.role] || u.role}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {moduleCount} module{moduleCount === 1 ? '' : 's'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {u.hasPasscode ? (
                            <span className="inline-flex items-center gap-1 text-[#16A34A] dark:text-emerald-400 font-medium">
                              <Lock className="h-3 w-3" /> Password Set
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                              <ShieldAlert className="h-3 w-3" /> Requires Reset
                            </span>
                          )}
                          {u.mustChangePassword && (
                            <div className="text-[10px] text-amber-700 dark:text-amber-400">
                              Change Required
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[11px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {u.lastLoginAt ? (
                            <>
                              <div>{new Date(u.lastLoginAt).toLocaleString('en-PH')}</div>
                              {u.lastLoginIp && (
                                <div className="text-[10px] opacity-80">{u.lastLoginIp}</div>
                              )}
                            </>
                          ) : (
                            <span>Never</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {approval === 'PENDING' ? (
                            <span className="font-semibold text-amber-700 dark:text-amber-400">
                              Pending Approval
                            </span>
                          ) : approval === 'REJECTED' ? (
                            <span className="font-semibold text-red-600 dark:text-red-400">
                              Declined
                            </span>
                          ) : (
                            <span
                              className={`font-semibold ${
                                u.isActive
                                  ? 'text-[#16A34A] dark:text-emerald-400'
                                  : 'text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              {u.isActive ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {approval === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleApprovalDecision(u, 'APPROVED')}
                                  className="rounded-lg p-1.5 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors disabled:opacity-50"
                                  title="Approve Account"
                                >
                                  <UserCheck className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleApprovalDecision(u, 'REJECTED')}
                                  className="rounded-lg p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50"
                                  title="Decline Account"
                                >
                                  <UserX className="h-4 w-4" />
                                </button>
                              </>
                            )}
                            {approval === 'APPROVED' && !protectedSuperAdmin && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleIssueResetToken(u)}
                                className="rounded-lg p-1.5 text-[#163A5F] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                                title="Issue One-Time Password Reset Token"
                              >
                                <KeyRound className="h-4 w-4" />
                              </button>
                            )}
                            {!protectedSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => openEdit(u)}
                                className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                title="Edit User"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                            )}
                            {u.id !== currentUser.id && !protectedSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(u)}
                                className="rounded-lg p-1.5 text-[#DC2626] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                                title="Delete User"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'sessions' ? (
        <div className="space-y-5">
          {sessionsError && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2"
            >
              <span>{sessionsError}</span>
              <button
                type="button"
                onClick={() => void fetchSessionsOverview()}
                className="rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold"
              >
                Retry
              </button>
            </div>
          )}

          {/* Sessions Security Overview KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Active Sessions
                </span>
                <Laptop className="h-4 w-4 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {sessionsOverview?.totalActiveSessions ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Non-expired authenticated tokens
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Unique IP Addresses
                </span>
                <Globe className="h-4 w-4 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-[#2563EB] dark:text-sky-400 tabular-nums">
                {sessionsOverview?.uniqueIpCount ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Distinct source endpoints observed
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Signed-In Personnel
                </span>
                <Users className="h-4 w-4 text-[#0D9488] dark:text-teal-400" aria-hidden="true" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {sessionsOverview?.uniqueUserCount ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Unique accounts currently online
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Network / Geo Zones
                </span>
                <Network className="h-4 w-4 text-slate-600 dark:text-slate-400" aria-hidden="true" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {sessionsOverview?.zoneBreakdown.length ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Segmented by IP scope &amp; proxy headers
              </p>
            </div>
          </div>

          {/* Geographic & Network Distribution + IP Address Location Groups */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Geographic / Network Zone Distribution */}
            <div className="lg:col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                    Geographic &amp; Network Distribution
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Active session share grouped by network zone &amp; geographic hint
                  </p>
                </div>
                <MapPin className="h-4 w-4 text-[#2563EB] dark:text-sky-400 shrink-0" aria-hidden="true" />
              </div>

              {sessionsLoading && !sessionsOverview ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Loading active session distribution...
                </p>
              ) : !sessionsOverview || sessionsOverview.zoneBreakdown.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No active sessions recorded.
                </p>
              ) : (
                <div className="space-y-3.5">
                  {sessionsOverview.zoneBreakdown.map((z) => {
                    const style = SCOPE_COLORS[z.scope] || SCOPE_COLORS.UNKNOWN;
                    return (
                      <div key={z.zone} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${style.badge}`}
                            >
                              {z.scope}
                            </span>
                            <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                              {z.zone}
                            </span>
                          </div>
                          <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums shrink-0">
                            {z.sessionCount} ({z.pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-full rounded-full transition-all ${style.bar}`}
                            style={{ width: `${Math.min(100, Math.max(4, z.pct))}%` }}
                          />
                        </div>
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {z.uniqueIpCount} unique IP{z.uniqueIpCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Sessions by IP Address & Location */}
            <div className="lg:col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
                    Active IP Endpoints &amp; Locations
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Source IP addresses, subnet prefixes, and active personnel per endpoint
                  </p>
                </div>
                <Globe className="h-4 w-4 text-[#0D9488] dark:text-teal-400 shrink-0" aria-hidden="true" />
              </div>

              {sessionsLoading && !sessionsOverview ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Loading IP endpoints...
                </p>
              ) : !sessionsOverview || sessionsOverview.locationGroups.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No active IP endpoints observed.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {sessionsOverview.locationGroups.map((grp) => {
                    const style = SCOPE_COLORS[grp.scope] || SCOPE_COLORS.UNKNOWN;
                    return (
                      <div
                        key={grp.key}
                        className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                              {grp.ipAddress}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              ({grp.subnet})
                            </span>
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${style.badge}`}
                            >
                              {grp.locationLabel}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] font-semibold text-[#163A5F] dark:text-sky-400">
                            {grp.sessionCount} session{grp.sessionCount === 1 ? '' : 's'} · {grp.userCount}{' '}
                            user{grp.userCount === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {grp.users.map((u) => (
                            <span
                              key={`${grp.key}-${u.userId}`}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-300"
                            >
                              <span className="font-semibold">{u.displayName}</span>
                              <span className="text-slate-400">·</span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                {ROLE_LABELS[u.role] || u.role}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Live Active Sessions Table */}
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Live Active Personnel Sessions
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Monitor sign-in origins and terminate suspicious or stale sessions immediately
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {sessionsOverview?.sessions.length ?? 0} active
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-[12px] font-semibold text-slate-700 dark:text-slate-300">
                    <th className="py-2.5 px-4">Personnel &amp; Role</th>
                    <th className="py-2.5 px-4">Source IP &amp; Subnet</th>
                    <th className="py-2.5 px-4">Location / Zone</th>
                    <th className="py-2.5 px-4">Client Device</th>
                    <th className="py-2.5 px-4">Last Activity</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {sessionsLoading && !sessionsOverview ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                        Loading active sessions...
                      </td>
                    </tr>
                  ) : !sessionsOverview || sessionsOverview.sessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                        No active authenticated sessions found.
                      </td>
                    </tr>
                  ) : (
                    sessionsOverview.sessions.map((s) => {
                      const style = SCOPE_COLORS[s.scope] || SCOPE_COLORS.UNKNOWN;
                      const protectedSuperAdmin =
                        s.userRole === 'SUPER_ADMIN' && !isSuperAdmin;
                      const isRevoking = revokingSessionId === s.id;
                      return (
                        <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {s.userName}
                              </span>
                              {s.isCurrent && (
                                <span className="rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                                  Current
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {ROLE_LABELS[s.userRole] || s.userRole} · {s.officeName}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {s.ipAddress}
                            </div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {s.subnet}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-xs">
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${style.badge}`}
                            >
                              {s.locationLabel}
                            </span>
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {s.networkZone}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                            {summarizeDeviceAgent(s.userAgent)}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            <div>{new Date(s.lastActivityAt).toLocaleString('en-PH')}</div>
                            <div className="text-[10px] opacity-80">
                              Expires {new Date(s.expiresAt).toLocaleString('en-PH')}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            {s.isCurrent ? (
                              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                This Session
                              </span>
                            ) : protectedSuperAdmin ? (
                              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                Protected
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={isRevoking}
                                onClick={() => void handleRevokeActiveSession(s)}
                                className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-800/80 bg-red-50/70 dark:bg-red-950/40 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                                <span>{isRevoking ? 'Revoking...' : 'Revoke'}</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAuditPage(1);
                setAuditSearch(auditSearchInput);
              }}
              className="flex flex-wrap items-end gap-2.5 flex-1"
            >
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Keyword Search
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={auditSearchInput}
                    onChange={(e) => {
                      setAuditSearchInput(e.target.value);
                      if (!e.target.value.trim()) {
                        setAuditPage(1);
                        setAuditSearch('');
                      }
                    }}
                    placeholder="Search summary, entity, email..."
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="min-w-[200px] max-w-[260px]">
                <label
                  htmlFor="audit-user-filter"
                  className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                >
                  User Account
                </label>
                <select
                  id="audit-user-filter"
                  aria-label="Filter audit logs by user account"
                  value={auditUserFilter}
                  onChange={(e) => {
                    setAuditUserFilter(e.target.value);
                    setAuditPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                >
                  <option value="ALL">All User Accounts</option>
                  {auditUserOptions.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="audit-action-filter"
                  className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                >
                  Action Type
                </label>
                <select
                  id="audit-action-filter"
                  aria-label="Filter audit logs by action type"
                  value={auditActionFilter}
                  onChange={(e) => {
                    setAuditActionFilter(e.target.value);
                    setAuditPage(1);
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                >
                  <option value="ALL">All Actions</option>
                  {[
                    'CREATE',
                    'UPDATE',
                    'DELETE',
                    'STATUS_CHANGE',
                    'IMPORT',
                    'EXPORT',
                    'LOGIN',
                    'AUTH_FAILED',
                    'SETTINGS',
                    'BACKUP',
                    'RESTORE',
                  ].map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="audit-date-from"
                  className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                >
                  From Date
                </label>
                <input
                  id="audit-date-from"
                  type="date"
                  aria-label="Filter audit logs from date"
                  value={auditDateFrom}
                  max={auditDateTo || undefined}
                  onChange={(e) => {
                    setAuditDateFrom(e.target.value);
                    setAuditPage(1);
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-sm font-mono focus:border-[#2563EB] focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="audit-date-to"
                  className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
                >
                  To Date
                </label>
                <input
                  id="audit-date-to"
                  type="date"
                  aria-label="Filter audit logs to date"
                  value={auditDateTo}
                  min={auditDateFrom || undefined}
                  onChange={(e) => {
                    setAuditDateTo(e.target.value);
                    setAuditPage(1);
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2.5 py-1.5 text-sm font-mono focus:border-[#2563EB] focus:outline-none transition-colors"
                />
              </div>

              <button
                type="submit"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Apply Search
              </button>

              {hasActiveAuditFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setAuditSearchInput('');
                    setAuditSearch('');
                    setAuditActionFilter('ALL');
                    setAuditUserFilter('ALL');
                    setAuditDateFrom('');
                    setAuditDateTo('');
                    setAuditPage(1);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              )}
            </form>

            <button
              type="button"
              disabled={verifyingChain}
              onClick={handleVerifyChain}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#163A5F] dark:border-[#2563EB] bg-white dark:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-[#163A5F] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-sky-950/40 disabled:opacity-50 transition-colors"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>{verifyingChain ? 'Verifying Chain...' : 'Verify Hash Chain Integrity'}</span>
            </button>
          </div>

          {chainIntegrity && (
            <div
              role="status"
              className={`rounded-xl border px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-3 ${
                chainIntegrity.valid
                  ? 'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                  : 'border-red-200 dark:border-red-900/70 bg-red-50/90 dark:bg-red-950/40 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {chainIntegrity.valid ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {chainIntegrity.valid ? (
                    <>
                      <strong>Tamper-Evident Chain Valid:</strong> All{' '}
                      <span className="font-mono font-semibold">{chainIntegrity.totalChecked}</span> audit log entries verified sequentially via SHA-256.
                    </>
                  ) : (
                    <>
                      <strong>Chain Verification Failed:</strong> Discrepancy detected at{' '}
                      <span className="font-mono font-semibold">{chainIntegrity.brokenAuditId || 'audit entry'}</span>.
                    </>
                  )}
                </span>
              </div>
              <span className="font-mono text-[11px] opacity-80">{chainIntegrity.message}</span>
            </div>
          )}

          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">User &amp; Role</th>
                    <th className="py-2.5 px-4">Action</th>
                    <th className="py-2.5 px-4">Entity</th>
                    <th className="py-2.5 px-4">Summary &amp; Field Changes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                  {auditPageData.loading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        Loading audit log page...
                      </td>
                    </tr>
                  ) : auditPageData.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        No audit log entries match your filter.
                      </td>
                    </tr>
                  ) : (
                    auditPageData.rows.map((l) => {
                      const hasDiffs = Array.isArray(l.changes) && l.changes.length > 0;
                      const diffExpanded = Boolean(expandedDiffIds[l.id]);
                      return (
                        <Fragment key={l.id}>
                          <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
                            <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              <div>{new Date(l.timestamp).toLocaleString('en-PH')}</div>
                              {l.entryHash && (
                                <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                  #{l.entryHash.slice(0, 10)}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="font-medium text-slate-900 dark:text-slate-100">
                                {l.userName}
                              </span>
                              <span className="text-slate-400"> · </span>
                              <span className="text-slate-500 dark:text-slate-400">
                                {l.userRole}
                                {l.userOfficeName ? ` (${l.userOfficeName})` : ''}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 font-mono font-semibold text-[#163A5F] dark:text-sky-400 whitespace-nowrap">
                              {l.action}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {l.entityType}
                            </td>
                            <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200">
                              <div>{l.summary}</div>
                              {hasDiffs && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedDiffIds((prev) => ({
                                      ...prev,
                                      [l.id]: !prev[l.id],
                                    }))
                                  }
                                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] dark:text-sky-400 hover:underline"
                                >
                                  {diffExpanded ? (
                                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" aria-hidden="true" />
                                  )}
                                  <History className="h-3 w-3" aria-hidden="true" />
                                  <span>
                                    {l.changes!.length} field change
                                    {l.changes!.length === 1 ? '' : 's'}
                                  </span>
                                </button>
                              )}
                            </td>
                          </tr>
                          {hasDiffs && diffExpanded && (
                            <tr className="bg-slate-50/80 dark:bg-slate-800/40">
                              <td colSpan={5} className="px-4 py-2.5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                                  {l.changes!.map((c, idx) => (
                                    <div
                                      key={`${l.id}-diff-${idx}`}
                                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                                    >
                                      <p className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                        {c.field}
                                      </p>
                                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 break-words">
                                        <span className="line-through text-red-600 dark:text-red-400">
                                          {c.before || '—'}
                                        </span>{' '}
                                        <span className="mx-1">→</span>{' '}
                                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                                          {c.after || '—'}
                                        </span>
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Page <strong className="font-mono">{auditPage}</strong> of{' '}
                <strong className="font-mono">{auditPageData.totalPages}</strong> (
                <strong className="font-mono">{auditPageData.total}</strong> total entries)
              </span>
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={auditPage <= 1 || auditPageData.loading}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={auditPage >= auditPageData.totalPages || auditPageData.loading}
                  onClick={() => setAuditPage((p) => Math.min(auditPageData.totalPages, p + 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-[2px] p-4 overflow-y-auto">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-modal-title"
            className="my-6 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 id="user-modal-title" className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                {editing ? 'Edit Personnel Account' : 'Add Authorized User Account'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2 text-xs text-red-700 dark:text-red-300"
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Full Name *
                </label>
                <input
                  required
                  type="text"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Email Address *
                  </label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Role *
                  </label>
                  <select
                    value={form.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setForm({
                        ...form,
                        role: nextRole,
                        allowedModules: getDefaultModulesForRole(nextRole),
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                  >
                    {ALL_USER_ROLES.map((r) => (
                      <option
                        key={r}
                        value={r}
                        disabled={r === 'SUPER_ADMIN' && !isSuperAdmin}
                      >
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    Assigned Office
                  </label>
                  <select
                    value={form.officeId}
                    onChange={(e) => setForm({ ...form, officeId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
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
                    Position Title
                  </label>
                  <input
                    type="text"
                    value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                    placeholder="Planning Officer"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Account Password {editing ? '(Leave blank to keep existing)' : '*'}
                </label>
                <input
                  type="password"
                  required={!editing}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                  placeholder={
                    editing
                      ? 'Optional: enter new password (8+ chars, letters & numbers)'
                      : 'Minimum 8 characters with letters and numbers'
                  }
                />
              </div>

              {/* Module Access Control Checkboxes */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Allowed System Modules
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        allowedModules: getDefaultModulesForRole(prev.role),
                      }))
                    }
                    className="text-[11px] font-semibold text-[#2563EB] dark:text-sky-400 hover:underline"
                  >
                    Reset to Role Defaults
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                  {ALL_SIDEBAR_MODULES.map((mod) => {
                    const checked =
                      form.role === 'SUPER_ADMIN' ||
                      mod === 'dashboard' ||
                      form.allowedModules.includes(mod);
                    const locked = form.role === 'SUPER_ADMIN' || mod === 'dashboard';
                    return (
                      <label
                        key={mod}
                        className={`flex items-center gap-2 rounded px-2 py-1 ${
                          locked ? 'opacity-75' : 'cursor-pointer hover:bg-white dark:hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={checked}
                          onChange={() => handleToggleModule(mod)}
                          className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB]"
                        />
                        <span className="text-slate-700 dark:text-slate-300">
                          {MODULE_LABELS[mod]}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB]"
                  />
                  <span>Account Active</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.mustChangePassword}
                    onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })}
                    className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB]"
                  />
                  <span>Require password change on next sign-in</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white transition-colors shadow-xs"
                >
                  {saving ? 'Saving...' : 'Save Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-Time Password Reset Token Display Modal */}
      {issuedTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-[2px] p-4">
          <div
            ref={tokenModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-token-title"
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 id="reset-token-title" className="text-[17px] font-semibold text-slate-900 dark:text-slate-100">
                One-Time Password Recovery Token
              </h3>
              <button
                type="button"
                onClick={() => setIssuedTokenModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Provide this one-time token securely to{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {issuedTokenModal.user.displayName}
              </strong>{' '}
              (<span className="font-mono">{issuedTokenModal.user.email}</span>). It expires at{' '}
              <span className="font-mono">
                {new Date(issuedTokenModal.expiresAt).toLocaleString('en-PH')}
              </span>{' '}
              and will not be shown again once closed.
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 dark:border-sky-800 bg-blue-50/70 dark:bg-sky-950/40 px-3.5 py-2.5">
              <code className="font-mono text-sm font-bold text-[#163A5F] dark:text-sky-300 select-all">
                {issuedTokenModal.token}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(issuedTokenModal.token).then(() => {
                    setTokenCopied(true);
                  });
                }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
              >
                {tokenCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIssuedTokenModal(null)}
                className="rounded-lg bg-[#163A5F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E4D7B]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Remove User Account"
        message={`Are you sure you want to delete user "${confirmDelete?.displayName}"?`}
        confirmLabel="Delete User"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) await onDeleteUser(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
