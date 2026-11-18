import {
  Activity,
  AuditActionType,
  AuditIntegrityResult,
  AuditLog,
  AuthDirectoryUser,
  BackupInfo,
  DatabasePayload,
  FiscalYear,
  Office,
  Program,
  RemarkLog,
  SystemSettings,
  UploadedDocument,
  UserAccount,
} from '../types/ppa';

const SESSION_TOKEN_KEY = 'bula_ppa_session_token';
let inMemorySessionToken: string | null = null;

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
    if (res.status === 401 && !url.startsWith('/api/auth/login')) {
      setSessionToken(null);
    }
    const errBody = await res.text();
    let message = errBody || `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(errBody) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      // keep raw text fallback
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
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

export interface AuthDirectoryResponse {
  users: AuthDirectoryUser[];
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
  branding: {
    appName: string;
    appLogoDataUrl: string;
    municipalityName: string;
  };
}

export const dataService = {
  getAuthDirectory(): Promise<AuthDirectoryResponse> {
    return apiRequest<AuthDirectoryResponse>('/api/auth/directory');
  },

  getSession(): Promise<AuthSessionResponse> {
    return apiRequest<AuthSessionResponse>('/api/auth/session');
  },

  async login(userId: string, passcode = '') {
    const res = await apiRequest<{ ok: boolean; user: UserAccount; sessionToken?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ userId, passcode }),
      }
    );
    if (res.sessionToken) {
      setSessionToken(res.sessionToken);
    }
    return res;
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

  updateProgram(program: Program, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; program: Program; auditLog?: AuditLog }>(
      `/api/programs/${program.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ program, auditLog }),
      }
    );
  },

  deleteProgram(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(`/api/programs/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ auditLog }),
    });
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

  updateActivity(activity: Activity, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; activity: Activity; auditLog?: AuditLog }>(
      `/api/activities/${activity.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ activity, auditLog }),
      }
    );
  },

  deleteActivity(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(`/api/activities/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ auditLog }),
    });
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
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(`/api/remarks/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ auditLog }),
    });
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
      `/api/offices/${office.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ office, auditLog }),
      }
    );
  },

  deleteOffice(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(`/api/offices/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ auditLog }),
    });
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
      `/api/fiscal-years/${fiscalYear.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ fiscalYear, auditLog }),
      }
    );
  },

  deleteFiscalYear(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(`/api/fiscal-years/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ auditLog }),
    });
  },

  createUser(user: UserAccount, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; user: UserAccount; auditLog?: AuditLog }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ user, auditLog }),
    });
  },

  updateUser(user: UserAccount, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; user: UserAccount; auditLog?: AuditLog }>(
      `/api/users/${user.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ user, auditLog }),
      }
    );
  },

  deleteUser(id: string, auditLog: AuditLog) {
    return apiRequest<{ ok: boolean; auditLog?: AuditLog }>(`/api/users/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ auditLog }),
    });
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
};
