import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  HardDrive,
  Image as ImageIcon,
  Lock,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  BackupInfo,
  DatabasePayload,
  FiscalYear,
  Office,
  SystemSettings,
  UserAccount,
} from '../../types/ppa';
import { dataService } from '../../services/dataService';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { DEFAULT_APP_NAME, DEFAULT_PRIVACY_NOTICE } from '../../utils/demoSeedData';
import { isAdminRole } from '../../utils/rbac';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { TemplateManagementSection } from './TemplateManagementSection';

interface SystemSettingsModuleProps {
  settings: SystemSettings;
  offices: Office[];
  fiscalYears: FiscalYear[];
  currentUser: UserAccount;
  theme: 'light' | 'dark';
  onChangeTheme: (nextTheme: 'light' | 'dark') => void;
  firebaseConfigured: boolean;
  firebaseProjectId: string | null;
  demoSeedAllowed?: boolean;
  onSaveSettings: (s: SystemSettings) => Promise<void>;
  onCreateOffice: (o: Office) => Promise<void>;
  onUpdateOffice: (o: Office) => Promise<void>;
  onDeleteOffice: (id: string) => Promise<void>;
  onCreateFiscalYear: (fy: FiscalYear) => Promise<void>;
  onDeleteFiscalYear: (id: string) => Promise<void>;
  onLoadSampleData: () => Promise<void>;
  onResetAllPPAData: () => Promise<void>;
  onRestoreDatabase: (db: DatabasePayload) => void;
  onNotify: (type: 'success' | 'error', msg: string) => void;
}

export function SystemSettingsModule({
  settings,
  offices,
  fiscalYears,
  currentUser,
  theme,
  onChangeTheme,
  firebaseConfigured,
  firebaseProjectId,
  demoSeedAllowed = false,
  onSaveSettings,
  onCreateOffice,
  onUpdateOffice,
  onDeleteOffice,
  onCreateFiscalYear,
  onDeleteFiscalYear,
  onLoadSampleData,
  onResetAllPPAData,
  onRestoreDatabase,
  onNotify,
}: SystemSettingsModuleProps) {
  const isAdmin = isAdminRole(currentUser.role);
  const [form, setForm] = useState<SystemSettings>({
    ...settings,
    appName: settings.appName || DEFAULT_APP_NAME,
    appLogoDataUrl: settings.appLogoDataUrl || '',
    allowSelfRegistration: Boolean(settings.allowSelfRegistration),
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes ?? 30,
    autoBackupEnabled: settings.autoBackupEnabled ?? true,
    autoBackupIntervalHours: settings.autoBackupIntervalHours ?? 24,
    backupRetentionCount: settings.backupRetentionCount ?? 15,
    privacyNoticeText: settings.privacyNoticeText || DEFAULT_PRIVACY_NOTICE,
    theme,
  });
  const [newOffice, setNewOffice] = useState({ code: '', name: '', headName: '' });
  const [editingOffice, setEditingOffice] = useState<Office | null>(null);
  const [officeEditForm, setOfficeEditForm] = useState({ code: '', name: '', headName: '' });
  const [savingOffice, setSavingOffice] = useState(false);
  const [newFyYear, setNewFyYear] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<{
    type: 'office' | 'fy';
    id: string;
    label: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState<{
    fileName: string;
    snapshot: unknown;
  } | null>(null);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [verifyingBackupName, setVerifyingBackupName] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const editOfficeModalRef = useModalFocusTrap<HTMLDivElement>(
    Boolean(isAdmin && editingOffice),
    () => setEditingOffice(null)
  );

  useEffect(() => {
    setForm({
      ...settings,
      appName: settings.appName || DEFAULT_APP_NAME,
      appLogoDataUrl: settings.appLogoDataUrl || '',
      allowSelfRegistration: Boolean(settings.allowSelfRegistration),
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes ?? 30,
      autoBackupEnabled: settings.autoBackupEnabled ?? true,
      autoBackupIntervalHours: settings.autoBackupIntervalHours ?? 24,
      backupRetentionCount: settings.backupRetentionCount ?? 15,
      privacyNoticeText: settings.privacyNoticeText || DEFAULT_PRIVACY_NOTICE,
      theme,
    });
  }, [settings, theme]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setLoadingBackups(true);
    dataService
      .listBackups()
      .then((res) => {
        if (active && Array.isArray(res.backups)) {
          setBackups(res.backups);
        }
      })
      .catch(() => {
        /* Ignore background backup listing errors */
      })
      .finally(() => {
        if (active) setLoadingBackups(false);
      });
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const handleSelectTheme = (nextTheme: 'light' | 'dark') => {
    onChangeTheme(nextTheme);
    setForm((prev) => ({ ...prev, theme: nextTheme }));
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
      onNotify('error', 'Unsupported image format. Please upload a PNG, JPG, WEBP, or SVG file.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      onNotify('error', 'Logo image exceeds 2 MB. Please choose a smaller image file.');
      return;
    }

    if (file.type === 'image/svg+xml') {
      file.text().then((svgText) => {
        if (
          /<script\b/i.test(svgText) ||
          /<foreignObject\b/i.test(svgText) ||
          /\bon[a-z]+\s*=/i.test(svgText) ||
          /javascript\s*:/i.test(svgText)
        ) {
          onNotify(
            'error',
            'SVG contains active scripts or event handlers. Upload a clean static SVG or PNG/JPG seal.'
          );
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setForm((prev) => ({ ...prev, appLogoDataUrl: reader.result as string }));
          }
        };
        reader.readAsDataURL(file);
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((prev) => ({ ...prev, appLogoDataUrl: reader.result as string }));
      } else {
        onNotify('error', 'Unable to read the selected image file.');
      }
    };
    reader.onerror = () => {
      onNotify('error', 'Failed to read the selected logo file.');
    };
    reader.readAsDataURL(file);
  };

  const handleRefreshBackups = async () => {
    if (!isAdmin) return;
    setLoadingBackups(true);
    try {
      const res = await dataService.listBackups();
      setBackups(res.backups || []);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to list snapshot backups.');
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleCreateBackup = async () => {
    if (!isAdmin) return;
    setCreatingBackup(true);
    try {
      const res = await dataService.createBackup();
      setBackups((prev) => [res.backup, ...prev.filter((b) => b.fileName !== res.backup.fileName)]);
      onNotify('success', `Database snapshot "${res.backup.fileName}" created.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to create snapshot backup.');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleVerifyBackup = async (fileName: string) => {
    if (!isAdmin) return;
    setVerifyingBackupName(fileName);
    try {
      const res = await dataService.verifyBackup(fileName);
      setBackups((prev) =>
        prev.map((b) => (b.fileName === fileName ? { ...b, verified: res.valid } : b))
      );
      onNotify(res.valid ? 'success' : 'error', res.message);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to verify snapshot integrity.');
    } finally {
      setVerifyingBackupName(null);
    }
  };

  const handleSelectRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) return;
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { snapshot?: unknown; programs?: unknown; offices?: unknown };
      const candidate =
        parsed && typeof parsed === 'object' && 'snapshot' in parsed && parsed.snapshot
          ? parsed.snapshot
          : parsed;
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        !Array.isArray((candidate as { programs?: unknown }).programs) ||
        !Array.isArray((candidate as { offices?: unknown }).offices)
      ) {
        onNotify('error', 'Selected JSON file is not a valid LGU Bula PPA database snapshot.');
        return;
      }
      setPendingRestoreSnapshot({ fileName: file.name, snapshot: candidate });
    } catch {
      onNotify('error', 'Unable to parse selected snapshot JSON file.');
    }
  };

  const persistSettings = async (override?: Partial<SystemSettings>) => {
    const nextSettings: SystemSettings = {
      ...form,
      ...override,
      appName: (override?.appName ?? form.appName ?? '').trim() || DEFAULT_APP_NAME,
      appLogoDataUrl: override?.appLogoDataUrl ?? form.appLogoDataUrl ?? '',
      theme,
    };

    if (nextSettings.firebaseWebConfigJson.trim()) {
      try {
        const parsed = JSON.parse(nextSettings.firebaseWebConfigJson.trim()) as {
          apiKey?: string;
          projectId?: string;
        };
        if (!parsed.apiKey || !parsed.projectId) {
          onNotify('error', 'Firebase Web Config JSON must include apiKey and projectId.');
          return;
        }
        localStorage.setItem('bula_ppa_firebase_config', JSON.stringify(parsed));
      } catch {
        onNotify('error', 'Invalid JSON format in Firebase Web Config.');
        return;
      }
    } else {
      localStorage.removeItem('bula_ppa_firebase_config');
    }

    await onSaveSettings(nextSettings);
  };

  const handleSaveBranding = async () => {
    if (!isAdmin) {
      onNotify('error', 'Only Administrators can modify application branding.');
      return;
    }
    const trimmedName = (form.appName || '').trim();
    if (!trimmedName) {
      onNotify('error', 'Web Application Name cannot be empty.');
      return;
    }
    setSavingBranding(true);
    try {
      await persistSettings({ appName: trimmedName });
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    const trimmedName = (form.appName || '').trim();
    if (!trimmedName) {
      onNotify('error', 'Web Application Name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await persistSettings({ appName: trimmedName });
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setSaving(false);
    }
  };

  const handleAddOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOffice.code.trim() || !newOffice.name.trim()) return;
    try {
      await onCreateOffice({
        id: `off-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        code: newOffice.code.trim().toUpperCase(),
        name: newOffice.name.trim(),
        headName: newOffice.headName.trim() || 'Department Head',
        createdAt: new Date().toISOString(),
      });
      setNewOffice({ code: '', name: '', headName: '' });
    } catch {
      /* Error notification handled in parent handler */
    }
  };

  const openEditOfficeModal = (office: Office) => {
    if (!isAdmin) return;
    setEditingOffice(office);
    setOfficeEditForm({
      code: office.code,
      name: office.name,
      headName: office.headName || 'Department Head',
    });
  };

  const handleSaveOfficeEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !editingOffice) return;
    const trimmedCode = officeEditForm.code.trim().toUpperCase();
    const trimmedName = officeEditForm.name.trim();
    const trimmedHead = officeEditForm.headName.trim() || 'Department Head';
    if (!trimmedCode || !trimmedName) {
      onNotify('error', 'Office Code and Office Name are required.');
      return;
    }
    setSavingOffice(true);
    try {
      await onUpdateOffice({
        ...editingOffice,
        code: trimmedCode,
        name: trimmedName,
        headName: trimmedHead,
      });
      setEditingOffice(null);
    } catch {
      /* Error notification handled in parent handler */
    } finally {
      setSavingOffice(false);
    }
  };

  const handleAddFy = async (e: React.FormEvent) => {
    e.preventDefault();
    const yr = newFyYear.trim();
    if (!/^\d{4}$/.test(yr)) {
      onNotify('error', 'Enter a valid 4-digit Fiscal Year (e.g. 2027).');
      return;
    }
    if (fiscalYears.some((fy) => fy.year === yr)) {
      onNotify('error', `Fiscal Year ${yr} already exists.`);
      return;
    }
    try {
      await onCreateFiscalYear({
        id: `fy-${yr}`,
        year: yr,
        label: `FY ${yr}`,
        isActive: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
      });
      setNewFyYear('');
    } catch {
      /* Error notification handled in parent handler */
    }
  };

  return (
    <div className="space-y-6">
      {/* User Appearance / Theme Preference */}
      <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
              Display Theme Preference
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Switch the entire LGU Bula PPA Monitoring interface between Light and Dark themes.
            </p>
          </div>

          <div
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-1"
            role="group"
            aria-label="Theme selection"
          >
            <button
              type="button"
              onClick={() => handleSelectTheme('light')}
              aria-pressed={theme === 'light'}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-all ${
                theme === 'light'
                  ? 'bg-white text-[#163A5F] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sun className="h-4 w-4" aria-hidden="true" />
              <span>Light Mode</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectTheme('dark')}
              aria-pressed={theme === 'dark'}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-all ${
                theme === 'dark'
                  ? 'bg-[#163A5F] text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Moon className="h-4 w-4" aria-hidden="true" />
              <span>Dark Mode</span>
            </button>
          </div>
        </div>
      </section>

      {/* Application Branding: Custom Logo & Web App Name (Administrator Only) */}
      <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
              <h3 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
                Application Branding &amp; Logo
              </h3>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-[#163A5F] dark:text-sky-300 border border-slate-200 dark:border-slate-700">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                Administrator Only
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Upload a custom LGU seal or system logo and rename the web application across the sidebar, sign-in screen, browser tab, and reports.
            </p>
          </div>

          {isAdmin && (
            <button
              type="button"
              disabled={savingBranding}
              onClick={handleSaveBranding}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>{savingBranding ? 'Saving Branding...' : 'Save Branding'}</span>
            </button>
          )}
        </div>

        {!isAdmin ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#163A5F] text-white overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700">
                {form.appLogoDataUrl ? (
                  <img
                    src={form.appLogoDataUrl}
                    alt={`${form.appName || DEFAULT_APP_NAME} logo`}
                    className="h-full w-full object-contain bg-white/10 p-1"
                  />
                ) : (
                  <BarChart3 className="h-6 w-6 text-teal-300" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {form.appName || DEFAULT_APP_NAME}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span>
                    Restricted access: Only System Administrators can upload a logo or rename the web application.
                  </span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Live Sidebar Header Preview + Logo Upload */}
            <div className="lg:col-span-5 space-y-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Application Logo Preview
              </label>
              <div className="rounded-xl bg-[#163A5F] p-4 text-white border border-slate-200/20 shadow-xs">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-200/80 mb-2.5">
                  Sidebar &amp; Portal Header Preview
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 overflow-hidden">
                    {form.appLogoDataUrl ? (
                      <img
                        src={form.appLogoDataUrl}
                        alt="Uploaded application logo preview"
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <BarChart3 className="h-6 w-6 text-teal-300" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold leading-snug text-white line-clamp-2">
                      {form.appName?.trim() || DEFAULT_APP_NAME}
                    </p>
                    <p className="mt-0.5 text-[11px] text-blue-200 truncate">
                      {form.municipalityName || 'Municipality of Bula'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogoFileChange}
                  className="hidden"
                  aria-label="Upload custom application logo"
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5 text-[#2563EB] dark:text-sky-400" aria-hidden="true" />
                  <span>{form.appLogoDataUrl ? 'Replace Logo' : 'Upload Logo'}</span>
                </button>
                {form.appLogoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, appLogoDataUrl: '' }))}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800/80 bg-red-50 dark:bg-red-950/50 px-3 py-2 text-xs font-semibold text-[#DC2626] dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Remove Logo</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Supported formats: PNG, JPG, WEBP, SVG (max 2 MB). Square or circular seals work best.
              </p>
            </div>

            {/* Web App Name Field */}
            <div className="lg:col-span-7 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="system-app-name"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Web Application Name <span className="text-[#DC2626]">*</span>
                  </label>
                  {(form.appName || '').trim() !== DEFAULT_APP_NAME && (
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, appName: DEFAULT_APP_NAME }))}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] dark:text-sky-400 hover:underline"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      <span>Reset Default Name</span>
                    </button>
                  )}
                </div>
                <input
                  id="system-app-name"
                  type="text"
                  maxLength={140}
                  required
                  value={form.appName ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, appName: e.target.value }))}
                  placeholder={DEFAULT_APP_NAME}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors"
                />
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Displayed as the official system title in the browser tab, sign-in portal, navigation sidebar, and printable reports.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* LGU Header & Report Signatories */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
              LGU Identity &amp; Official Report Signatories
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Printed on PDF reports, Excel headers, and official MPDO monitoring outputs.
            </p>
          </div>
          {isAdmin && (
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white transition-colors shadow-xs disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Municipality Name</label>
            <input
              disabled={!isAdmin}
              type="text"
              value={form.municipalityName}
              onChange={(e) => setForm({ ...form, municipalityName: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Province Name</label>
            <input
              disabled={!isAdmin}
              type="text"
              value={form.provinceName}
              onChange={(e) => setForm({ ...form, provinceName: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Monitoring Office</label>
            <input
              disabled={!isAdmin}
              type="text"
              value={form.officeTitle}
              onChange={(e) => setForm({ ...form, officeTitle: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Prepared By</label>
            <input
              disabled={!isAdmin}
              type="text"
              value={form.preparedByName}
              onChange={(e) => setForm({ ...form, preparedByName: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              placeholder="Name"
            />
            <input
              disabled={!isAdmin}
              type="text"
              value={form.preparedByTitle}
              onChange={(e) => setForm({ ...form, preparedByTitle: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              placeholder="Position Title"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Reviewed By</label>
            <input
              disabled={!isAdmin}
              type="text"
              value={form.reviewedByName}
              onChange={(e) => setForm({ ...form, reviewedByName: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              placeholder="Name"
            />
            <input
              disabled={!isAdmin}
              type="text"
              value={form.reviewedByTitle}
              onChange={(e) => setForm({ ...form, reviewedByTitle: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              placeholder="Position Title"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Approved By</label>
            <input
              disabled={!isAdmin}
              type="text"
              value={form.approvedByName}
              onChange={(e) => setForm({ ...form, approvedByName: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              placeholder="Name"
            />
            <input
              disabled={!isAdmin}
              type="text"
              value={form.approvedByTitle}
              onChange={(e) => setForm({ ...form, approvedByTitle: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              placeholder="Position Title"
            />
          </div>
        </div>

        {/* Security, Session, Automated Backup & RA 10173 Data Privacy Policy */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-[#163A5F] dark:text-sky-400" />
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Security Policy, Session Timeout, Backup Retention &amp; RA 10173 Privacy Notice
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Idle Session Timeout (Minutes)
              </label>
              <input
                disabled={!isAdmin}
                type="number"
                min={5}
                max={480}
                value={form.sessionTimeoutMinutes ?? 30}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sessionTimeoutMinutes: Math.max(5, Math.min(480, Number(e.target.value) || 30)),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Auto-Backup Interval (Hours)
              </label>
              <input
                disabled={!isAdmin || !form.autoBackupEnabled}
                type="number"
                min={1}
                max={168}
                value={form.autoBackupIntervalHours ?? 24}
                onChange={(e) =>
                  setForm({
                    ...form,
                    autoBackupIntervalHours: Math.max(1, Math.min(168, Number(e.target.value) || 24)),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Snapshot Retention Count
              </label>
              <input
                disabled={!isAdmin}
                type="number"
                min={3}
                max={100}
                value={form.backupRetentionCount ?? 15}
                onChange={(e) =>
                  setForm({
                    ...form,
                    backupRetentionCount: Math.max(3, Math.min(100, Number(e.target.value) || 15)),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
              />
            </div>

            <div className="flex flex-col justify-center gap-2 pt-2 text-xs text-slate-700 dark:text-slate-300">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  disabled={!isAdmin}
                  type="checkbox"
                  checked={Boolean(form.allowSelfRegistration)}
                  onChange={(e) => setForm({ ...form, allowSelfRegistration: e.target.checked })}
                  className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB]"
                />
                <span>Allow Self-Registration (Admin Approval)</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  disabled={!isAdmin}
                  type="checkbox"
                  checked={form.autoBackupEnabled ?? true}
                  onChange={(e) => setForm({ ...form, autoBackupEnabled: e.target.checked })}
                  className="rounded border-slate-300 dark:border-slate-600 text-[#2563EB]"
                />
                <span>Enable Scheduled Automated Backups</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Data Privacy Notice Text (RA 10173 — Shown at Sign-In / Registration)
            </label>
            <textarea
              disabled={!isAdmin}
              rows={3}
              value={form.privacyNoticeText ?? ''}
              onChange={(e) => setForm({ ...form, privacyNoticeText: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none disabled:bg-slate-50 dark:disabled:bg-slate-800/60"
            />
          </div>
        </div>

        {/* Firebase Configuration Section */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#163A5F] dark:text-sky-400" />
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Firebase Authentication &amp; Cloud Firestore Configuration
            </h4>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {firebaseConfigured
              ? `Connected to Firebase project: ${firebaseProjectId}`
              : 'Currently running on persistent ACID SQLite WAL database storage (.data/bula-ppa.sqlite). To enable Google Sign-In ID token verification, provide your Firebase Web App Config JSON below.'}
          </p>
          {isAdmin && (
            <textarea
              rows={3}
              value={form.firebaseWebConfigJson}
              onChange={(e) => setForm({ ...form, firebaseWebConfigJson: e.target.value })}
              placeholder='Optional: {"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}'
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors"
            />
          )}
        </div>
      </form>

      {/* Official Document Templates Management */}
      <TemplateManagementSection isAdmin={isAdmin} onNotify={onNotify} />

      {/* Offices & Fiscal Years */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#163A5F] dark:text-sky-400" />
              <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">
                Municipal Offices / Implementing Units
              </h3>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Adding a new office automatically provisions a dedicated Office Monitoring (ENCODER) account for isolated entry and monitoring.
          </p>

          {isAdmin && (
            <form onSubmit={handleAddOffice} className="grid grid-cols-1 sm:grid-cols-6 gap-2">
              <input
                type="text"
                value={newOffice.code}
                onChange={(e) => setNewOffice({ ...newOffice, code: e.target.value })}
                placeholder="Code (e.g. MEO)"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors"
              />
              <input
                type="text"
                value={newOffice.name}
                onChange={(e) => setNewOffice({ ...newOffice, name: e.target.value })}
                placeholder="Office / Department Name"
                className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors"
              />
              <input
                type="text"
                value={newOffice.headName}
                onChange={(e) => setNewOffice({ ...newOffice, headName: e.target.value })}
                placeholder="Department Head (optional)"
                className="sm:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white transition-colors shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto text-xs">
            {offices.map((o) => (
              <div key={o.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div>
                    <span className="font-mono font-bold text-[#163A5F] dark:text-sky-400">{o.code}</span>
                    <span className="text-slate-400"> · </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">{o.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    Head: {o.headName || 'Department Head'}
                  </p>
                </div>
                {isAdmin && (
                  <div className="inline-flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditOfficeModal(o)}
                      className="rounded-lg p-1 text-[#2563EB] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors"
                      title="Edit Office"
                      aria-label={`Edit office ${o.name}`}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDeleteItem({
                          type: 'office',
                          id: o.id,
                          label: `${o.code} — ${o.name}`,
                        })
                      }
                      className="rounded-lg p-1 text-[#DC2626] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
                      title="Delete Office"
                      aria-label={`Delete office ${o.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#163A5F] dark:text-sky-400" />
            <h3 className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">Fiscal Years</h3>
          </div>

          {isAdmin && (
            <form onSubmit={handleAddFy} className="flex items-center gap-2">
              <input
                type="text"
                value={newFyYear}
                onChange={(e) => setNewFyYear(e.target.value)}
                placeholder="Year (e.g. 2027)"
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none transition-colors"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white transition-colors shadow-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Add FY
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {fiscalYears.map((fy) => (
              <div key={fy.id} className="py-2.5 flex items-center justify-between">
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{fy.label}</span>
                {isAdmin && fiscalYears.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmDeleteItem({
                        type: 'fy',
                        id: fy.id,
                        label: fy.label,
                      })
                    }
                    className="rounded-lg p-1 text-[#DC2626] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
                    title="Delete Fiscal Year"
                    aria-label={`Delete ${fy.label}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {isAdmin && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Database Maintenance</h4>
                <div className="flex flex-wrap gap-2">
                  {demoSeedAllowed && (
                    <button
                      type="button"
                      onClick={onLoadSampleData}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Database className="h-3.5 w-3.5" /> Load Sample LGU Bula Dataset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmReset(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/60 px-3 py-1.5 text-xs font-semibold text-[#DC2626] dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear All PPA Records
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Automated Snapshots &amp; Recovery
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={restoreInputRef}
                      type="file"
                      accept=".json,application/json"
                      onChange={handleSelectRestoreFile}
                      className="hidden"
                      aria-label="Restore database snapshot file"
                    />
                    <button
                      type="button"
                      disabled={loadingBackups}
                      onClick={handleRefreshBackups}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${loadingBackups ? 'animate-spin' : ''}`} aria-hidden="true" />
                      <span>Refresh</span>
                    </button>
                    <button
                      type="button"
                      disabled={creatingBackup}
                      onClick={handleCreateBackup}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      <Database className="h-3 w-3" aria-hidden="true" />
                      <span>{creatingBackup ? 'Creating...' : 'Create Snapshot'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={restoringBackup}
                      onClick={() => restoreInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/70 disabled:opacity-50"
                    >
                      <Upload className="h-3 w-3" aria-hidden="true" />
                      <span>{restoringBackup ? 'Restoring...' : 'Restore Snapshot (.json)'}</span>
                    </button>
                  </div>
                </div>

                {backups.length === 0 ? (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    No snapshots saved yet. Click &ldquo;Create Snapshot&rdquo; to save a SHA-256 verified JSON recovery point.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto text-[11px]">
                    {backups.slice(0, 12).map((b) => (
                      <div key={b.fileName} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="font-mono font-medium text-slate-800 dark:text-slate-200 truncate">
                              {b.fileName}
                            </p>
                            {b.trigger && (
                              <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[9.5px] font-mono font-semibold text-slate-600 dark:text-slate-300">
                                {b.trigger}
                              </span>
                            )}
                            {b.verified && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                Verified
                              </span>
                            )}
                          </div>
                          <p className="text-slate-500 dark:text-slate-400">
                            {new Date(b.createdAt).toLocaleString('en-PH')} · {(b.sizeBytes / 1024).toFixed(1)} KB
                            {b.sha256 ? ` · SHA-256:${b.sha256.slice(0, 10)}` : ''}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={verifyingBackupName === b.fileName}
                            onClick={() => handleVerifyBackup(b.fileName)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                          >
                            <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                            <span>{verifyingBackupName === b.fileName ? 'Checking...' : 'Verify'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              dataService.downloadBackup(b.fileName).catch((err) => {
                                onNotify(
                                  'error',
                                  err instanceof Error ? err.message : 'Failed to download backup snapshot.'
                                );
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-[#163A5F] dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <Download className="h-3 w-3" aria-hidden="true" />
                            <span>Download</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(pendingRestoreSnapshot)}
        title="Restore Database Snapshot"
        message={`Restoring "${pendingRestoreSnapshot?.fileName || ''}" will replace current Offices, Users, Fiscal Years, Programs, Activities, Remarks, and Settings inside the SQLite database. Continue?`}
        confirmLabel={restoringBackup ? 'Restoring...' : 'Restore Snapshot'}
        onCancel={() => setPendingRestoreSnapshot(null)}
        onConfirm={async () => {
          if (!pendingRestoreSnapshot) return;
          const target = pendingRestoreSnapshot;
          setPendingRestoreSnapshot(null);
          setRestoringBackup(true);
          try {
            const res = await dataService.restoreBackup(target.snapshot);
            onRestoreDatabase(res.db);
            onNotify('success', `Restored database snapshot "${target.fileName}".`);
          } catch (err) {
            onNotify('error', err instanceof Error ? err.message : 'Failed to restore snapshot.');
          } finally {
            setRestoringBackup(false);
          }
        }}
      />

      <ConfirmDialog
        open={confirmReset}
        title="Clear All PPA Records"
        message="This will permanently delete all Programs, Projects, Activities, and Monitoring Remarks from the database. Offices, Users, and Fiscal Years will be preserved."
        confirmLabel="Clear All PPA Data"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          await onResetAllPPAData();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteItem)}
        title={confirmDeleteItem?.type === 'office' ? 'Delete Municipal Office' : 'Delete Fiscal Year'}
        message={
          confirmDeleteItem?.type === 'office'
            ? `Are you sure you want to remove office "${confirmDeleteItem.label}"?`
            : `Are you sure you want to remove "${confirmDeleteItem?.label}"?`
        }
        confirmLabel={confirmDeleteItem?.type === 'office' ? 'Delete Office' : 'Delete Fiscal Year'}
        onCancel={() => setConfirmDeleteItem(null)}
        onConfirm={async () => {
          if (confirmDeleteItem) {
            if (confirmDeleteItem.type === 'office') {
              await onDeleteOffice(confirmDeleteItem.id);
            } else {
              await onDeleteFiscalYear(confirmDeleteItem.id);
            }
          }
          setConfirmDeleteItem(null);
        }}
      />

      {/* Edit Municipal Office / Implementing Unit Modal (Administrator Only) */}
      {isAdmin && editingOffice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] dark:bg-slate-950/75 p-4">
          <div
            ref={editOfficeModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-office-modal-title"
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3
                  id="edit-office-modal-title"
                  className="text-[18px] font-semibold text-slate-900 dark:text-slate-100"
                >
                  Edit Municipal Office / Unit
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Updating the office name automatically syncs linked users and PPA records.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingOffice(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Close edit office modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveOfficeEdit} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="edit-office-code"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Office Code <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  id="edit-office-code"
                  type="text"
                  required
                  maxLength={24}
                  value={officeEditForm.code}
                  onChange={(e) =>
                    setOfficeEditForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))
                  }
                  placeholder="e.g. MEO"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono uppercase text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-office-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Office / Implementing Unit Name <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  id="edit-office-name"
                  type="text"
                  required
                  maxLength={140}
                  value={officeEditForm.name}
                  onChange={(e) =>
                    setOfficeEditForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Municipal Engineering Office"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="edit-office-head"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Department Head
                </label>
                <input
                  id="edit-office-head"
                  type="text"
                  maxLength={120}
                  value={officeEditForm.headName}
                  onChange={(e) =>
                    setOfficeEditForm((prev) => ({ ...prev, headName: e.target.value }))
                  }
                  placeholder="Department Head"
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingOffice(null)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOffice}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  <span>{savingOffice ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
