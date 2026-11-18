import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  CheckSquare,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Scale,
  Search,
  Settings,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  Activity,
  AuditLog,
  AuthDirectoryUser,
  DatabasePayload,
  FiscalYear,
  ImplementationStatus,
  Office,
  Program,
  RemarkLog,
  SidebarModule,
  SystemSettings,
  UploadedDocument,
  UserAccount,
} from './types/ppa';
import { computeActivityMetrics } from './utils/calculations';
import {
  DEFAULT_APP_NAME,
  DEFAULT_FISCAL_YEARS,
  DEFAULT_OFFICES,
  DEFAULT_SETTINGS,
  DEFAULT_USERS,
} from './utils/demoSeedData';
import { exportMonitoringWorkbook, triggerBlobDownload } from './utils/excelService';
import { buildAuditLog, dataService } from './services/dataService';
import {
  initFirebaseServices,
  signInWithGoogleFirebase,
  signOutFirebase,
  testFirestoreConnection,
} from './services/firebaseClient';
import { LoginView } from './components/LoginView';
import { ToastBanner, ToastMessage } from './components/ui/ToastBanner';
import { DashboardModule } from './components/modules/DashboardModule';
import { ProgramsActivitiesModule } from './components/modules/ProgramsActivitiesModule';
import { BudgetManagementModule } from './components/modules/BudgetManagementModule';
import { AccomplishmentStatusModule } from './components/modules/AccomplishmentStatusModule';
import { MonitoringEvaluationModule } from './components/modules/MonitoringEvaluationModule';
import { ReportsModule } from './components/modules/ReportsModule';
import { ExcelImportExportModule } from './components/modules/ExcelImportExportModule';
import { UserManagementModule } from './components/modules/UserManagementModule';
import { SystemSettingsModule } from './components/modules/SystemSettingsModule';
import { GadFundSummaryModule } from './components/modules/GadFundSummaryModule';

type NavGroup = 'Core Operations' | 'Monitoring & Reporting' | 'Administration';

const NAV_ITEMS: {
  id: SidebarModule;
  label: string;
  group: NavGroup;
  Icon: typeof LayoutDashboard;
}[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Core Operations', Icon: LayoutDashboard },
  {
    id: 'programs',
    label: 'Programs and Activities',
    group: 'Core Operations',
    Icon: FolderKanban,
  },
  { id: 'budget', label: 'Budget Management', group: 'Core Operations', Icon: Wallet },
  {
    id: 'gad',
    label: 'GAD Fund Summary',
    group: 'Monitoring & Reporting',
    Icon: Scale,
  },
  {
    id: 'status',
    label: 'Accomplishment Tracking',
    group: 'Monitoring & Reporting',
    Icon: CheckSquare,
  },
  {
    id: 'evaluation',
    label: 'Monitoring and Evaluation',
    group: 'Monitoring & Reporting',
    Icon: ClipboardCheck,
  },
  { id: 'reports', label: 'Reports', group: 'Monitoring & Reporting', Icon: FileText },
  {
    id: 'excel',
    label: 'Excel Import/Export',
    group: 'Monitoring & Reporting',
    Icon: FileSpreadsheet,
  },
  { id: 'users', label: 'User Management', group: 'Administration', Icon: Users },
  { id: 'settings', label: 'System Settings', group: 'Administration', Icon: Settings },
];

const NAV_GROUPS: NavGroup[] = ['Core Operations', 'Monitoring & Reporting', 'Administration'];

const THEME_STORAGE_KEY = 'bula_ppa_theme';
const SIDEBAR_COLLAPSED_KEY = 'bula_ppa_sidebar_collapsed';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function App() {
  const [db, setDb] = useState<DatabasePayload>({
    users: DEFAULT_USERS,
    offices: DEFAULT_OFFICES,
    fiscalYears: DEFAULT_FISCAL_YEARS,
    programs: [],
    activities: [],
    remarksLogs: [],
    uploadedDocuments: [],
    auditLogs: [],
    settings: DEFAULT_SETTINGS,
  });
  const [authDirectory, setAuthDirectory] = useState<AuthDirectoryUser[]>([]);
  const [directoryOffices, setDirectoryOffices] = useState<Office[]>(DEFAULT_OFFICES);
  const [authBranding, setAuthBranding] = useState<{
    appName: string;
    appLogoDataUrl: string;
    municipalityName: string;
  }>({
    appName: DEFAULT_APP_NAME,
    appLogoDataUrl: '',
    municipalityName: DEFAULT_SETTINGS.municipalityName,
  });
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [activeModule, setActiveModule] = useState<SidebarModule>('dashboard');
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<string>('2026');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [programJumpFilter, setProgramJumpFilter] = useState<{
    query: string;
    officeId?: string;
    nonce: number;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const brandAppName = currentUser
    ? db.settings.appName?.trim() || DEFAULT_APP_NAME
    : authBranding.appName?.trim() || DEFAULT_APP_NAME;
  const brandLogoUrl = currentUser
    ? db.settings.appLogoDataUrl?.trim() || ''
    : authBranding.appLogoDataUrl?.trim() || '';

  useEffect(() => {
    document.title = brandAppName;
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute('content', brandAppName);
    }
  }, [brandAppName]);

  const firebaseState = useMemo(() => initFirebaseServices(), []);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const refreshAuthDirectory = useCallback(async () => {
    try {
      const dir = await dataService.getAuthDirectory();
      setAuthDirectory(dir.users);
      setDirectoryOffices(dir.offices);
      setAuthBranding(dir.branding);
    } catch {
      // non-fatal during background refresh
    }
  }, []);

  const loadAuthenticatedWorkspace = useCallback(async () => {
    try {
      const data = await dataService.bootstrap();
      setDb(data);
      if (data.settings?.defaultFiscalYear) {
        setSelectedFiscalYear(data.settings.defaultFiscalYear);
      }
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (!storedTheme && (data.settings?.theme === 'dark' || data.settings?.theme === 'light')) {
        setTheme(data.settings.theme);
      }
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      if (status === 401) {
        setCurrentUser(null);
      }
      notify(
        'error',
        err instanceof Error ? err.message : 'Failed to load monitoring database.'
      );
    }
  }, [notify]);

  useEffect(() => {
    let active = true;
    const initAuth = async () => {
      try {
        const [dirRes, sessionRes] = await Promise.all([
          dataService.getAuthDirectory(),
          dataService.getSession(),
        ]);
        if (!active) return;
        setAuthDirectory(dirRes.users);
        setDirectoryOffices(dirRes.offices);
        setAuthBranding(dirRes.branding);

        if (sessionRes.authenticated && sessionRes.user) {
          setCurrentUser(sessionRes.user);
          await loadAuthenticatedWorkspace();
        }
      } catch (err) {
        if (active) {
          notify(
            'error',
            err instanceof Error ? err.message : 'Failed to initialize monitoring session.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    initAuth();
    if (firebaseState.configured && firebaseState.db) {
      testFirestoreConnection(firebaseState.db);
    }
    return () => {
      active = false;
    };
  }, [firebaseState, loadAuthenticatedWorkspace, notify]);

  const computedActivities = useMemo(
    () => db.activities.map(computeActivityMetrics),
    [db.activities]
  );

  const isOfficeScoped =
    currentUser?.role === 'ENCODER' && Boolean(currentUser.officeId);

  const scopedRawActivities = useMemo(() => {
    if (!isOfficeScoped || !currentUser) return db.activities;
    const offId = currentUser.officeId;
    const offNameLower = currentUser.officeName.toLowerCase();
    return db.activities.filter(
      (a) => a.officeId === offId || a.officeName.toLowerCase() === offNameLower
    );
  }, [db.activities, isOfficeScoped, currentUser]);

  const scopedActivities = useMemo(() => {
    if (!isOfficeScoped || !currentUser) return computedActivities;
    const offId = currentUser.officeId;
    const offNameLower = currentUser.officeName.toLowerCase();
    return computedActivities.filter(
      (a) => a.officeId === offId || a.officeName.toLowerCase() === offNameLower
    );
  }, [computedActivities, isOfficeScoped, currentUser]);

  const scopedPrograms = useMemo(() => {
    if (!isOfficeScoped || !currentUser) return db.programs;
    const offId = currentUser.officeId;
    const offNameLower = currentUser.officeName.toLowerCase();
    const activityParentIds = new Set(scopedActivities.map((a) => a.programId));
    return db.programs.filter(
      (p) =>
        p.officeId === offId ||
        p.officeName.toLowerCase() === offNameLower ||
        activityParentIds.has(p.id)
    );
  }, [db.programs, scopedActivities, isOfficeScoped, currentUser]);

  const scopedRemarksLogs = useMemo(() => {
    if (!isOfficeScoped) return db.remarksLogs;
    const actIds = new Set(scopedActivities.map((a) => a.id));
    return db.remarksLogs.filter((r) => actIds.has(r.activityId));
  }, [db.remarksLogs, scopedActivities, isOfficeScoped]);

  const scopedAuditLogs = useMemo(() => {
    if (!isOfficeScoped || !currentUser) return db.auditLogs;
    const officeUids = new Set(
      db.users.filter((u) => u.officeId === currentUser.officeId).map((u) => u.uid)
    );
    officeUids.add(currentUser.uid);
    return db.auditLogs.filter((l) => officeUids.has(l.userUid));
  }, [db.auditLogs, db.users, isOfficeScoped, currentUser]);

  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) => item.id !== 'users' || currentUser?.role === 'ADMINISTRATOR'
      ),
    [currentUser?.role]
  );

  useEffect(() => {
    if (activeModule === 'users' && currentUser && currentUser.role !== 'ADMINISTRATOR') {
      setActiveModule('dashboard');
    }
  }, [activeModule, currentUser]);

  const globalSearchResults = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q) return { programs: [], activities: [], offices: [] };

    const matchingPrograms = scopedPrograms
      .filter((p) =>
        `${p.aipRefCode} ${p.title} ${p.sector} ${p.officeName} ${p.fiscalYear}`
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 5);

    const matchingActivities = scopedActivities
      .filter((a) =>
        `${a.referenceNumber} ${a.description} ${a.targetOutputs} ${a.officeName} ${a.sourceOfFund || ''}`
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 6);

    const visibleOffices =
      isOfficeScoped && currentUser
        ? db.offices.filter((o) => o.id === currentUser.officeId)
        : db.offices;
    const matchingOffices = visibleOffices
      .filter((o) => `${o.code} ${o.name} ${o.headName}`.toLowerCase().includes(q))
      .slice(0, 4);

    return {
      programs: matchingPrograms,
      activities: matchingActivities,
      offices: matchingOffices,
    };
  }, [globalSearchQuery, scopedPrograms, scopedActivities, db.offices, isOfficeScoped, currentUser]);

  const jumpToProgramsWithFilter = (query: string, officeId?: string) => {
    setProgramJumpFilter({ query, officeId, nonce: Date.now() });
    setActiveModule('programs');
    setGlobalSearchOpen(false);
  };

  const handleLocalLogin = async (userId: string, passcode: string) => {
    const res = await dataService.login(userId, passcode);
    setCurrentUser(res.user);
    await loadAuthenticatedWorkspace();
  };

  const handleFirebaseGoogleSignIn = async () => {
    if (!firebaseState.auth) return;
    const cred = await signInWithGoogleFirebase(firebaseState.auth);
    const idToken = await cred.user.getIdToken();
    const res = await dataService.firebaseLogin(idToken);
    setCurrentUser(res.user);
    await loadAuthenticatedWorkspace();
  };

  const handleLogout = async () => {
    await dataService.logout().catch(() => {});
    if (firebaseState.configured && firebaseState.auth) {
      await signOutFirebase(firebaseState.auth).catch(() => {});
    }
    setCurrentUser(null);
    setActiveModule('dashboard');
    await refreshAuthDirectory();
  };

  // CRUD Handlers
  const handleCreateProgram = async (program: Program) => {
    if (!currentUser) return;
    const payload: Program = isOfficeScoped
      ? {
          ...program,
          officeId: currentUser.officeId,
          officeName: currentUser.officeName,
        }
      : program;
    const log = buildAuditLog(
      currentUser,
      'CREATE',
      'Program',
      payload.id,
      `Created program ${payload.aipRefCode}: ${payload.title}`
    );
    try {
      const res = await dataService.createProgram(payload, log);
      const saved = res.program || payload;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        programs: [...prev.programs, saved],
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', `Program "${saved.title}" added.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create program.');
      throw err;
    }
  };

  const handleUpdateProgram = async (program: Program) => {
    if (!currentUser) return;
    const payload: Program = isOfficeScoped
      ? {
          ...program,
          officeId: currentUser.officeId,
          officeName: currentUser.officeName,
        }
      : program;
    const log = buildAuditLog(
      currentUser,
      'UPDATE',
      'Program',
      payload.id,
      `Updated program ${payload.aipRefCode}: ${payload.title}`
    );
    try {
      const res = await dataService.updateProgram(payload, log);
      const saved = res.program || payload;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        programs: prev.programs.map((p) => (p.id === saved.id ? saved : p)),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', `Program "${saved.title}" updated.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update program.');
      throw err;
    }
  };

  const handleDeleteProgram = async (id: string) => {
    if (!currentUser) return;
    const target = db.programs.find((p) => p.id === id);
    const log = buildAuditLog(
      currentUser,
      'DELETE',
      'Program',
      id,
      `Deleted program ${target?.aipRefCode || id}: ${target?.title || ''}`
    );
    try {
      const res = await dataService.deleteProgram(id, log);
      const recordedLog = res.auditLog || log;
      const removedActIds = new Set(
        db.activities.filter((a) => a.programId === id || a.subprogramId === id).map((a) => a.id)
      );
      setDb((prev) => ({
        ...prev,
        programs: prev.programs.filter((p) => p.id !== id && p.parentProgramId !== id),
        activities: prev.activities.filter((a) => !removedActIds.has(a.id)),
        remarksLogs: prev.remarksLogs.filter((r) => !removedActIds.has(r.activityId)),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', 'Program and linked activities deleted.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete program.');
    }
  };

  const handleCreateActivity = async (activity: Activity) => {
    if (!currentUser) return;
    const payload: Activity = isOfficeScoped
      ? {
          ...activity,
          officeId: currentUser.officeId,
          officeName: currentUser.officeName,
        }
      : activity;
    const log = buildAuditLog(
      currentUser,
      'CREATE',
      'Activity',
      payload.id,
      `Created PPA ${payload.referenceNumber}: ${payload.description}`
    );
    try {
      const res = await dataService.createActivity(payload, log);
      const saved = res.activity || payload;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        activities: [...prev.activities, saved],
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', `Activity "${saved.referenceNumber}" saved.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create activity.');
      throw err;
    }
  };

  const handleUpdateActivity = async (activity: Activity) => {
    if (!currentUser) return;
    const payload: Activity = isOfficeScoped
      ? {
          ...activity,
          officeId: currentUser.officeId,
          officeName: currentUser.officeName,
        }
      : activity;
    const log = buildAuditLog(
      currentUser,
      'UPDATE',
      'Activity',
      payload.id,
      `Updated PPA ${payload.referenceNumber}: ${payload.description}`
    );
    try {
      const res = await dataService.updateActivity(payload, log);
      const saved = res.activity || payload;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        activities: prev.activities.map((a) => (a.id === saved.id ? saved : a)),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', `Updated "${saved.referenceNumber}" successfully.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update activity.');
      throw err;
    }
  };

  const handleDeleteActivity = async (id: string) => {
    if (!currentUser) return;
    const target = db.activities.find((a) => a.id === id);
    const log = buildAuditLog(
      currentUser,
      'DELETE',
      'Activity',
      id,
      `Deleted PPA ${target?.referenceNumber || id}: ${target?.description || ''}`
    );
    try {
      const res = await dataService.deleteActivity(id, log);
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        activities: prev.activities.filter((a) => a.id !== id),
        remarksLogs: prev.remarksLogs.filter((r) => r.activityId !== id),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', 'Activity deleted.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete activity.');
    }
  };

  const handleUpdateStatus = async (
    activity: Activity,
    newStatus: ImplementationStatus,
    remarks: string
  ) => {
    if (!currentUser) return;
    const statusChanged = activity.status !== newStatus;
    const updated: Activity = {
      ...activity,
      status: newStatus,
      remarks,
      updatedBy: currentUser.uid,
      updatedAt: new Date().toISOString(),
    };
    const log = buildAuditLog(
      currentUser,
      statusChanged ? 'STATUS_CHANGE' : 'UPDATE',
      'Activity',
      activity.id,
      statusChanged
        ? `Changed status of ${activity.referenceNumber} to ${newStatus}`
        : `Updated remarks for ${activity.referenceNumber}`
    );
    try {
      const res = await dataService.updateActivity(updated, log);
      const saved = res.activity || updated;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        activities: prev.activities.map((a) => (a.id === saved.id ? saved : a)),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify(
        'success',
        statusChanged
          ? `Status updated to ${newStatus}.`
          : `Remarks saved for ${activity.referenceNumber}.`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update status.');
      throw err;
    }
  };

  const handleBulkUpdateActivityStatus = async (
    ids: string[],
    newStatus: ImplementationStatus
  ) => {
    if (!currentUser || ids.length === 0) return;
    const targetIds = new Set(ids);
    const targets = db.activities.filter((a) => targetIds.has(a.id));
    if (targets.length === 0) return;

    const now = new Date().toISOString();
    const updatedMap = new Map<string, Activity>();
    const newLogs: AuditLog[] = [];

    try {
      for (const act of targets) {
        const updated: Activity = {
          ...act,
          status: newStatus,
          updatedBy: currentUser.uid,
          updatedAt: now,
        };
        const log = buildAuditLog(
          currentUser,
          'STATUS_CHANGE',
          'Activity',
          act.id,
          `Bulk updated status of ${act.referenceNumber} to ${newStatus}`
        );
        const res = await dataService.updateActivity(updated, log);
        updatedMap.set(updated.id, res.activity || updated);
        newLogs.unshift(res.auditLog || log);
      }

      setDb((prev) => ({
        ...prev,
        activities: prev.activities.map((a) => updatedMap.get(a.id) ?? a),
        auditLogs: [...newLogs, ...prev.auditLogs],
      }));
      notify(
        'success',
        `Updated status of ${updatedMap.size} ${updatedMap.size === 1 ? 'activity' : 'activities'} to ${newStatus}.`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Bulk status update failed.');
      throw err;
    }
  };

  const handleBulkDeleteActivities = async (ids: string[]) => {
    if (!currentUser || ids.length === 0) return;
    const targetIds = new Set(ids);
    const targets = db.activities.filter((a) => targetIds.has(a.id));
    if (targets.length === 0) return;

    const deletedIds = new Set<string>();
    const newLogs: AuditLog[] = [];
    try {
      for (const act of targets) {
        const log = buildAuditLog(
          currentUser,
          'DELETE',
          'Activity',
          act.id,
          `Bulk deleted PPA ${act.referenceNumber}: ${act.description}`
        );
        const res = await dataService.deleteActivity(act.id, log);
        deletedIds.add(act.id);
        newLogs.unshift(res.auditLog || log);
      }

      setDb((prev) => ({
        ...prev,
        activities: prev.activities.filter((a) => !deletedIds.has(a.id)),
        remarksLogs: prev.remarksLogs.filter((r) => !deletedIds.has(r.activityId)),
        auditLogs: [...newLogs, ...prev.auditLogs],
      }));
      notify(
        'success',
        `Deleted ${deletedIds.size} selected ${deletedIds.size === 1 ? 'activity' : 'activities'}.`
      );
    } catch (err) {
      if (deletedIds.size > 0) {
        setDb((prev) => ({
          ...prev,
          activities: prev.activities.filter((a) => !deletedIds.has(a.id)),
          remarksLogs: prev.remarksLogs.filter((r) => !deletedIds.has(r.activityId)),
          auditLogs: [...newLogs, ...prev.auditLogs],
        }));
      }
      notify('error', err instanceof Error ? err.message : 'Bulk delete failed.');
    }
  };

  const handleReorderActivities = async (updates: { id: string; orderIndex: number }[]) => {
    if (!currentUser || updates.length === 0) return;
    const orderMap = new Map(updates.map((u) => [u.id, u.orderIndex]));
    const firstAct = db.activities.find((a) => orderMap.has(a.id));
    const log = buildAuditLog(
      currentUser,
      'UPDATE',
      'ActivitySequence',
      firstAct?.programId || 'reorder',
      `Reordered ${updates.length} PPA item(s) in program sequence`
    );
    try {
      const res = await dataService.reorderActivities(updates, log);
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        activities: prev.activities.map((a) => {
          const nextIdx = orderMap.get(a.id);
          return nextIdx !== undefined ? { ...a, orderIndex: nextIdx } : a;
        }),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', 'PPA priority sequence updated.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to reorder activities.');
      throw err;
    }
  };

  const handleAddRemark = async (remark: RemarkLog) => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'CREATE',
      'Remark',
      remark.id,
      `Added M&E observation for activity ${remark.activityId}`
    );
    try {
      const res = await dataService.createRemark(remark, log);
      const savedRemark = res.remark || remark;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        remarksLogs: [savedRemark, ...prev.remarksLogs],
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', 'Monitoring observation logged.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to log remark.');
      throw err;
    }
  };

  const handleDeleteRemark = async (id: string) => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'DELETE',
      'Remark',
      id,
      `Deleted monitoring observation ${id}`
    );
    try {
      const res = await dataService.deleteRemark(id, log);
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        remarksLogs: prev.remarksLogs.filter((r) => r.id !== id),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', 'Observation deleted.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete observation.');
    }
  };

  const handleCommitExcelImport = async (payload: {
    newPrograms: Program[];
    newActivities: Activity[];
    updatedActivities: Activity[];
    newOffices: Office[];
    uploadedDocument: UploadedDocument;
  }) => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'IMPORT',
      'ExcelWorkbook',
      payload.uploadedDocument.id,
      `Imported ${payload.uploadedDocument.fileName} (${payload.uploadedDocument.recordsImported} records)`
    );
    const res = await dataService.importBatch({ ...payload, auditLog: log });
    setDb(res.db);
  };

  const handleDownloadTemplate = async (blank = true, fy = selectedFiscalYear) => {
    try {
      const targetFy = fy === 'ALL' ? '2026' : fy;
      const blob = await exportMonitoringWorkbook({
        fiscalYear: targetFy,
        municipalityName: db.settings.municipalityName,
        programs: scopedPrograms,
        activities: scopedRawActivities,
        blankTemplate: blank,
      });
      const fileName = blank
        ? `Monitoring_Template_Blank_FY${targetFy}.xlsx`
        : `LGU_Bula_Monitoring_Template_FY${targetFy}.xlsx`;
      triggerBlobDownload(blob, fileName);
      if (currentUser) {
        const log = buildAuditLog(
          currentUser,
          'EXPORT',
          'ExcelWorkbook',
          fileName,
          `Exported Excel workbook ${fileName}`
        );
        await dataService.logAudit(log).catch(() => {});
        setDb((prev) => ({ ...prev, auditLogs: [log, ...prev.auditLogs] }));
      }
      notify('success', `Downloaded ${fileName}.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Excel export failed.');
    }
  };

  const handleLoadSampleData = async () => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'IMPORT',
      'Dataset',
      'sample-lgu-bula',
      'Loaded sample LGU Bula FY 2026 PPA dataset'
    );
    try {
      const res = await dataService.seedDemo(log);
      setDb(res.db);
      setSelectedFiscalYear('2026');
      notify('success', 'Sample LGU Bula FY 2026 PPA dataset loaded.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to load sample dataset.');
    }
  };

  const handleResetData = async () => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'DELETE',
      'Dataset',
      'all-ppa',
      'Cleared all Programs, Activities, and Remarks'
    );
    try {
      const res = await dataService.resetData(log);
      setDb(res.db);
      notify('success', 'All PPA records cleared.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to clear PPA records.');
    }
  };

  // Users, Offices, Fiscal Years, Settings
  const handleCreateUser = async (user: UserAccount) => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'CREATE',
      'UserAccount',
      user.id,
      `Created user ${user.displayName} (${user.role})`
    );
    try {
      const res = await dataService.createUser(user, log);
      const savedUser = res.user || user;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        users: [...prev.users, savedUser],
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      await refreshAuthDirectory();
      notify('success', `User "${savedUser.displayName}" added.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to create user account.');
      throw err;
    }
  };

  const handleUpdateUser = async (user: UserAccount) => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'UPDATE',
      'UserAccount',
      user.id,
      `Updated user ${user.displayName} (${user.role})`
    );
    try {
      const res = await dataService.updateUser(user, log);
      const savedUser = res.user || user;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        users: prev.users.map((u) => (u.id === savedUser.id ? savedUser : u)),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      if (savedUser.id === currentUser.id) {
        setCurrentUser(savedUser);
      }
      await refreshAuthDirectory();
      notify('success', `User "${savedUser.displayName}" updated.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update user account.');
      throw err;
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!currentUser) return;
    const log = buildAuditLog(currentUser, 'DELETE', 'UserAccount', id, `Deleted user ${id}`);
    try {
      const res = await dataService.deleteUser(id, log);
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        users: prev.users.filter((u) => u.id !== id),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      await refreshAuthDirectory();
      notify('success', 'User account removed.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to delete user account.');
    }
  };

  const handleProvisionOfficeAccounts = async () => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'CREATE',
      'UserAccount',
      'office-provision',
      'Provisioned dedicated monitoring accounts for missing LGU offices'
    );
    try {
      const res = await dataService.provisionOfficeAccounts(log);
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        users: res.users,
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      await refreshAuthDirectory();
      notify(
        'success',
        res.created.length > 0
          ? `Created ${res.created.length} dedicated office monitoring account(s).`
          : 'All offices already have dedicated monitoring accounts.'
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to provision office accounts.');
    }
  };

  const handleSaveSettings = async (settings: SystemSettings) => {
    if (!currentUser) return;
    if (currentUser.role !== 'ADMINISTRATOR') {
      notify('error', 'Only Administrators are allowed to update System Settings.');
      return;
    }
    const log = buildAuditLog(
      currentUser,
      'SETTINGS',
      'SystemSettings',
      'global',
      `Updated system settings & application branding (${settings.appName?.trim() || DEFAULT_APP_NAME})`
    );
    try {
      const res = await dataService.updateSettings(settings, log);
      const savedSettings = res.settings || settings;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        settings: savedSettings,
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      if (savedSettings.theme === 'dark' || savedSettings.theme === 'light') {
        setTheme(savedSettings.theme);
      }
      await refreshAuthDirectory();
      notify('success', 'System settings saved.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to save system settings.');
      throw err;
    }
  };

  const handleCreateOffice = async (office: Office) => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'CREATE',
      'Office',
      office.id,
      `Added office ${office.code}: ${office.name}`
    );
    try {
      const res = await dataService.createOffice(office, log);
      const savedOffice = res.office || office;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        offices: [...prev.offices, savedOffice],
        users: res.createdUser ? [...prev.users, res.createdUser] : prev.users,
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      await refreshAuthDirectory();
      notify(
        'success',
        res.createdUser
          ? `Office "${savedOffice.name}" and monitoring account (${res.createdUser.email}) added.`
          : `Office "${savedOffice.name}" added.`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to add office.');
      throw err;
    }
  };

  const handleUpdateOffice = async (office: Office) => {
    if (!currentUser) return;
    if (currentUser.role !== 'ADMINISTRATOR') {
      notify('error', 'Only Administrators are allowed to edit Municipal Offices.');
      throw new Error('Only Administrators are allowed to edit Municipal Offices.');
    }
    const normalizedOffice: Office = {
      ...office,
      code: office.code.trim().toUpperCase(),
      name: office.name.trim(),
      headName: office.headName.trim() || 'Department Head',
    };
    const log = buildAuditLog(
      currentUser,
      'UPDATE',
      'Office',
      normalizedOffice.id,
      `Updated office ${normalizedOffice.code}: ${normalizedOffice.name}`
    );
    try {
      const res = await dataService.updateOffice(normalizedOffice, log);
      const savedOffice = res.office || normalizedOffice;
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        offices: prev.offices.map((o) => (o.id === savedOffice.id ? savedOffice : o)),
        users: prev.users.map((u) =>
          u.officeId === savedOffice.id ? { ...u, officeName: savedOffice.name } : u
        ),
        programs: prev.programs.map((p) =>
          p.officeId === savedOffice.id ? { ...p, officeName: savedOffice.name } : p
        ),
        activities: prev.activities.map((a) =>
          a.officeId === savedOffice.id ? { ...a, officeName: savedOffice.name } : a
        ),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      if (currentUser.officeId === savedOffice.id) {
        setCurrentUser((prev) => (prev ? { ...prev, officeName: savedOffice.name } : prev));
      }
      await refreshAuthDirectory();
      notify('success', `Office "${savedOffice.name}" updated.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update office.');
      throw err;
    }
  };

  const handleDeleteOffice = async (id: string) => {
    if (!currentUser) return;
    const log = buildAuditLog(currentUser, 'DELETE', 'Office', id, `Removed office ${id}`);
    try {
      const res = await dataService.deleteOffice(id, log);
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        offices: prev.offices.filter((o) => o.id !== id),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      await refreshAuthDirectory();
      notify('success', 'Office removed.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to remove office.');
    }
  };

  const handleCreateFy = async (fy: FiscalYear) => {
    if (!currentUser) return;
    const log = buildAuditLog(
      currentUser,
      'CREATE',
      'FiscalYear',
      fy.id,
      `Added fiscal year ${fy.label}`
    );
    try {
      const res = await dataService.createFiscalYear(fy, log);
      const recordedLog = res.auditLog || log;
      setDb((prev) => ({
        ...prev,
        fiscalYears: [...prev.fiscalYears, fy],
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      notify('success', `${fy.label} added.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to add fiscal year.');
      throw err;
    }
  };

  const handleDeleteFy = async (id: string) => {
    if (!currentUser) return;
    const removedFy = db.fiscalYears.find((f) => f.id === id);
    const log = buildAuditLog(currentUser, 'DELETE', 'FiscalYear', id, `Removed fiscal year ${id}`);
    try {
      const res = await dataService.deleteFiscalYear(id, log);
      const recordedLog = res.auditLog || log;
      const remainingFys = db.fiscalYears.filter((f) => f.id !== id);
      setDb((prev) => ({
        ...prev,
        fiscalYears: prev.fiscalYears.filter((f) => f.id !== id),
        auditLogs: [recordedLog, ...prev.auditLogs],
      }));
      if (removedFy && selectedFiscalYear === removedFy.year) {
        setSelectedFiscalYear(remainingFys[0]?.year || 'ALL');
      }
      notify('success', 'Fiscal year removed.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to remove fiscal year.');
    }
  };

  const handleRestoreDatabase = (restoredDb: DatabasePayload) => {
    setDb(restoredDb);
    if (restoredDb.settings?.defaultFiscalYear) {
      setSelectedFiscalYear(restoredDb.settings.defaultFiscalYear);
    }
    refreshAuthDirectory();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-2">
          {brandLogoUrl ? (
            <img
              src={brandLogoUrl}
              alt={`${brandAppName} logo`}
              className="mx-auto h-10 w-10 rounded-lg object-contain"
            />
          ) : (
            <Building2 className="mx-auto h-8 w-8 text-[#0F294A] dark:text-sky-400" />
          )}
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Loading {brandAppName}...
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        <LoginView
          users={authDirectory}
          offices={directoryOffices}
          appName={brandAppName}
          appLogoDataUrl={brandLogoUrl}
          firebaseConfigured={firebaseState.configured}
          firebaseProjectId={firebaseState.projectId}
          onSelectLocalUser={handleLocalLogin}
          onFirebaseGoogleSignIn={handleFirebaseGoogleSignIn}
        />
        <ToastBanner
          toasts={toasts}
          onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))}
        />
      </>
    );
  }

  const activeNav = NAV_ITEMS.find((n) => n.id === activeModule) || NAV_ITEMS[0];
  const totalSearchHits =
    globalSearchResults.programs.length +
    globalSearchResults.activities.length +
    globalSearchResults.offices.length;

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 flex overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 bg-[#163A5F] dark:bg-slate-900 dark:border-r dark:border-slate-800 text-white no-print transition-all duration-200 ${
          sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'
        }`}
      >
        <div
          className={`flex items-center border-b border-white/10 py-4 ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15 overflow-hidden">
              {brandLogoUrl ? (
                <img
                  src={brandLogoUrl}
                  alt={`${brandAppName} logo`}
                  className="h-full w-full object-contain p-0.5"
                />
              ) : (
                <BarChart3 className="h-5 w-5 text-teal-300" aria-hidden="true" />
              )}
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0" title={brandAppName}>
                <p className="font-display text-[13px] font-semibold tracking-tight text-white line-clamp-2 leading-snug">
                  {brandAppName}
                </p>
                <p className="text-[11px] text-slate-300 truncate mt-0.5">
                  {db.settings.municipalityName || 'LGU Bula MPDO'}
                </p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {sidebarCollapsed && (
          <div className="flex justify-center pt-2.5">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        <nav className="flex-1 px-2.5 py-3 space-y-4 overflow-y-auto" aria-label="Sidebar Navigation">
          {NAV_GROUPS.map((group) => {
            const items = visibleNavItems.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="space-y-1">
                {!sidebarCollapsed ? (
                  <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-300/75">
                    {group}
                  </p>
                ) : (
                  <div className="mx-3 border-t border-white/10 my-1" />
                )}
                {items.map(({ id, label, Icon }) => {
                  const active = activeModule === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveModule(id)}
                      title={sidebarCollapsed ? label : undefined}
                      className={`group w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-all ${
                        sidebarCollapsed ? 'justify-center px-2' : ''
                      } ${
                        active
                          ? 'bg-white text-[#163A5F] font-semibold shadow-sm'
                          : 'text-slate-200 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          active ? 'text-[#2563EB]' : 'text-slate-300 group-hover:text-white'
                        }`}
                        aria-hidden="true"
                      />
                      {!sidebarCollapsed && <span className="truncate">{label}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3 space-y-2">
          {!sidebarCollapsed ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-white/10 px-2.5 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-500/20 text-xs font-semibold text-teal-200 ring-1 ring-teal-400/30">
                {getInitials(currentUser.displayName)}
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-semibold text-white truncate">{currentUser.displayName}</p>
                <p className="text-[11px] text-slate-300 truncate">
                  {isOfficeScoped ? currentUser.officeName : currentUser.role}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold text-teal-200"
              title={`${currentUser.displayName} (${currentUser.officeName})`}
            >
              {getInitials(currentUser.displayName)}
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            title={sidebarCollapsed ? 'Logout' : undefined}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors ${
              sidebarCollapsed ? 'justify-center px-2' : ''
            }`}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] dark:bg-slate-950/75"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative flex w-72 max-w-[85vw] flex-col bg-[#163A5F] dark:bg-slate-900 text-white shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15 overflow-hidden">
                  {brandLogoUrl ? (
                    <img
                      src={brandLogoUrl}
                      alt={`${brandAppName} logo`}
                      className="h-full w-full object-contain p-0.5"
                    />
                  ) : (
                    <BarChart3 className="h-4 w-4 text-teal-300" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0">
                  <span className="font-display text-[13px] font-semibold block leading-snug line-clamp-2 text-white">
                    {brandAppName}
                  </span>
                  <span className="text-[11px] text-slate-300 truncate block">
                    {db.settings.municipalityName || 'LGU Bula MPDO'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
              {NAV_GROUPS.map((group) => {
                const items = visibleNavItems.filter((item) => item.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="space-y-1">
                    <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-300/75">
                      {group}
                    </p>
                    {items.map(({ id, label, Icon }) => {
                      const active = activeModule === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setActiveModule(id);
                            setMobileNavOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
                            active
                              ? 'bg-white text-[#163A5F] font-semibold shadow-sm'
                              : 'text-slate-200 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <div className="border-t border-white/10 p-3 space-y-2">
              <div className="flex items-center gap-2.5 rounded-lg bg-white/10 px-3 py-2 text-xs">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-500/20 font-semibold text-teal-200">
                  {getInitials(currentUser.displayName)}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{currentUser.displayName}</p>
                  <p className="text-[11px] text-slate-300 truncate">{currentUser.officeName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-slate-200 hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Logout</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div
        className={`print-shell-content flex-1 flex flex-col min-w-0 transition-all duration-200 ${
          sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        }`}
      >
        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3 no-print">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>{activeNav.group}</span>
                  <span>/</span>
                  <span className="text-[#2563EB] dark:text-sky-400">{activeNav.label}</span>
                </div>
                <h1 className="text-[21px] sm:text-[26px] font-semibold tracking-tight leading-tight text-slate-900 dark:text-slate-100 truncate">
                  {activeModule === 'gad'
                    ? 'Gender and Development (GAD) Fund Summary'
                    : activeNav.label}
                </h1>
              </div>
            </div>

            {/* Global Search Bar + Fiscal Year + Theme + User */}
            <div className="flex items-center gap-2.5 sm:gap-3 flex-1 sm:flex-initial justify-end min-w-[200px]">
              <div className="relative flex-1 sm:w-64 md:w-80 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={globalSearchQuery}
                  onFocus={() => setGlobalSearchOpen(true)}
                  onChange={(e) => {
                    setGlobalSearchQuery(e.target.value);
                    setGlobalSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setGlobalSearchOpen(false);
                    } else if (e.key === 'Enter' && globalSearchQuery.trim()) {
                      jumpToProgramsWithFilter(globalSearchQuery.trim());
                    }
                  }}
                  placeholder="Search programs, activities, offices..."
                  aria-label="Global Search"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-9 pr-8 py-1.5 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#2563EB] focus:bg-white dark:focus:bg-slate-800 focus:outline-none transition-colors"
                />
                {globalSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setGlobalSearchQuery('');
                      setGlobalSearchOpen(false);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Search Results Dropdown */}
                {globalSearchOpen && globalSearchQuery.trim().length > 0 && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setGlobalSearchOpen(false)}
                    />
                    <div className="absolute right-0 left-0 sm:left-auto sm:w-96 mt-2 z-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden animate-fade-in">
                      {totalSearchHits === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                          No matching programs, activities, or offices found for &ldquo;
                          {globalSearchQuery.trim()}&rdquo;.
                        </div>
                      ) : (
                        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                          {globalSearchResults.programs.length > 0 && (
                            <div className="p-2">
                              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                Programs ({globalSearchResults.programs.length})
                              </p>
                              {globalSearchResults.programs.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => jumpToProgramsWithFilter(p.aipRefCode)}
                                  className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    <span className="font-mono text-[#2563EB] dark:text-sky-400 mr-1.5">
                                      {p.aipRefCode}
                                    </span>
                                    {p.title}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {p.officeName} · FY {p.fiscalYear}
                                  </p>
                                </button>
                              ))}
                            </div>
                          )}

                          {globalSearchResults.activities.length > 0 && (
                            <div className="p-2">
                              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                Projects &amp; Activities ({globalSearchResults.activities.length})
                              </p>
                              {globalSearchResults.activities.map((a) => (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() => jumpToProgramsWithFilter(a.referenceNumber)}
                                  className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    <span className="font-mono text-[#163A5F] dark:text-sky-400 mr-1.5">
                                      {a.referenceNumber}
                                    </span>
                                    {a.description}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {a.officeName} · {a.status}
                                  </p>
                                </button>
                              ))}
                            </div>
                          )}

                          {globalSearchResults.offices.length > 0 && (
                            <div className="p-2">
                              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                Offices ({globalSearchResults.offices.length})
                              </p>
                              {globalSearchResults.offices.map((o) => (
                                <button
                                  key={o.id}
                                  type="button"
                                  onClick={() => jumpToProgramsWithFilter('', o.id)}
                                  className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                >
                                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    <span className="font-mono text-[#0D9488] dark:text-teal-400 mr-1.5">
                                      {o.code}
                                    </span>
                                    {o.name}
                                  </p>
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    Head: {o.headName || 'Department Head'}
                                  </p>
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => jumpToProgramsWithFilter(globalSearchQuery.trim())}
                              className="text-xs font-semibold text-[#2563EB] dark:text-sky-400 hover:underline"
                            >
                              Filter Programs &amp; Activities by &ldquo;{globalSearchQuery.trim()}&rdquo; →
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

                <select
                aria-label="Global Fiscal Year"
                value={selectedFiscalYear}
                onChange={(e) => setSelectedFiscalYear(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[13px] font-medium text-slate-800 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none shrink-0"
              >
                <option value="ALL">All Years</option>
                {db.fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.year}>
                    {fy.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title={`Print ${activeNav.label}`}
                aria-label={`Print ${activeNav.label}`}
              >
                <Printer className="h-4 w-4 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                <span className="hidden md:inline">Print</span>
              </button>

              <button
                type="button"
                onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <div className="hidden xl:flex items-center gap-2.5 pl-2 border-l border-slate-200 dark:border-slate-800">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#163A5F] dark:bg-sky-500/20 text-xs font-semibold text-white dark:text-sky-300">
                  {getInitials(currentUser.displayName)}
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap leading-tight">
                    {currentUser.displayName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {currentUser.role} · {currentUser.officeName}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1480px] w-full mx-auto">
          {activeModule !== 'reports' && (
            <div className="print-only mb-5 border-b-2 border-slate-800 pb-3">
              <div className="flex items-end justify-between gap-4">
                <div className="flex items-center gap-3">
                  {brandLogoUrl && (
                    <img
                      src={brandLogoUrl}
                      alt={`${brandAppName} logo`}
                      className="h-10 w-10 object-contain rounded"
                    />
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-600">
                      Republic of the Philippines · {db.settings.provinceName} · {db.settings.municipalityName}
                    </p>
                    <p className="text-xs font-medium text-slate-700">{brandAppName}</p>
                    <h2 className="text-[18px] font-semibold text-slate-900">
                      {db.settings.officeTitle} — {activeNav.label}
                    </h2>
                  </div>
                </div>
                <div className="text-right text-[10px] text-slate-600 font-mono">
                  <p>
                    Fiscal Year:{' '}
                    {selectedFiscalYear === 'ALL' ? 'All Fiscal Years' : `FY ${selectedFiscalYear}`}
                  </p>
                  <p>
                    Printed by: {currentUser.displayName} · {new Date().toLocaleDateString('en-PH')}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div key={activeModule} className="animate-fade-in">
          {activeModule === 'dashboard' && (
            <DashboardModule
              programs={scopedPrograms}
              activities={scopedActivities}
              offices={db.offices}
              fiscalYears={db.fiscalYears}
              auditLogs={scopedAuditLogs}
              selectedFiscalYear={selectedFiscalYear}
              onChangeFiscalYear={setSelectedFiscalYear}
              userRole={currentUser.role}
              userUid={currentUser.uid}
              userName={currentUser.displayName}
              userOfficeId={currentUser.officeId}
              userOfficeName={currentUser.officeName}
              theme={theme}
              onNavigate={(m) => setActiveModule(m)}
              onDownloadTemplate={() => handleDownloadTemplate(true)}
              onLoadSampleData={handleLoadSampleData}
              onUpdateActivity={handleUpdateActivity}
              onAddRemark={handleAddRemark}
            />
          )}

          {activeModule === 'programs' && (
            <ProgramsActivitiesModule
              programs={scopedPrograms}
              activities={scopedActivities}
              offices={db.offices}
              fiscalYears={db.fiscalYears}
              auditLogs={scopedAuditLogs}
              selectedFiscalYear={selectedFiscalYear}
              userRole={currentUser.role}
              userUid={currentUser.uid}
              userName={currentUser.displayName}
              userOfficeId={currentUser.officeId}
              userOfficeName={currentUser.officeName}
              globalSearchRequest={programJumpFilter}
              onCreateProgram={handleCreateProgram}
              onUpdateProgram={handleUpdateProgram}
              onDeleteProgram={handleDeleteProgram}
              onCreateActivity={handleCreateActivity}
              onUpdateActivity={handleUpdateActivity}
              onDeleteActivity={handleDeleteActivity}
              onBulkUpdateActivityStatus={handleBulkUpdateActivityStatus}
              onBulkDeleteActivities={handleBulkDeleteActivities}
              onReorderActivities={handleReorderActivities}
            />
          )}

          {activeModule === 'budget' && (
            <BudgetManagementModule
              programs={scopedPrograms}
              activities={scopedActivities}
              selectedFiscalYear={selectedFiscalYear}
              userRole={currentUser.role}
              userUid={currentUser.uid}
              userName={currentUser.displayName}
              onUpdateActivity={handleUpdateActivity}
              onUpdateProgram={handleUpdateProgram}
            />
          )}

          {activeModule === 'gad' && (
            <GadFundSummaryModule
              programs={scopedPrograms}
              activities={scopedActivities}
              offices={db.offices}
              fiscalYears={db.fiscalYears}
              selectedFiscalYear={selectedFiscalYear}
              isOfficeScoped={isOfficeScoped}
              userOfficeName={currentUser.officeName}
              theme={theme}
              canManagePrograms={currentUser.role !== 'VIEWER'}
              onNavigateToPrograms={() => setActiveModule('programs')}
            />
          )}

          {activeModule === 'status' && (
            <AccomplishmentStatusModule
              programs={scopedPrograms}
              activities={scopedActivities}
              selectedFiscalYear={selectedFiscalYear}
              userRole={currentUser.role}
              userUid={currentUser.uid}
              onUpdateStatus={handleUpdateStatus}
            />
          )}

          {activeModule === 'evaluation' && (
            <MonitoringEvaluationModule
              programs={scopedPrograms}
              activities={scopedActivities}
              remarksLogs={scopedRemarksLogs}
              selectedFiscalYear={selectedFiscalYear}
              currentUser={currentUser}
              onAddRemark={handleAddRemark}
              onDeleteRemark={handleDeleteRemark}
            />
          )}

          {activeModule === 'reports' && (
            <ReportsModule
              programs={scopedPrograms}
              activities={scopedActivities}
              fiscalYears={db.fiscalYears}
              settings={db.settings}
              selectedFiscalYear={selectedFiscalYear}
              onExportExcel={(fy) => handleDownloadTemplate(false, fy)}
              onLogReportExport={async (title, format) => {
                const log = buildAuditLog(
                  currentUser,
                  'EXPORT',
                  'Report',
                  format,
                  `Generated ${format} report: ${title}`
                );
                const res = await dataService.logAudit(log).catch(() => null);
                const recordedLog = res?.auditLog || log;
                setDb((prev) => ({ ...prev, auditLogs: [recordedLog, ...prev.auditLogs] }));
              }}
              onNotify={notify}
            />
          )}

          {activeModule === 'excel' && (
            <ExcelImportExportModule
              programs={scopedPrograms}
              activities={scopedRawActivities}
              offices={db.offices}
              fiscalYears={db.fiscalYears}
              uploadedDocuments={db.uploadedDocuments}
              selectedFiscalYear={selectedFiscalYear}
              municipalityName={db.settings.municipalityName}
              currentUser={currentUser}
              onCommitImport={handleCommitExcelImport}
              onLogExport={async (fileName) => {
                const log = buildAuditLog(
                  currentUser,
                  'EXPORT',
                  'ExcelWorkbook',
                  fileName,
                  `Exported Excel workbook: ${fileName}`
                );
                const res = await dataService.logAudit(log).catch(() => null);
                const recordedLog = res?.auditLog || log;
                setDb((prev) => ({ ...prev, auditLogs: [recordedLog, ...prev.auditLogs] }));
              }}
              onNotify={notify}
            />
          )}

          {activeModule === 'users' && (
            <UserManagementModule
              users={db.users}
              offices={db.offices}
              auditLogs={db.auditLogs}
              currentUser={currentUser}
              onCreateUser={handleCreateUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              onProvisionOfficeAccounts={handleProvisionOfficeAccounts}
              onNotify={notify}
            />
          )}

          {activeModule === 'settings' && (
            <SystemSettingsModule
              settings={db.settings}
              offices={db.offices}
              fiscalYears={db.fiscalYears}
              currentUser={currentUser}
              theme={theme}
              onChangeTheme={setTheme}
              firebaseConfigured={firebaseState.configured}
              firebaseProjectId={firebaseState.projectId}
              onSaveSettings={handleSaveSettings}
              onCreateOffice={handleCreateOffice}
              onUpdateOffice={handleUpdateOffice}
              onDeleteOffice={handleDeleteOffice}
              onCreateFiscalYear={handleCreateFy}
              onDeleteFiscalYear={handleDeleteFy}
              onLoadSampleData={handleLoadSampleData}
              onResetAllPPAData={handleResetData}
              onRestoreDatabase={handleRestoreDatabase}
              onNotify={notify}
            />
          )}
          </div>
        </main>
      </div>

      <ToastBanner
        toasts={toasts}
        onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))}
      />
    </div>
  );
}
