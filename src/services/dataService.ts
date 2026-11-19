import {
  ActiveSessionInfo,
  ActiveSessionsOverview,
  Activity,
  ApprovalStatus,
  AuditActionType,
  AuditIntegrityResult,
  AuditLog,
  BackupInfo,
  DatabasePayload,
  DocumentTemplate,
  FiscalYear,
  Office,
  Program,
  RemarkLog,
  SidebarModule,
  SystemSettings,
  TemplateAnalysisSummary,
  TemplateFormat,
  TemplateReportTarget,
  UploadedDocument,
  UserAccount,
  UserRole,
} from '../types/ppa';

const SESSION_TOKEN_KEY = 'bula_ppa_session_token';
let inMemorySessionToken: string | null = null;
let unauthorizedHandler: ((reason?: string) => void) | null = null;

function getSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  try {
    const stored = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (stored) {
      inMemorySessionToken = stored;
      return stored;
    }
  } catch {
    // ignore storage access errors in restricted sandboxed contexts
  }
  return null;
}

function setSessionToken(token: string | null | undefined) {
  inMemorySessionToken = token || null;
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // ignore storage access errors in restricted sandboxed contexts
  }
}

const PUBLIC_AUTH_URLS = [
  '/api/auth/login',
  '/api/auth/firebase-login',
  '/api/auth/setup',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/session',
  '/api/auth/status',
];

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getSessionToken();
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const errBody = await res.text();
    let message = errBody || `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(errBody) as { error?: string; code?: string };
      if (parsed?.error) message = parsed.error;
      if (parsed?.code) code = parsed.code;
    } catch {
      // keep raw text fallback
    }
    if (res.status === 401 && !PUBLIC_AUTH_URLS.some((p) => url.startsWith(p))) {
      setSessionToken(null);
      unauthorizedHandler?.(message);
    }
    const err = new Error(message) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = code;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function buildAuditLog(
  user: UserAccount,
  action: AuditActionType,
  entityType: string,
  entityId: string,
  summary: string,
  details = ''
): AuditLog {
  return {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userUid: user.uid,
    userName: user.displayName,
    userEmail: user.email,
    userRole: user.role,
    userOfficeName: user.officeName,
    action,
    entityType,
    entityId,
    summary,
    details,
    timestamp: new Date().toISOString(),
  };
}

export interface AuthStatusResponse {
  setupRequired: boolean;
  allowSelfRegistration: boolean;
  privacyNoticeText: string;
  demoSeedAllowed: boolean;
  firebaseConfigured: boolean;
  offices: Office[];
  branding: {
    appName: string;
    appLogoDataUrl: string;
    municipalityName: string;
  };
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user: UserAccount | null;
  expiredReason?: string | null;
  setupRequired: boolean;
  allowSelfRegistration: boolean;
  privacyNoticeText: string;
  demoSeedAllowed: boolean;
  firebaseConfigured: boolean;
  sessionTimeoutMinutes: number;
  branding: {
    appName: string;
    appLogoDataUrl: string;
    municipalityName: string;
  };
}

export interface PaginatedAuditLogsResponse {
  auditLogs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const dataService = {
  setUnauthorizedHandler(handler: ((reason?: string) => void) | null) {
    unauthorizedHandler = handler;
  },

  getAuthStatus(): Promise<AuthStatusResponse> {
    return apiRequest<AuthStatusResponse>('/api/auth/status');
  },

  getSession(): Promise<AuthSessionResponse> {
    return apiRequest<AuthSessionResponse>('/api/auth/session');
  },

  async setupInitialAdmin(payload: {
    email: string;
    displayName: string;
    position: string;
    password: string;
    privacyAccepted: boolean;
  }) {
    const res = await apiRequest<{ ok: boolean; user: UserAccount; sessionToken?: string }>(
      '/api/auth/setup',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    if (res.sessionToken) {
      setSessionToken(res.sessionToken);
    }
    return res;
  },

  async login(email: string, password: string) {
    const res = await apiRequest<{ ok: boolean; user: UserAccount; sessionToken?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    );
    if (res.sessionToken) {
      setSessionToken(res.sessionToken);
    }
    return res;
  },

  register(payload: {
    email: string;
    displayName: string;
    officeId: string;
    position: string;
    password: string;
    privacyAccepted: boolean;
  }) {
    return apiRequest<{
      ok: boolean;
      pendingApproval: boolean;
      user: UserAccount;
      message: string;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  forgotPassword(email: string) {
    return apiRequest<{ ok: boolean; emailDeliveryConfigured: boolean; message: string }>(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      }
    );
  },

  resetPassword(payload: { email: string; token: string; newPassword: string }) {
    return apiRequest<{ ok: boolean; user: UserAccount; message: string }>(
      '/api/auth/reset-password',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  changePassword(currentPassword: string, newPassword: string) {
    return apiRequest<{ ok: boolean; user: UserAccount; auditLog?: AuditLog }>(
      '/api/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }
    );
  },

  updateProfile(displayName: string, position: string) {
    return apiRequest<{ ok: boolean; user: UserAccount; auditLog?: AuditLog }>(
      '/api/auth/profile',
      {
        method: 'PUT',
        body: JSON.stringify({ displayName, position }),
      }
    );
  },

  getSessions() {
    return apiRequest<{ sessions: ActiveSessionInfo[] }>('/api/auth/sessions');
  },

  revokeSession(id: string) {
    return apiRequest<{ ok: boolean; revokedCurrent: boolean }>(
      `/api/auth/sessions/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
  },

  getActiveSessionsOverview() {
    return apiRequest<ActiveSessionsOverview>('/api/auth/sessions/overview');
  },

  adminRevokeSession(id: string) {
    return apiRequest<{ ok: boolean; revokedCurrent: boolean; auditLog?: AuditLog }>(
      `/api/auth/admin/sessions/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
  },

  async firebaseLogin(idToken: string) {
    const res = await apiRequest<{ ok: boolean; user: UserAccount; sessionToken?: string }>(
      '/api/auth/firebase-login',
      {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      }
    );
    if (res.sessionToken) {
      setSessionToken(res.sessionToken);
    }
    return res;
  },

  async logout() {
    try {
      return await apiRequest<{ ok: boolean }>('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      setSessionToken(null);
    }
  },

  bootstrap(): Promise<DatabasePayload> {
    return apiRequest<DatabasePayload>('/api/bootstrap');
  },

  createProgram(program: Program, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; program: Program; auditLog?: AuditLog }>('/api/programs', {
      method: 'POST',
      body: JSON.stringify({ program, auditLog }),
    });
  },

  updateProgram(program: Program, auditLog: AuditLog, expectedUpdatedAt?: string) {
    return apiRequest<{ ok: boolean; program: Program; auditLog?: AuditLog }>(
      `/api/programs/${encodeURIComponent(program.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          program,
          auditLog,
          expectedUpdatedAt: expectedUpdatedAt ?? program.updatedAt,
        }),
      }
    );
  },

  deleteProgram(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(
      `/api/programs/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ auditLog }),
      }
    );
  },

  createActivity(activity: Activity, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; activity: Activity; auditLog?: AuditLog }>(
      '/api/activities',
      {
        method: 'POST',
        body: JSON.stringify({ activity, auditLog }),
      }
    );
  },

  updateActivity(activity: Activity, auditLog: AuditLog, expectedUpdatedAt?: string) {
    return apiRequest<{ ok: boolean; activity: Activity; auditLog?: AuditLog }>(
      `/api/activities/${encodeURIComponent(activity.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          activity,
          auditLog,
          expectedUpdatedAt: expectedUpdatedAt ?? activity.updatedAt,
        }),
      }
    );
  },

  deleteActivity(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(
      `/api/activities/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ auditLog }),
      }
    );
  },

  reorderActivities(updates: { id: string; orderIndex: number }[], auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>('/api/activities/reorder', {
      method: 'POST',
      body: JSON.stringify({ updates, auditLog }),
    });
  },

  createRemark(remark: RemarkLog, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; remark: RemarkLog; auditLog?: AuditLog }>('/api/remarks', {
      method: 'POST',
      body: JSON.stringify({ remark, auditLog }),
    });
  },

  deleteRemark(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(
      `/api/remarks/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ auditLog }),
      }
    );
  },

  createOffice(office: Office, auditLog: AuditLog) {
    return apiRequest<{
      ok: boolean;
      office: Office;
      createdUser?: UserAccount | null;
      auditLog?: AuditLog;
    }>('/api/offices', {
      method: 'POST',
      body: JSON.stringify({ office, auditLog }),
    });
  },

  updateOffice(office: Office, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; office: Office; auditLog?: AuditLog }>(
      `/api/offices/${encodeURIComponent(office.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ office, auditLog }),
      }
    );
  },

  deleteOffice(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(
      `/api/offices/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ auditLog }),
      }
    );
  },

  createFiscalYear(fiscalYear: FiscalYear, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; fiscalYear: FiscalYear; auditLog?: AuditLog }>(
      '/api/fiscal-years',
      {
        method: 'POST',
        body: JSON.stringify({ fiscalYear, auditLog }),
      }
    );
  },

  updateFiscalYear(fiscalYear: FiscalYear, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; fiscalYear: FiscalYear; auditLog?: AuditLog }>(
      `/api/fiscal-years/${encodeURIComponent(fiscalYear.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ fiscalYear, auditLog }),
      }
    );
  },

  deleteFiscalYear(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(
      `/api/fiscal-years/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ auditLog }),
      }
    );
  },

  createUser(user: UserAccount, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; user: UserAccount; auditLog?: AuditLog }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ user, auditLog }),
    });
  },

  updateUser(user: UserAccount, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; user: UserAccount; auditLog?: AuditLog }>(
      `/api/users/${encodeURIComponent(user.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ user, auditLog }),
      }
    );
  },

  approveUser(
    id: string,
    payload: {
      approvalStatus: ApprovalStatus;
      role?: UserRole;
      officeId?: string;
      isActive?: boolean;
      allowedModules?: SidebarModule[];
    }
  ) {
    return apiRequest<{ ok: boolean; user: UserAccount; auditLog?: AuditLog }>(
      `/api/users/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  issueResetToken(id: string, options?: { expiresMinutes?: number; mustChangePassword?: boolean }) {
    return apiRequest<{
      ok: boolean;
      resetToken: string;
      expiresAt: string;
      auditLog?: AuditLog;
    }>(`/api/users/${encodeURIComponent(id)}/reset-token`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  deleteUser(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(
      `/api/users/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ auditLog }),
      }
    );
  },

  provisionOfficeAccounts(auditLog: AuditLog) {
    return apiRequest<{
      ok: boolean;
      users: UserAccount[];
      created: UserAccount[];
      auditLog?: AuditLog;
    }>('/api/users/provision-offices', {
      method: 'POST',
      body: JSON.stringify({ auditLog }),
    });
  },

  updateSettings(settings: SystemSettings, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; settings: SystemSettings; auditLog?: AuditLog }>(
      '/api/settings',
      {
        method: 'PUT',
        body: JSON.stringify({ settings, auditLog }),
      }
    );
  },

  getAuditLogs(limit = 5) {
    return apiRequest<{ auditLogs: AuditLog[] }>(`/api/audit-logs?limit=${limit}`);
  },

  getAuditLogsPaginated(params: {
    page?: number;
    pageSize?: number;
    action?: string;
    search?: string;
  }) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.action && params.action !== 'ALL') query.set('action', params.action);
    if (params.search && params.search.trim()) query.set('search', params.search.trim());
    return apiRequest<PaginatedAuditLogsResponse>(`/api/audit-logs?${query.toString()}`);
  },

  verifyAuditChain() {
    return apiRequest<AuditIntegrityResult>('/api/audit-logs/verify');
  },

  logAudit(auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>('/api/audit-logs', {
      method: 'POST',
      body: JSON.stringify({
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        summary: auditLog.summary,
        details: auditLog.details,
      }),
    });
  },

  importBatch(payload: {
    newPrograms: Program[];
    newActivities: Activity[];
    updatedActivities: Activity[];
    newOffices: Office[];
    uploadedDocument: UploadedDocument;
    auditLog: AuditLog;
  }) {
    return apiRequest<{ ok: boolean; db: DatabasePayload }>('/api/import-batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  seedDemo(auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; db: DatabasePayload }>('/api/seed-demo', {
      method: 'POST',
      body: JSON.stringify({ auditLog }),
    });
  },

  resetData(auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; db: DatabasePayload }>('/api/reset-data', {
      method: 'POST',
      body: JSON.stringify({ auditLog }),
    });
  },

  listBackups() {
    return apiRequest<{ backups: BackupInfo[] }>('/api/backups');
  },

  createBackup() {
    return apiRequest<{ ok: boolean; backup: BackupInfo; auditLog?: AuditLog }>('/api/backups', {
      method: 'POST',
    });
  },

  verifyBackup(fileName: string) {
    return apiRequest<{
      valid: boolean;
      fileName: string;
      sha256: string;
      programCount: number;
      activityCount: number;
      message: string;
    }>(`/api/backups/${encodeURIComponent(fileName)}/verify`, {
      method: 'POST',
    });
  },

  restoreBackup(snapshot: unknown) {
    return apiRequest<{ ok: boolean; db: DatabasePayload }>('/api/backups/restore', {
      method: 'POST',
      body: JSON.stringify({ snapshot }),
    });
  },

  async downloadBackup(fileName: string) {
    const token = getSessionToken();
    const res = await fetch(`/api/backups/${encodeURIComponent(fileName)}`, {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = text || `Failed to download backup (${res.status})`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        // keep text
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  listTemplates() {
    return apiRequest<{ templates: DocumentTemplate[] }>('/api/templates');
  },

  uploadTemplate(payload: {
    templateId?: string;
    name: string;
    description?: string;
    format: TemplateFormat;
    targetReport: TemplateReportTarget;
    isDefault?: boolean;
    isActive?: boolean;
    fileName: string;
    mimeType?: string;
    fileBase64: string;
    notes?: string;
    analysis: TemplateAnalysisSummary;
  }) {
    return apiRequest<{ ok: boolean; template: DocumentTemplate; auditLog?: AuditLog }>(
      '/api/templates',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  updateTemplate(
    id: string,
    updates: {
      name?: string;
      description?: string;
      targetReport?: TemplateReportTarget;
      isDefault?: boolean;
      isActive?: boolean;
      activeVersionId?: string;
    }
  ) {
    return apiRequest<{ ok: boolean; template: DocumentTemplate; auditLog?: AuditLog }>(
      `/api/templates/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );
  },

  deleteTemplate(id: string) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(
      `/api/templates/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
  },

  async fetchTemplateBinary(id: string, versionId?: string): Promise<ArrayBuffer> {
    const token = getSessionToken();
    const qs = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
    const res = await fetch(`/api/templates/${encodeURIComponent(id)}/download${qs}`, {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = text || `Failed to load official template (${res.status})`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        // keep raw text
      }
      throw new Error(message);
    }
    return res.arrayBuffer();
  },

  async downloadTemplateFile(id: string, fileName: string, versionId?: string) {
    const buffer = await this.fetchTemplateBinary(id, versionId);
    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
