import { useMemo, useState } from 'react';
import { Building2, Eye, EyeOff, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { AuthDirectoryUser, Office } from '../types/ppa';

interface LoginViewProps {
  users: AuthDirectoryUser[];
  offices: Office[];
  appName?: string;
  appLogoDataUrl?: string;
  firebaseConfigured: boolean;
  firebaseProjectId: string | null;
  onSelectLocalUser: (userId: string, passcode: string) => Promise<void>;
  onFirebaseGoogleSignIn: () => Promise<void>;
}

export function LoginView({
  users,
  offices,
  appName,
  appLogoDataUrl,
  firebaseConfigured,
  firebaseProjectId,
  onSelectLocalUser,
  onFirebaseGoogleSignIn,
}: LoginViewProps) {
  const activeUsers = useMemo(() => users.filter((u) => u.isActive), [users]);
  const officeCodeMap = useMemo(
    () => new Map(offices.map((o) => [o.id, o.code])),
    [offices]
  );

  const [officeFilter, setOfficeFilter] = useState<string>('ALL');
  const [selectedUserId, setSelectedUserId] = useState<string>(
    activeUsers[0]?.id || ''
  );
  const [passcodeInput, setPasscodeInput] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filteredUsers = useMemo(() => {
    if (officeFilter === 'ALL') return activeUsers;
    return activeUsers.filter((u) => u.officeId === officeFilter);
  }, [activeUsers, officeFilter]);

  const selectedUser =
    filteredUsers.find((u) => u.id === selectedUserId) || filteredUsers[0];

  const requiresPasscode = Boolean(selectedUser?.hasPasscode);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!selectedUser) {
      setAuthError('No active user account selected.');
      return;
    }
    if (requiresPasscode && !passcodeInput.trim()) {
      setAuthError('Please enter your account passcode.');
      return;
    }
    setLoading(true);
    try {
      await onSelectLocalUser(selectedUser.id, passcodeInput);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to sign in with the selected account.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setLoading(true);
    try {
      await onFirebaseGoogleSignIn();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl grid grid-cols-1 lg:grid-cols-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
        {/* Left Official LGU Identity Panel */}
        <div className="lg:col-span-2 bg-[#163A5F] text-white p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 border border-white/15 overflow-hidden">
                {appLogoDataUrl ? (
                  <img
                    src={appLogoDataUrl}
                    alt={`${appName || 'LGU Bula Program Project and Activity Monitoring System'} logo`}
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <Building2 className="h-6 w-6 text-teal-300" aria-hidden="true" />
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-blue-200">Republic of the Philippines</p>
                <p className="text-sm font-semibold text-white">Municipality of Bula</p>
              </div>
            </div>

            <h1 className="mt-8 text-[26px] font-semibold leading-snug tracking-tight text-white">
              {appName?.trim() || 'LGU Bula Program Project and Activity Monitoring System'}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-blue-100/90">
              Integrated Planning, Budgeting, Implementation, and Monitoring Workspace for MPDO and all Municipal Implementing Offices.
            </p>
          </div>

          <div className="mt-8 border-t border-white/15 pt-6 space-y-3 text-xs text-blue-100/90">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-teal-300 shrink-0" aria-hidden="true" />
              <span>Server-Verified Sessions · Role &amp; Office Isolation</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-teal-300 shrink-0" aria-hidden="true" />
              <span>Tamper-Evident Audit Trail · SQLite ACID Storage</span>
            </div>
          </div>
        </div>

        {/* Right Sign-In Form */}
        <div className="lg:col-span-3 p-8 sm:p-10 flex flex-col justify-center">
          <div>
            <h2 className="text-[20px] font-semibold text-slate-900 dark:text-slate-100">Office &amp; Personnel Sign In</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Select your Office monitoring account or authenticate via Google Workspace.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300"
            >
              {authError}
            </div>
          )}

          {firebaseConfigured && (
            <div className="mt-6">
              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-2.5 rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4D7B] disabled:opacity-60 transition-colors"
              >
                <UserCheck className="h-4 w-4" aria-hidden="true" />
                <span>{loading ? 'Authenticating...' : `Sign in with Google (${firebaseProjectId})`}</span>
              </button>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-slate-900 px-3 text-slate-500 dark:text-slate-400">
                    Or continue with Office Account
                  </span>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleLocalLogin} className={firebaseConfigured ? 'space-y-4' : 'mt-6 space-y-4'}>
            <div>
              <label htmlFor="login-office-filter" className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Filter by Office / Department
              </label>
              <select
                id="login-office-filter"
                value={officeFilter}
                disabled={loading}
                onChange={(e) => {
                  const nextOffice = e.target.value;
                  setOfficeFilter(nextOffice);
                  setPasscodeInput('');
                  setAuthError(null);
                  const firstMatch =
                    nextOffice === 'ALL'
                      ? activeUsers[0]
                      : activeUsers.find((u) => u.officeId === nextOffice);
                  if (firstMatch) setSelectedUserId(firstMatch.id);
                }}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
              >
                <option value="ALL">All LGU Offices ({activeUsers.length} Accounts)</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} — {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="login-account" className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                Authorized Office / Personnel Account
              </label>
              <select
                id="login-account"
                disabled={filteredUsers.length === 0 || loading}
                value={selectedUser?.id || ''}
                onChange={(e) => {
                  setSelectedUserId(e.target.value);
                  setPasscodeInput('');
                  setAuthError(null);
                }}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
              >
                {filteredUsers.length === 0 ? (
                  <option value="">No active accounts assigned to this office</option>
                ) : (
                  filteredUsers.map((u) => {
                    const code = officeCodeMap.get(u.officeId);
                    return (
                      <option key={u.id} value={u.id}>
                        {code ? `[${code}] ` : ''}{u.displayName} — {u.role}
                      </option>
                    );
                  })
                )}
              </select>
            </div>

            {requiresPasscode && (
              <div>
                <label htmlFor="login-passcode" className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
                  Account Passcode *
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="login-passcode"
                    type={showPasscode ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={passcodeInput}
                    disabled={loading}
                    onChange={(e) => {
                      setPasscodeInput(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="Enter office account passcode"
                    className="block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-3 pr-10 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasscode((s) => !s)}
                    className="absolute right-2.5 top-2.5 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label={showPasscode ? 'Hide passcode' : 'Show passcode'}
                  >
                    {showPasscode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {selectedUser && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{selectedUser.displayName}</span>
                  <span className="font-mono text-xs font-semibold text-[#163A5F] dark:text-sky-400">{selectedUser.role}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {selectedUser.email} · {selectedUser.officeName}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {selectedUser.role === 'ADMINISTRATOR' &&
                    'Full municipality-wide access: Oversee all offices, Programs, Budgets, Excel Import/Export, User Management, and Audit Logs.'}
                  {selectedUser.role === 'ENCODER' &&
                    `Dedicated office monitoring access: Create and manage Programs and Activities for ${selectedUser.officeName}, encode monthly expenditures & accomplishments, and track office reports.`}
                  {selectedUser.role === 'VIEWER' &&
                    'Read-only executive access: View dashboards, programs, monitoring evaluations, and print/export reports across offices.'}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={!selectedUser || loading}
              className="w-full rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4D7B] disabled:opacity-50 transition-colors"
            >
              {loading ? 'Verifying Session...' : 'Sign In to Monitoring Dashboard'}
            </button>
          </form>

          {!firebaseConfigured && (
            <p className="mt-6 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Persistent SQLite WAL storage and HttpOnly session authentication active. Office accounts are managed under User Management.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
