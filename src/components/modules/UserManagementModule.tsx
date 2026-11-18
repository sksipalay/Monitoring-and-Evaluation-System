import { Fragment, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  History,
  Lock,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { AuditIntegrityResult, AuditLog, Office, UserAccount, UserRole } from '../../types/ppa';
import { dataService } from '../../services/dataService';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface UserManagementModuleProps {
  users: UserAccount[];
  offices: Office[];
  auditLogs: AuditLog[];
  currentUser: UserAccount;
  onCreateUser: (u: UserAccount) => Promise<void>;
  onUpdateUser: (u: UserAccount) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
  onProvisionOfficeAccounts: () => Promise<void>;
  onNotify?: (type: 'success' | 'error', msg: string) => void;
}

const ROLES: UserRole[] = ['ADMINISTRATOR', 'ENCODER', 'VIEWER'];

export function UserManagementModule({
  users,
  offices,
  auditLogs,
  currentUser,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onProvisionOfficeAccounts,
  onNotify,
}: UserManagementModuleProps) {
  const isAdmin = currentUser.role === 'ADMINISTRATOR';
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [officeFilter, setOfficeFilter] = useState('ALL');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    role: 'ENCODER' as UserRole,
    officeId: offices[0]?.id || '',
    position: '',
    passcode: '',
    clearPasscode: false,
    isActive: true,
  });
  const [confirmDelete, setConfirmDelete] = useState<UserAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [verifyingChain, setVerifyingChain] = useState(false);
  const [chainIntegrity, setChainIntegrity] = useState<AuditIntegrityResult | null>(null);
  const [expandedDiffIds, setExpandedDiffIds] = useState<Record<string, boolean>>({});
  const modalRef = useModalFocusTrap<HTMLDivElement>(modalOpen, () => setModalOpen(false));

  const missingOfficeCount = useMemo(
    () =>
      offices.filter(
        (o) =>
          !users.some(
            (u) =>
              u.officeId === o.id &&
              (u.role === 'ENCODER' || (o.id === 'off-mpdo' && u.role === 'ADMINISTRATOR'))
          )
      ).length,
    [offices, users]
  );

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => officeFilter === 'ALL' || u.officeId === officeFilter),
    [users, officeFilter]
  );

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (auditActionFilter !== 'ALL' && l.action !== auditActionFilter) return false;
      if (q) {
        const hay = `${l.userName} ${l.userEmail} ${l.action} ${l.entityType} ${l.summary}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, auditSearch, auditActionFilter]);

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          <Shield className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-[18px] font-semibold text-slate-900 dark:text-slate-100">Administrator Access Required</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Only MPDO System Administrators can manage user accounts, role permissions, and system audit logs.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(null);
    setForm({
      displayName: '',
      email: '',
      role: 'ENCODER',
      officeId: offices[0]?.id || '',
      position: '',
      passcode: '',
      clearPasscode: false,
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (u: UserAccount) => {
    setEditing(u);
    setForm({
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      officeId: u.officeId,
      position: u.position,
      passcode: '',
      clearPasscode: false,
      isActive: u.isActive,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.displayName.trim() || !form.email.trim()) return;
    setSaving(true);
    try {
      const off = offices.find((o) => o.id === form.officeId);
      const now = new Date().toISOString();
      const trimmedPasscode = form.passcode.trim();
      if (editing) {
        await onUpdateUser({
          ...editing,
          displayName: form.displayName.trim(),
          email: form.email.trim(),
          role: form.role,
          officeId: off?.id || form.officeId,
          officeName: off?.name || editing.officeName,
          position: form.position.trim(),
          passcode: trimmedPasscode || undefined,
          clearPasscode: form.clearPasscode && !trimmedPasscode ? true : undefined,
          isActive: form.isActive,
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
          passcode: trimmedPasscode || undefined,
          isActive: form.isActive,
          createdAt: now,
          updatedAt: now,
        });
      }
      setModalOpen(false);
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setSaving(false);
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
            onClick={() => setActiveTab('audit')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'audit'
                ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            System Audit Logs ({auditLogs.length})
          </button>
        </div>

        {activeTab === 'users' && (
          <div className="flex flex-wrap items-center gap-2">
            <select
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
          </div>
        )}
      </div>

      {activeTab === 'users' ? (
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-[12.5px] font-semibold text-slate-700 dark:text-slate-300">
                  <th className="py-3 px-4">Name &amp; Position</th>
                  <th className="py-3 px-4">Email Address</th>
                  <th className="py-3 px-4">Office / Unit</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Access Security</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">{u.displayName}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{u.position}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">{u.email}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">{u.officeName}</td>
                    <td className="py-3 px-4 font-semibold text-[#163A5F] dark:text-sky-400">{u.role}</td>
                    <td className="py-3 px-4">
                      {u.hasPasscode ? (
                        <span className="inline-flex items-center gap-1 text-[#16A34A] dark:text-emerald-400 font-medium">
                          <Lock className="h-3 w-3" /> Passcode Set
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">Open Profile</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold ${
                          u.isActive ? 'text-[#16A34A] dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          title="Edit User"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        {u.id !== currentUser.id && (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-0 sm:min-w-[220px] max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search user, action, summary..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 py-1.5 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                />
              </div>
              <select
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
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
              <span className="font-mono text-[11px] opacity-80">
                {chainIntegrity.message}
              </span>
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
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        No audit log entries recorded yet.
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((l) => {
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
                              <span className="font-medium text-slate-900 dark:text-slate-100">{l.userName}</span>
                              <span className="text-slate-400"> · </span>
                              <span className="text-slate-500 dark:text-slate-400">
                                {l.userRole}{l.userOfficeName ? ` (${l.userOfficeName})` : ''}
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
                                    setExpandedDiffIds((prev) => ({ ...prev, [l.id]: !prev[l.id] }))
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
                                    {l.changes!.length} field change{l.changes!.length === 1 ? '' : 's'}
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
          </div>
        </div>
      )}

      {/* User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-[2px] p-4 overflow-y-auto">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-modal-title"
            className="my-6 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 id="user-modal-title" className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                {editing ? 'Edit Personnel Account' : 'Add Personnel Account'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Full Name *</label>
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
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Role *</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Office</label>
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
                  <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Position</label>
                  <input
                    type="text"
                    value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none transition-colors"
                    placeholder="Planning Officer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Account Passcode / PIN {editing?.hasPasscode ? '(Protected — Set)' : '(Optional)'}
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  disabled={form.clearPasscode}
                  value={form.passcode}
                  onChange={(e) => setForm({ ...form, passcode: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none transition-colors disabled:opacity-50"
                  placeholder={
                    editing?.hasPasscode
                      ? 'Leave blank to keep existing passcode, or enter new passcode'
                      : 'Leave blank for open profile login, or set an office passcode'
                  }
                />
                {editing?.hasPasscode && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={form.clearPasscode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          clearPasscode: e.target.checked,
                          passcode: e.target.checked ? '' : form.passcode,
                        })
                      }
                      className="rounded border-slate-300 dark:border-slate-600 text-red-600 focus:ring-red-500"
                    />
                    <span>Remove existing passcode (switch back to Open Profile)</span>
                  </label>
                )}
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB] focus:ring-[#2563EB]"
                />
                <span>Account Active</span>
              </label>

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
                  {saving ? 'Saving...' : 'Save User'}
                </button>
              </div>
            </form>
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
