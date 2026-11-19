import { useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { Office } from '../types/ppa';

interface LoginViewProps {
  setupRequired: boolean;
  allowSelfRegistration: boolean;
  privacyNoticeText: string;
  offices: Office[];
  appName?: string;
  appLogoDataUrl?: string;
  firebaseConfigured: boolean;
  firebaseProjectId: string | null;
  initialNotice?: string | null;
  onSetupInitialAdmin: (payload: {
    email: string;
    displayName: string;
    position: string;
    password: string;
    privacyAccepted: boolean;
  }) => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (payload: {
    email: string;
    displayName: string;
    officeId: string;
    position: string;
    password: string;
    privacyAccepted: boolean;
  }) => Promise<{ message: string }>;
  onForgotPassword: (email: string) => Promise<{ message: string }>;
  onResetPassword: (payload: {
    email: string;
    token: string;
    newPassword: string;
  }) => Promise<{ message: string }>;
  onFirebaseGoogleSignIn: () => Promise<void>;
}

type AuthMode = 'login' | 'forgot' | 'register';

function checkClientPasswordPolicy(value: string): string | null {
  if (value.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

export function LoginView({
  setupRequired,
  allowSelfRegistration,
  privacyNoticeText,
  offices,
  appName,
  appLogoDataUrl,
  firebaseConfigured,
  firebaseProjectId,
  initialNotice = null,
  onSetupInitialAdmin,
  onLogin,
  onRegister,
  onForgotPassword,
  onResetPassword,
  onFirebaseGoogleSignIn,
}: LoginViewProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [authError, setAuthError] = useState<string | null>(initialNotice);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sign-In state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Initial Super Admin Setup state
  const [setupForm, setSetupForm] = useState({
    displayName: '',
    email: '',
    position: 'MPDO System Administrator',
    password: '',
    confirmPassword: '',
    privacyAccepted: false,
  });

  // Self-Registration state
  const [registerForm, setRegisterForm] = useState({
    displayName: '',
    email: '',
    officeId: offices[0]?.id || '',
    position: '',
    password: '',
    confirmPassword: '',
    privacyAccepted: false,
  });

  // Password Recovery state
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setAuthError(null);
    setAuthSuccess(null);
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    if (!setupForm.displayName.trim() || !setupForm.email.trim()) {
      setAuthError('Full name and official email address are required.');
      return;
    }
    const strengthErr = checkClientPasswordPolicy(setupForm.password);
    if (strengthErr) {
      setAuthError(strengthErr);
      return;
    }
    if (setupForm.password !== setupForm.confirmPassword) {
      setAuthError('Password and confirmation password do not match.');
      return;
    }
    if (!setupForm.privacyAccepted) {
      setAuthError('You must acknowledge the RA 10173 Data Privacy Notice before continuing.');
      return;
    }

    setLoading(true);
    try {
      await onSetupInitialAdmin({
        email: setupForm.email.trim(),
        displayName: setupForm.displayName.trim(),
        position: setupForm.position.trim() || 'MPDO System Administrator',
        password: setupForm.password,
        privacyAccepted: true,
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to initialize Super Administrator.');
    } finally {
      setLoading(false);
    }
  };

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    if (!loginEmail.trim() || !loginPassword) {
      setAuthError('Please enter both your registered email address and password.');
      return;
    }
    setLoading(true);
    try {
      await onLogin(loginEmail.trim(), loginPassword);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Invalid email address or password.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    if (!registerForm.displayName.trim() || !registerForm.email.trim() || !registerForm.officeId) {
      setAuthError('Full name, email address, and assigned office are required.');
      return;
    }
    const strengthErr = checkClientPasswordPolicy(registerForm.password);
    if (strengthErr) {
      setAuthError(strengthErr);
      return;
    }
    if (registerForm.password !== registerForm.confirmPassword) {
      setAuthError('Password and confirmation password do not match.');
      return;
    }
    if (!registerForm.privacyAccepted) {
      setAuthError('Please acknowledge the RA 10173 Data Privacy Notice before registering.');
      return;
    }

    setLoading(true);
    try {
      const res = await onRegister({
        email: registerForm.email.trim(),
        displayName: registerForm.displayName.trim(),
        officeId: registerForm.officeId,
        position: registerForm.position.trim() || 'Monitoring Personnel',
        password: registerForm.password,
        privacyAccepted: true,
      });
      setAuthSuccess(res.message);
      setRegisterForm({
        displayName: '',
        email: '',
        officeId: offices[0]?.id || '',
        position: '',
        password: '',
        confirmPassword: '',
        privacyAccepted: false,
      });
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to submit registration request.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    if (!forgotEmail.trim()) {
      setAuthError('Enter your registered email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await onForgotPassword(forgotEmail.trim());
      setResetEmail(forgotEmail.trim());
      setAuthSuccess(res.message);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to process recovery request.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);
    if (!resetEmail.trim() || !resetToken.trim()) {
      setAuthError('Email address and one-time recovery token are required.');
      return;
    }
    const strengthErr = checkClientPasswordPolicy(resetPassword);
    if (strengthErr) {
      setAuthError(strengthErr);
      return;
    }
    if (resetPassword !== resetConfirm) {
      setAuthError('New password and confirmation do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await onResetPassword({
        email: resetEmail.trim(),
        token: resetToken.trim(),
        newPassword: resetPassword,
      });
      setLoginEmail(resetEmail.trim());
      setLoginPassword('');
      setResetToken('');
      setResetPassword('');
      setResetConfirm('');
      setMode('login');
      setAuthSuccess(res.message || 'Password reset complete. You may now sign in.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to reset password.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setAuthSuccess(null);
    setLoading(true);
    try {
      await onFirebaseGoogleSignIn();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setLoading(false);
    }
  };

  const displayAppName =
    appName?.trim() || 'LGU Bula Program Project and Activity Monitoring System';

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl grid grid-cols-1 lg:grid-cols-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
        {/* Left Official LGU Identity Panel */}
        <div className="lg:col-span-2 bg-[#163A5F] text-white p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 border border-white/15 overflow-hidden">
                {appLogoDataUrl ? (
                  <img
                    src={appLogoDataUrl}
                    alt={`${displayAppName} logo`}
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

            <h1 className="mt-8 text-[25px] font-semibold leading-snug tracking-tight text-white">
              {displayAppName}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-blue-100/90">
              Integrated Planning, Budgeting, Implementation, and Monitoring Workspace for MPDO and all Municipal Implementing Offices.
            </p>
          </div>

          <div className="mt-8 border-t border-white/15 pt-6 space-y-3 text-xs text-blue-100/90">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-teal-300 shrink-0" aria-hidden="true" />
              <span>RBAC &amp; Office Isolation · Server-Enforced Sessions</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-teal-300 shrink-0" aria-hidden="true" />
              <span>SHA-256 Hash-Chained Audit Trail · SQLite WAL Storage</span>
            </div>
          </div>
        </div>

        {/* Right Auth Panel */}
        <div className="lg:col-span-3 p-7 sm:p-9 flex flex-col justify-center">
          {setupRequired ? (
            <>
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 dark:bg-sky-950/60 border border-blue-200 dark:border-sky-800 px-2.5 py-1 text-[11px] font-semibold text-[#163A5F] dark:text-sky-300">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  First-Run Security Provisioning
                </span>
                <h2 className="mt-3 text-[20px] font-semibold text-slate-900 dark:text-slate-100">
                  Initialize Super Administrator Account
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  No password-protected administrator exists yet. Create the primary Super Administrator credentials to unlock and govern the system. Existing PPA records and offices are preserved.
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
                >
                  {authError}
                </div>
              )}

              <form onSubmit={handleSetupSubmit} className="mt-5 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="setup-name"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Full Name *
                    </label>
                    <input
                      id="setup-name"
                      type="text"
                      required
                      disabled={loading}
                      value={setupForm.displayName}
                      onChange={(e) => setSetupForm({ ...setupForm, displayName: e.target.value })}
                      placeholder="e.g. Juan Dela Cruz"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="setup-position"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Official Position
                    </label>
                    <input
                      id="setup-position"
                      type="text"
                      disabled={loading}
                      value={setupForm.position}
                      onChange={(e) => setSetupForm({ ...setupForm, position: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="setup-email"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Official Email Address *
                  </label>
                  <input
                    id="setup-email"
                    type="email"
                    required
                    autoComplete="email"
                    disabled={loading}
                    value={setupForm.email}
                    onChange={(e) => setSetupForm({ ...setupForm, email: e.target.value })}
                    placeholder="mpdo.admin@bula.gov.ph"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="setup-password"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Password *
                    </label>
                    <input
                      id="setup-password"
                      type="password"
                      required
                      autoComplete="new-password"
                      disabled={loading}
                      value={setupForm.password}
                      onChange={(e) => setSetupForm({ ...setupForm, password: e.target.value })}
                      placeholder="Min 8 chars, letters & numbers"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="setup-confirm"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Confirm Password *
                    </label>
                    <input
                      id="setup-confirm"
                      type="password"
                      required
                      autoComplete="new-password"
                      disabled={loading}
                      value={setupForm.confirmPassword}
                      onChange={(e) =>
                        setSetupForm({ ...setupForm, confirmPassword: e.target.value })
                      }
                      placeholder="Re-enter password"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                    Data Privacy Notice (Republic Act No. 10173)
                  </p>
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 max-h-20 overflow-y-auto">
                    {privacyNoticeText}
                  </p>
                  <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={setupForm.privacyAccepted}
                      onChange={(e) =>
                        setSetupForm({ ...setupForm, privacyAccepted: e.target.checked })
                      }
                      className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-[#2563EB]"
                    />
                    <span>I acknowledge the RA 10173 Data Privacy Notice and audit logging policy.</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4D7B] disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Provisioning Super Administrator...' : 'Create Super Administrator & Enter System'}
                </button>
              </form>
            </>
          ) : mode === 'login' ? (
            <>
              <div>
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-slate-100">
                  Authorized Personnel Sign In
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Sign in with your registered email address and password.
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
                >
                  {authError}
                </div>
              )}

              {authSuccess && (
                <div
                  role="status"
                  className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{authSuccess}</span>
                </div>
              )}

              {firebaseConfigured && (
                <div className="mt-5">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleGoogleLogin}
                    className="w-full flex items-center justify-center gap-2.5 rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4D7B] disabled:opacity-60 transition-colors"
                  >
                    <UserCheck className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {loading ? 'Authenticating...' : `Sign in with Google (${firebaseProjectId})`}
                    </span>
                  </button>
                  <div className="relative my-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white dark:bg-slate-900 px-3 text-slate-500 dark:text-slate-400">
                        Or continue with Credentials
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleLocalLogin} className={firebaseConfigured ? 'space-y-4' : 'mt-6 space-y-4'}>
                <div>
                  <label
                    htmlFor="login-email"
                    className="block text-[13px] font-medium text-slate-700 dark:text-slate-300"
                  >
                    Registered Email Address
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    disabled={loading}
                    value={loginEmail}
                    onChange={(e) => {
                      setLoginEmail(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="name@bula.gov.ph"
                    className="mt-1.5 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="login-password"
                      className="block text-[13px] font-medium text-slate-700 dark:text-slate-300"
                    >
                      Account Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotEmail(loginEmail);
                        setResetEmail(loginEmail);
                        switchMode('forgot');
                      }}
                      className="text-xs font-medium text-[#2563EB] dark:text-sky-400 hover:underline"
                    >
                      Forgot / Reset Password?
                    </button>
                  </div>
                  <div className="relative mt-1.5">
                    <input
                      id="login-password"
                      type={showLoginPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={loginPassword}
                      disabled={loading}
                      onChange={(e) => {
                        setLoginPassword(e.target.value);
                        setAuthError(null);
                      }}
                      placeholder="Enter your password"
                      className="block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-3 pr-10 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword((s) => !s)}
                      className="absolute right-2.5 top-2.5 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                    >
                      {showLoginPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4D7B] disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Verifying Credentials...' : 'Sign In to Monitoring Dashboard'}
                </button>
              </form>

              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={() => setShowPrivacyModal((v) => !v)}
                  className="underline hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {showPrivacyModal ? 'Hide Data Privacy Notice' : 'RA 10173 Data Privacy Notice'}
                </button>
                {allowSelfRegistration && (
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="inline-flex items-center gap-1.5 font-semibold text-[#163A5F] dark:text-sky-400 hover:underline"
                  >
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Request New Personnel Account</span>
                  </button>
                )}
              </div>

              {showPrivacyModal && (
                <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {privacyNoticeText}
                </div>
              )}
            </>
          ) : mode === 'forgot' ? (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back to Sign In</span>
                </button>
                <h2 className="mt-2 text-[20px] font-semibold text-slate-900 dark:text-slate-100">
                  Account Password Recovery
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Log a recovery request or apply a one-time recovery token issued by your MPDO Administrator.
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
                >
                  {authError}
                </div>
              )}

              {authSuccess && (
                <div
                  role="status"
                  className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200"
                >
                  {authSuccess}
                </div>
              )}

              <div className="mt-4 space-y-5">
                <form
                  onSubmit={handleForgotSubmit}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-3"
                >
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Step 1 — Log Recovery Request
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      required
                      disabled={loading}
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="Registered email address"
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="rounded-lg border border-[#163A5F] dark:border-sky-500 px-3.5 py-2 text-xs font-semibold text-[#163A5F] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-sky-950/40 disabled:opacity-50"
                    >
                      Submit Request
                    </button>
                  </div>
                </form>

                <form onSubmit={handleResetConfirmSubmit} className="space-y-3">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                    <span>Step 2 — Complete Reset with One-Time Token</span>
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Account Email *
                      </label>
                      <input
                        type="email"
                        required
                        disabled={loading}
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="name@bula.gov.ph"
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Recovery Token *
                      </label>
                      <input
                        type="text"
                        required
                        disabled={loading}
                        value={resetToken}
                        onChange={(e) => setResetToken(e.target.value.toUpperCase())}
                        placeholder="BULA-XXXXXX-XXXXXX-XXXXXX"
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono uppercase text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        New Password *
                      </label>
                      <input
                        type="password"
                        required
                        autoComplete="new-password"
                        disabled={loading}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="8+ chars, letters & numbers"
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Confirm Password *
                      </label>
                      <input
                        type="password"
                        required
                        autoComplete="new-password"
                        disabled={loading}
                        value={resetConfirm}
                        onChange={(e) => setResetConfirm(e.target.value)}
                        placeholder="Re-enter new password"
                        className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4D7B] disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Resetting Password...' : 'Reset Password & Continue'}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <>
              <div>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back to Sign In</span>
                </button>
                <h2 className="mt-2 text-[20px] font-semibold text-slate-900 dark:text-slate-100">
                  Personnel Account Registration
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  New registrations remain pending until approved by an MPDO Administrator.
                </p>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300"
                >
                  {authError}
                </div>
              )}

              {authSuccess && (
                <div
                  role="status"
                  className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200"
                >
                  {authSuccess}
                </div>
              )}

              <form onSubmit={handleRegisterSubmit} className="mt-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      disabled={loading}
                      value={registerForm.displayName}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, displayName: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Position Title
                    </label>
                    <input
                      type="text"
                      disabled={loading}
                      value={registerForm.position}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, position: e.target.value })
                      }
                      placeholder="Monitoring Focal"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Official Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      disabled={loading}
                      value={registerForm.email}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, email: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Assigned Office *
                    </label>
                    <select
                      required
                      disabled={loading}
                      value={registerForm.officeId}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, officeId: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    >
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.code} — {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Password *
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      disabled={loading}
                      value={registerForm.password}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, password: e.target.value })
                      }
                      placeholder="8+ chars, letters & numbers"
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      disabled={loading}
                      value={registerForm.confirmPassword}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, confirmPassword: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2">
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400 max-h-16 overflow-y-auto">
                    {privacyNoticeText}
                  </p>
                  <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={registerForm.privacyAccepted}
                      onChange={(e) =>
                        setRegisterForm({ ...registerForm, privacyAccepted: e.target.checked })
                      }
                      className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-[#2563EB]"
                    />
                    <span>I accept the RA 10173 Data Privacy Notice.</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-[#163A5F] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4D7B] disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Submitting Request...' : 'Submit Account Request'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
