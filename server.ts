import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import {
  DEFAULT_APP_NAME,
  DEFAULT_SETTINGS,
  buildSampleLGUBulaDataset,
} from './src/utils/demoSeedData';
import { MONTHS } from './src/utils/calculations';
import { hasModuleAccess, isAdminRole, isOfficeScopedRole } from './src/utils/rbac';
import type {
  Activity,
  AuditActionType,
  AuditChangeDiff,
  AuditLog,
  FiscalYear,
  Office,
  Program,
  RemarkLog,
  SidebarModule,
  SystemSettings,
  UploadedDocument,
  UserAccount,
  UserRole,
} from './src/types/ppa';
import { AppDatabase } from './server/db';
import {
  ActivityRequestSchema,
  ApproveUserSchema,
  AuditLogsQuerySchema,
  BackupFileParamSchema,
  ChangePasswordSchema,
  ClientAuditLogSchema,
  CreateOrVersionTemplateSchema,
  FirebaseLoginSchema,
  FiscalYearRequestSchema,
  ForgotPasswordRequestSchema,
  IdParamSchema,
  ImportBatchSchema,
  IssueResetTokenSchema,
  LoginSchema,
  OfficeRequestSchema,
  ProfileUpdateSchema,
  ProgramRequestSchema,
  RegisterSchema,
  RemarkRequestSchema,
  ReorderActivitiesSchema,
  ResetPasswordConfirmSchema,
  RestoreBackupSchema,
  SettingsRequestSchema,
  SetupAdminSchema,
  UpdateTemplateSchema,
  UserRequestSchema,
} from './server/schemas';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  computeActivityDiff,
  computeProgramDiff,
  getClientGeoHint,
  getClientIp,
  getSessionSecret,
  isOriginAllowed,
  parseCookies,
  sanitizeServerError,
  sanitizeSpreadsheetText,
  setSessionCookie,
  signSessionToken,
  validateAndSanitizeLogoDataUrl,
  validatePasswordStrength,
  verifyFirebaseIdToken,
  verifySignedSessionToken,
} from './server/security';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '.data');
const DEMO_SEED_ALLOWED =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEMO_SEED === 'true';

interface AuthenticatedRequest extends express.Request {
  authUser?: UserAccount;
  sessionId?: string;
  sessionExpiredReason?: 'EXPIRED' | 'IDLE_TIMEOUT' | 'INACTIVE';
}

function makeServerAuditEntry(
  user: UserAccount,
  action: AuditActionType,
  entityType: string,
  entityId: string,
  summary: string,
  details = '',
  changes: AuditChangeDiff[] = []
): Omit<AuditLog, 'prevHash' | 'entryHash'> {
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
    changes,
    timestamp: new Date().toISOString(),
  };
}

function sanitizeProgramInput(raw: Program): Program {
  return {
    ...raw,
    aipRefCode: sanitizeSpreadsheetText(raw.aipRefCode),
    title: sanitizeSpreadsheetText(raw.title),
    targetOutputs: raw.targetOutputs ? sanitizeSpreadsheetText(raw.targetOutputs) : '',
    sector: sanitizeSpreadsheetText(raw.sector || 'General Public Services'),
    sourceOfFund: raw.sourceOfFund ? sanitizeSpreadsheetText(raw.sourceOfFund) : '',
    status: raw.status || 'PENDING',
    officeName: sanitizeSpreadsheetText(raw.officeName),
    supplementalLogs: Array.isArray(raw.supplementalLogs)
      ? raw.supplementalLogs.map((log) => ({
          ...log,
          supplementalNumber:
            typeof log.supplementalNumber === 'number' && Number.isFinite(log.supplementalNumber)
              ? Math.max(1, Math.floor(log.supplementalNumber))
              : undefined,
          notes: log.notes ? sanitizeSpreadsheetText(log.notes) : undefined,
        }))
      : raw.supplementalLogs,
  };
}

function sanitizeActivityInput(raw: Activity): Activity {
  const clampedCompletion = Math.round(
    Math.min(100, Math.max(0, Number(raw.completionPct ?? 0))) * 100
  ) / 100;
  return {
    ...raw,
    referenceNumber: sanitizeSpreadsheetText(raw.referenceNumber),
    description: sanitizeSpreadsheetText(raw.description),
    targetOutputs: raw.targetOutputs ? sanitizeSpreadsheetText(raw.targetOutputs) : '',
    officeName: sanitizeSpreadsheetText(raw.officeName),
    sourceOfFund: raw.sourceOfFund ? sanitizeSpreadsheetText(raw.sourceOfFund) : '',
    completionPct: Number.isFinite(clampedCompletion) ? clampedCompletion : 0,
    remarks: raw.remarks ? sanitizeSpreadsheetText(raw.remarks) : '',
    milestones: Array.isArray(raw.milestones)
      ? raw.milestones.map((m) => ({
          id: m.id,
          title: sanitizeSpreadsheetText(m.title),
          status: m.status || 'Pending',
          dueDate: m.dueDate || '',
          completedAt: m.completedAt || '',
        }))
      : [],
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.map((ev) => {
          let safeUrl = '';
          const rawUrl = (ev.url || '').trim();
          if (rawUrl) {
            try {
              const parsed = new URL(rawUrl);
              if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                safeUrl = rawUrl;
              }
            } catch {
              safeUrl = '';
            }
          }
          return {
            id: ev.id,
            title: ev.title ? sanitizeSpreadsheetText(ev.title) : '',
            note: ev.note ? sanitizeSpreadsheetText(ev.note) : '',
            url: safeUrl,
            addedByUid: ev.addedByUid || '',
            addedByName: ev.addedByName ? sanitizeSpreadsheetText(ev.addedByName) : '',
            addedAt: ev.addedAt || new Date().toISOString(),
          };
        })
      : [],
  };
}

function getEvaluatorLockedFieldChanges(existing: Activity, clean: Activity): string[] {
  const locked: string[] = [];
  if (existing.programId !== clean.programId) locked.push('programId');
  if ((existing.subprogramId ?? null) !== (clean.subprogramId ?? null)) locked.push('subprogramId');
  if (existing.fiscalYear !== clean.fiscalYear) locked.push('fiscalYear');
  if (existing.referenceNumber !== clean.referenceNumber) locked.push('referenceNumber');
  if (existing.description !== clean.description) locked.push('description');
  if ((existing.targetOutputs || '') !== (clean.targetOutputs || '')) locked.push('targetOutputs');
  if (existing.officeId !== clean.officeId) locked.push('officeId');
  if (existing.officeName !== clean.officeName) locked.push('officeName');
  if ((existing.sourceOfFund || '') !== (clean.sourceOfFund || '')) locked.push('sourceOfFund');
  if ((existing.budgetClassification || 'GF') !== (clean.budgetClassification || 'GF')) {
    locked.push('budgetClassification');
  }
  if ((existing.gf ?? 0) !== (clean.gf ?? 0)) locked.push('gf');
  if (existing.ps !== clean.ps) locked.push('ps');
  if (existing.mooe !== clean.mooe) locked.push('mooe');
  if (existing.co !== clean.co) locked.push('co');
  if (existing.withheldAmount !== clean.withheldAmount) locked.push('withheldAmount');
  if ((existing.supplementalBudget1 ?? 0) !== (clean.supplementalBudget1 ?? 0)) locked.push('supplementalBudget1');
  if ((existing.supplementalBudget2 ?? 0) !== (clean.supplementalBudget2 ?? 0)) locked.push('supplementalBudget2');
  if ((existing.supplementalBudget3 ?? 0) !== (clean.supplementalBudget3 ?? 0)) locked.push('supplementalBudget3');
  if ((existing.supplementalBudget4 ?? 0) !== (clean.supplementalBudget4 ?? 0)) locked.push('supplementalBudget4');
  if ((existing.supplementalBudget5 ?? 0) !== (clean.supplementalBudget5 ?? 0)) locked.push('supplementalBudget5');
  if ((existing.startDate || '') !== (clean.startDate || '')) locked.push('startDate');
  if ((existing.endDate || '') !== (clean.endDate || '')) locked.push('endDate');
  if (JSON.stringify(existing.milestones || []) !== JSON.stringify(clean.milestones || [])) {
    locked.push('milestones');
  }
  if (JSON.stringify(existing.evidence || []) !== JSON.stringify(clean.evidence || [])) {
    locked.push('evidence');
  }
  if (clean.orderIndex !== undefined && clean.orderIndex !== existing.orderIndex) {
    locked.push('orderIndex');
  }
  for (const m of MONTHS) {
    const bm = existing.monthly?.[m.key];
    const am = clean.monthly?.[m.key];
    if (!bm || !am) {
      if (bm !== am) locked.push(`monthly.${m.key}`);
      continue;
    }
    if (
      bm.physicalTarget !== am.physicalTarget ||
      bm.financialTarget !== am.financialTarget ||
      bm.physicalActual !== am.physicalActual ||
      bm.financialActual !== am.financialActual
    ) {
      locked.push(`monthly.${m.key}`);
    }
  }
  return locked;
}

function getEvaluatorProgramLockedFieldChanges(existing: Program, clean: Program): string[] {
  const locked: string[] = [];
  if (existing.fiscalYear !== clean.fiscalYear) locked.push('fiscalYear');
  if (existing.aipRefCode !== clean.aipRefCode) locked.push('aipRefCode');
  if (existing.title !== clean.title) locked.push('title');
  if ((existing.targetOutputs || '') !== (clean.targetOutputs || '')) locked.push('targetOutputs');
  if (existing.sector !== clean.sector) locked.push('sector');
  if ((existing.budget ?? 0) !== (clean.budget ?? 0)) locked.push('budget');
  if ((existing.supplementalBudget ?? 0) !== (clean.supplementalBudget ?? 0)) {
    locked.push('supplementalBudget');
  }
  if ((existing.sourceOfFund || '') !== (clean.sourceOfFund || '')) locked.push('sourceOfFund');
  if (Boolean(existing.gadFund) !== Boolean(clean.gadFund)) locked.push('gadFund');
  if (existing.officeId !== clean.officeId) locked.push('officeId');
  if ((existing.parentProgramId ?? null) !== (clean.parentProgramId ?? null)) {
    locked.push('parentProgramId');
  }
  return locked;
}

function formatValidationError(issues: { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return 'Invalid request payload.';
  const field = first.path.map((p) => String(p)).join('.');
  return field ? `${field}: ${first.message}` : first.message;
}

function createIpRateLimiter(windowMs: number, maxRequests: number, label: string) {
  const buckets = new Map<string, number[]>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const recent = (buckets.get(ip) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      const retrySec = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      res.status(429).json({
        error: `Too many ${label} requests from this network. Retry in ${retrySec} seconds.`,
      });
      return;
    }
    recent.push(now);
    buckets.set(ip, recent);
    if (buckets.size > 5000) {
      for (const [key, timestamps] of buckets.entries()) {
        if (timestamps.every((ts) => now - ts >= windowMs)) {
          buckets.delete(key);
        }
      }
    }
    next();
  };
}

function resolveFirebaseProjectId(database: AppDatabase): string {
  const envPid = process.env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (envPid) return envPid;

  const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const parsedCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { projectId?: string };
      if (parsedCfg.projectId?.trim()) return parsedCfg.projectId.trim();
    } catch {
      // ignore invalid config file
    }
  }

  const savedCfg = database.getSettings().firebaseWebConfigJson;
  if (savedCfg) {
    try {
      const parsedSaved = JSON.parse(savedCfg) as { projectId?: string };
      if (parsedSaved.projectId?.trim()) return parsedSaved.projectId.trim();
    } catch {
      // ignore invalid saved json
    }
  }
  return '';
}

async function startServer() {
  const database = new AppDatabase(DATA_DIR);
  const sessionSecret = getSessionSecret(DATA_DIR);

  const app = express();
  app.set('trust proxy', true);

  const isProd =
    process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist'));

  app.use(
    helmet({
      // Preview runs inside AI Studio iframe on port 3000
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          scriptSrc: isProd
            ? ["'self'", 'https://apis.google.com', 'https://*.firebaseapp.com']
            : ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://apis.google.com', 'https://*.firebaseapp.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
          connectSrc: [
            "'self'",
            'https://*.googleapis.com',
            'https://*.firebaseio.com',
            'https://securetoken.googleapis.com',
            'https://identitytoolkit.googleapis.com',
            'ws:',
            'wss:',
          ],
          frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
        },
      },
    })
  );

  app.use(express.json({ limit: '15mb' }));

  // CSRF Origin / Referer protection on all state-changing API routes
  app.use((req, res, next) => {
    if (
      req.path.startsWith('/api') &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      !isOriginAllowed(req)
    ) {
      res.status(403).json({
        error: 'Cross-origin request rejected by CSRF origin verification policy.',
      });
      return;
    }
    next();
  });

  const authRateLimiter = createIpRateLimiter(15 * 60 * 1000, 30, 'authentication');
  const registrationRateLimiter = createIpRateLimiter(60 * 60 * 1000, 10, 'registration');
  const resetRateLimiter = createIpRateLimiter(15 * 60 * 1000, 15, 'password recovery');

  const extractSessionToken = (req: express.Request): string | null => {
    const cookies = parseCookies(req);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    if (cookieToken) return cookieToken;
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string') {
      const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
      if (match && match[1]) return match[1].trim();
    }
    return null;
  };

  const attachSession = (req: AuthenticatedRequest) => {
    const rawToken = extractSessionToken(req);
    if (!rawToken) return;
    const sessionId = verifySignedSessionToken(rawToken, sessionSecret);
    if (!sessionId) return;
    const status = database.getSessionStatus(sessionId);
    if (!status.user) {
      req.sessionExpiredReason = status.expiredReason;
      return;
    }
    req.authUser = status.user;
    req.sessionId = sessionId;
  };

  const requireAuth = (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    attachSession(req);
    if (!req.authUser) {
      clearSessionCookie(res, req);
      const message =
        req.sessionExpiredReason === 'IDLE_TIMEOUT'
          ? 'Your session expired due to inactivity. Please sign in again.'
          : req.sessionExpiredReason === 'EXPIRED'
            ? 'Your session has expired. Please sign in again.'
            : req.sessionExpiredReason === 'INACTIVE'
              ? 'Your account is deactivated or pending approval.'
              : 'Authentication required. Please sign in to continue.';
      res.status(401).json({ error: message, code: req.sessionExpiredReason || 'UNAUTHENTICATED' });
      return;
    }
    next();
  };

  const requireRoles =
    (...roles: UserRole[]) =>
    (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
      if (!req.authUser) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      if (!roles.includes(req.authUser.role)) {
        res.status(403).json({
          error: `Access denied. Your role (${req.authUser.role}) is not permitted to perform this action.`,
        });
        return;
      }
      next();
    };

  const requireModule =
    (module: SidebarModule) =>
    (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
      if (!req.authUser) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      if (!hasModuleAccess(req.authUser, module)) {
        res.status(403).json({
          error: `Access denied. Your account does not have permission for the "${module}" module.`,
        });
        return;
      }
      next();
    };

  const isOwnedByUserOffice = (
    user: UserAccount,
    targetOfficeId?: string,
    targetOfficeName?: string
  ) => {
    if (!isOfficeScopedRole(user.role)) return true;
    if (!user.officeId) return false;
    if (targetOfficeId && targetOfficeId === user.officeId) return true;
    if (
      targetOfficeName &&
      user.officeName &&
      targetOfficeName.toLowerCase() === user.officeName.toLowerCase()
    ) {
      return true;
    }
    return false;
  };

  // Readiness & Health Check (verifies SQLite query execution without exposing secrets)
  app.get('/api/health', (_req, res) => {
    database.db.prepare('SELECT 1 AS ok').get();
    const setupStatus = database.getSetupStatus();
    const backups = database.listBackups();
    res.json({
      ok: true,
      storage: 'sqlite-wal',
      setupRequired: setupStatus.setupRequired,
      backupCount: backups.length,
      lastBackupAt: backups[0]?.createdAt || null,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Safe Public Auth Metadata (ZERO personnel directory / PII exposure)
  app.get('/api/auth/status', (_req, res) => {
    const firebaseConfigured = Boolean(resolveFirebaseProjectId(database));
    res.json(database.getAuthPublicStatus(firebaseConfigured, DEMO_SEED_ALLOWED));
  });

  app.get('/api/auth/directory', (_req, res) => {
    const firebaseConfigured = Boolean(resolveFirebaseProjectId(database));
    res.json(database.getAuthPublicStatus(firebaseConfigured, DEMO_SEED_ALLOWED));
  });

  app.get('/api/auth/session', (req: AuthenticatedRequest, res) => {
    attachSession(req);
    const settings = database.getSettings();
    const setupStatus = database.getSetupStatus();
    const firebaseConfigured = Boolean(resolveFirebaseProjectId(database));
    res.json({
      authenticated: Boolean(req.authUser),
      user: req.authUser || null,
      expiredReason: req.sessionExpiredReason || null,
      setupRequired: setupStatus.setupRequired,
      allowSelfRegistration: Boolean(settings.allowSelfRegistration),
      privacyNoticeText: settings.privacyNoticeText || DEFAULT_SETTINGS.privacyNoticeText || '',
      demoSeedAllowed: DEMO_SEED_ALLOWED,
      firebaseConfigured,
      sessionTimeoutMinutes: settings.sessionTimeoutMinutes ?? 30,
      branding: {
        appName: settings.appName || DEFAULT_APP_NAME,
        appLogoDataUrl: settings.appLogoDataUrl || '',
        municipalityName: settings.municipalityName || DEFAULT_SETTINGS.municipalityName,
      },
    });
  });

  // One-Time Initial Super Administrator Setup (only when 0 password-protected accounts exist)
  app.post('/api/auth/setup', authRateLimiter, (req, res) => {
    const parsed = SetupAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const strength = validatePasswordStrength(parsed.data.password);
    if (!strength.ok) {
      res.status(400).json({ error: strength.error });
      return;
    }

    const ip = getClientIp(req);
    const adminUser = database.setupInitialAdmin({
      email: parsed.data.email,
      displayName: sanitizeSpreadsheetText(parsed.data.displayName),
      position: sanitizeSpreadsheetText(parsed.data.position || 'MPDO System Administrator'),
      rawPassword: strength.value,
      ipAddress: ip,
    });

    database.recordLoginMetadata(adminUser.id, ip);
    const sessionId = database.createSession(
      adminUser.id,
      ip,
      String(req.headers['user-agent'] || ''),
      getClientGeoHint(req)
    );
    const signedToken = signSessionToken(sessionId, sessionSecret);
    setSessionCookie(res, req, signedToken);

    const freshUser = database.getSessionUser(sessionId) || adminUser;
    res.status(201).json({ ok: true, user: freshUser, sessionToken: signedToken });
  });

  // Strict Email + Password Sign-In (NO passwordless bypass)
  app.post('/api/auth/login', authRateLimiter, (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const rawSecret = (parsed.data.password ?? parsed.data.passcode ?? '').trim();
    const lookupKey = (parsed.data.email || parsed.data.userId || '').toLowerCase();
    const ip = getClientIp(req);
    const ipScope = `ip:${ip}`;
    const acctScope = `acct:${ip}:${lookupKey}`;

    const ipLock = database.checkLoginLockout(ipScope);
    if (ipLock.locked) {
      res.status(429).json({
        error: `Too many sign-in attempts from this network. Please wait ${ipLock.retryAfterSec} seconds and try again.`,
      });
      return;
    }

    const acctLock = database.checkLoginLockout(acctScope);
    if (acctLock.locked) {
      res.status(429).json({
        error: `Account sign-in temporarily locked due to repeated invalid password attempts. Retry in ${acctLock.retryAfterSec} seconds.`,
      });
      return;
    }

    const storedUser = parsed.data.email
      ? database.getUserByEmailWithHash(parsed.data.email)
      : parsed.data.userId
        ? database.getUserByIdWithHash(parsed.data.userId)
        : null;

    if (!storedUser) {
      database.recordFailedLoginAttempt(ipScope, 25);
      database.recordFailedLoginAttempt(acctScope, 5);
      res.status(401).json({ error: 'Invalid email address or password.' });
      return;
    }

    if (storedUser.approvalStatus && storedUser.approvalStatus !== 'APPROVED') {
      res.status(403).json({
        error:
          storedUser.approvalStatus === 'PENDING'
            ? 'Your account registration is pending MPDO Administrator approval.'
            : 'Your account registration was declined. Contact the MPDO Administrator.',
      });
      return;
    }

    if (!storedUser.isActive) {
      res.status(403).json({
        error: 'This user account has been deactivated. Contact the MPDO Administrator.',
      });
      return;
    }

    if (!storedUser.passcodeHash) {
      res.status(403).json({
        error:
          'This account does not have a password configured yet. Ask your MPDO Administrator to set a password or issue a one-time recovery token.',
      });
      return;
    }

    if (!database.verifyUserPasscode(storedUser, rawSecret)) {
      database.recordFailedLoginAttempt(ipScope, 25);
      const acctResult = database.recordFailedLoginAttempt(acctScope, 5);

      const publicActor = database.getUsers().find((u) => u.id === storedUser.id);
      if (publicActor) {
        database.insertAuditLogRow(
          makeServerAuditEntry(
            publicActor,
            'AUTH_FAILED',
            'Session',
            storedUser.id,
            `Failed password sign-in attempt for ${storedUser.email} from ${ip}`
          )
        );
      }

      if (acctResult.locked) {
        res.status(429).json({
          error: `Too many invalid password attempts. Sign-in locked for ${acctResult.retryAfterSec} seconds.`,
        });
        return;
      }

      res.status(401).json({
        error: `Invalid email address or password. (${acctResult.attemptsRemaining} attempt${acctResult.attemptsRemaining === 1 ? '' : 's'} remaining before temporary lockout.)`,
      });
      return;
    }

    database.clearLoginAttempts(acctScope);
    database.clearLoginAttempts(ipScope);
    database.recordLoginMetadata(storedUser.id, ip);

    const sessionId = database.createSession(
      storedUser.id,
      ip,
      String(req.headers['user-agent'] || ''),
      getClientGeoHint(req)
    );
    const signedToken = signSessionToken(sessionId, sessionSecret);
    setSessionCookie(res, req, signedToken);

    const publicUser = database.getSessionUser(sessionId) || {
      id: storedUser.id,
      uid: storedUser.uid,
      email: storedUser.email,
      displayName: storedUser.displayName,
      role: storedUser.role,
      officeId: storedUser.officeId,
      officeName: storedUser.officeName,
      position: storedUser.position,
      hasPasscode: Boolean(storedUser.passcodeHash),
      isActive: storedUser.isActive,
      approvalStatus: storedUser.approvalStatus || 'APPROVED',
      mustChangePassword: Boolean(storedUser.mustChangePassword),
      allowedModules: storedUser.allowedModules,
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: ip,
      createdAt: storedUser.createdAt,
      updatedAt: storedUser.updatedAt,
    };

    database.insertAuditLogRow(
      makeServerAuditEntry(
        publicUser,
        'LOGIN',
        'Session',
        publicUser.id,
        `Signed in as ${publicUser.displayName} (${publicUser.role}) from ${ip}`
      )
    );

    res.json({ ok: true, user: publicUser, sessionToken: signedToken });
  });

  // Self-Registration (only when enabled in System Settings; requires Administrator approval)
  app.post('/api/auth/register', registrationRateLimiter, (req, res) => {
    const settings = database.getSettings();
    if (!settings.allowSelfRegistration) {
      res.status(403).json({
        error:
          'Self-registration is currently disabled by the MPDO Administrator. Request an account directly from MPDO.',
      });
      return;
    }

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const strength = validatePasswordStrength(parsed.data.password);
    if (!strength.ok) {
      res.status(400).json({ error: strength.error });
      return;
    }

    const ip = getClientIp(req);
    const pendingUser = database.registerPendingUser({
      email: parsed.data.email,
      displayName: sanitizeSpreadsheetText(parsed.data.displayName),
      officeId: parsed.data.officeId,
      position: sanitizeSpreadsheetText(parsed.data.position),
      rawPassword: strength.value,
      ipAddress: ip,
    });

    res.status(201).json({
      ok: true,
      pendingApproval: true,
      user: pendingUser,
      message:
        'Registration submitted. Your account is pending MPDO Administrator verification and activation before you can sign in.',
    });
  });

  // Firebase Google ID Token Sign-In (strict directory match; no hardcoded developer fallback)
  app.post('/api/auth/firebase-login', authRateLimiter, async (req, res) => {
    const parsed = FirebaseLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const ip = getClientIp(req);
    const ipScope = `ip:${ip}`;
    const ipLock = database.checkLoginLockout(ipScope);
    if (ipLock.locked) {
      res.status(429).json({
        error: `Too many sign-in attempts. Please wait ${ipLock.retryAfterSec} seconds.`,
      });
      return;
    }

    const projectId = resolveFirebaseProjectId(database);

    try {
      const verified = await verifyFirebaseIdToken(parsed.data.idToken, projectId);
      if (!verified.emailVerified) {
        res.status(403).json({
          error: 'Google account email must be verified before signing into LGU Bula PPA Monitoring System.',
        });
        return;
      }

      let matched = database.getUserByEmailWithHash(verified.email);
      const bootstrapEnvEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
      if (!matched && bootstrapEnvEmail && verified.email === bootstrapEnvEmail) {
        const firstAdmin = database
          .getUsers()
          .find((u) => (u.role === 'SUPER_ADMIN' || u.role === 'ADMINISTRATOR') && u.isActive);
        if (firstAdmin) {
          matched = database.getUserByIdWithHash(firstAdmin.id);
        }
      }

      if (
        !matched ||
        !matched.isActive ||
        (matched.approvalStatus && matched.approvalStatus !== 'APPROVED')
      ) {
        database.recordFailedLoginAttempt(ipScope, 25);
        res.status(403).json({
          error: `Account "${verified.email}" is not authorized or active in the LGU Bula Personnel Directory. Ask the MPDO Administrator to approve or activate your account.`,
        });
        return;
      }

      database.clearLoginAttempts(ipScope);
      database.recordLoginMetadata(matched.id, ip);

      const sessionId = database.createSession(
        matched.id,
        ip,
        String(req.headers['user-agent'] || ''),
        getClientGeoHint(req)
      );
      const signedToken = signSessionToken(sessionId, sessionSecret);
      setSessionCookie(res, req, signedToken);

      const publicUser = database.getSessionUser(sessionId)!;
      database.insertAuditLogRow(
        makeServerAuditEntry(
          publicUser,
          'LOGIN',
          'Session',
          publicUser.id,
          `Signed in via verified Google ID token (${verified.email}) from ${ip}`
        )
      );

      res.json({ ok: true, user: publicUser, sessionToken: signedToken });
    } catch (err) {
      database.recordFailedLoginAttempt(ipScope, 25);
      res.status(401).json({
        error: err instanceof Error ? err.message : 'Firebase token verification failed.',
      });
    }
  });

  // Password Recovery Request & Token Confirmation
  app.post('/api/auth/forgot-password', resetRateLimiter, (req, res) => {
    const parsed = ForgotPasswordRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const ip = getClientIp(req);
    const existing = database.getUserByEmailWithHash(parsed.data.email);
    if (existing && existing.isActive) {
      database.runTransaction(() => {
        database.insertAuditLogRow({
          id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userUid: existing.uid,
          userName: existing.displayName,
          userEmail: existing.email,
          userRole: existing.role,
          userOfficeName: existing.officeName,
          action: 'UPDATE',
          entityType: 'PasswordResetRequest',
          entityId: existing.id,
          summary: `Password recovery assistance requested for ${existing.email} from ${ip}`,
          details: 'Awaiting administrator-issued one-time recovery token (no SMTP mailer configured).',
          changes: [],
          timestamp: new Date().toISOString(),
        });
      });
    }

    res.json({
      ok: true,
      emailDeliveryConfigured: false,
      message:
        'Recovery request logged. Automated email delivery is not configured on this server; contact your MPDO Administrator to receive a one-time recovery token, then complete your reset on the next tab.',
    });
  });

  app.post('/api/auth/reset-password', resetRateLimiter, (req, res) => {
    const parsed = ResetPasswordConfirmSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const strength = validatePasswordStrength(parsed.data.newPassword);
    if (!strength.ok) {
      res.status(400).json({ error: strength.error });
      return;
    }

    const ip = getClientIp(req);
    const updatedUser = database.consumeResetToken(
      parsed.data.email,
      parsed.data.token,
      strength.value,
      ip
    );

    res.json({
      ok: true,
      user: updatedUser,
      message: 'Password updated successfully. You may now sign in with your new password.',
    });
  });

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    attachSession(req);
    if (req.sessionId) {
      database.deleteSession(req.sessionId);
    }
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  // Authenticated User Profile, Password Change & Active Session Management
  app.put('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const actingUser = req.authUser!;
    const parsed = ProfileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const result = database.updateOwnProfile(
      actingUser.id,
      {
        displayName: sanitizeSpreadsheetText(parsed.data.displayName),
        position: sanitizeSpreadsheetText(parsed.data.position),
      },
      makeServerAuditEntry(
        actingUser,
        'UPDATE',
        'UserProfile',
        actingUser.id,
        `Updated personal profile (${parsed.data.displayName})`
      )
    );
    res.json({ ok: true, user: result.user, auditLog: result.auditLog });
  });

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
    const actingUser = req.authUser!;
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const stored = database.getUserByIdWithHash(actingUser.id);
    if (!stored) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    if (stored.passcodeHash && !database.verifyUserPasscode(stored, parsed.data.currentPassword)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const strength = validatePasswordStrength(parsed.data.newPassword);
    if (!strength.ok) {
      res.status(400).json({ error: strength.error });
      return;
    }

    const result = database.updateOwnPassword(
      actingUser.id,
      strength.value,
      req.sessionId,
      makeServerAuditEntry(
        actingUser,
        'UPDATE',
        'UserPassword',
        actingUser.id,
        `Changed account password for ${actingUser.email} (other sessions revoked)`
      )
    );
    res.json({ ok: true, user: result.user, auditLog: result.auditLog });
  });

  app.get('/api/auth/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
    const sessions = database.getUserSessions(req.authUser!.id, req.sessionId);
    res.json({ sessions });
  });

  app.get(
    '/api/auth/sessions/overview',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const overview = database.getActiveSessionsOverview(req.sessionId);
      res.json(overview);
    }
  );

  app.delete(
    '/api/auth/admin/sessions/:id',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const targetSession = database.getSessionRecordById(paramParsed.data.id);
      if (!targetSession) {
        res.status(404).json({ error: 'Active session not found.' });
        return;
      }

      const targetUser = database.getUserByIdWithHash(targetSession.userId);
      if (targetUser?.role === 'SUPER_ADMIN' && actingUser.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'Only a Super Administrator can terminate a Super Administrator session.',
        });
        return;
      }

      database.deleteSession(targetSession.id);
      const auditLog = database.runTransaction(() =>
        database.insertAuditLogRow(
          makeServerAuditEntry(
            actingUser,
            'DELETE',
            'Session',
            targetSession.id,
            `Terminated active session for ${targetUser?.displayName || targetSession.userId} from IP ${targetSession.ipAddress || 'unknown'}`
          )
        )
      );

      if (targetSession.id === req.sessionId) {
        clearSessionCookie(res, req);
      }
      res.json({
        ok: true,
        revokedCurrent: targetSession.id === req.sessionId,
        auditLog,
      });
    }
  );

  app.delete('/api/auth/sessions/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const paramParsed = IdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
      return;
    }
    const removed = database.revokeUserSession(req.authUser!.id, paramParsed.data.id);
    if (!removed) {
      res.status(404).json({ error: 'Active session not found.' });
      return;
    }
    if (paramParsed.data.id === req.sessionId) {
      clearSessionCookie(res, req);
    }
    res.json({ ok: true, revokedCurrent: paramParsed.data.id === req.sessionId });
  });

  // Protected Bootstrap (scoped strictly by role & office)
  app.get('/api/bootstrap', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json(database.getScopedDatabasePayload(req.authUser!, DEMO_SEED_ALLOWED));
  });

  // Programs CRUD (SUPER_ADMIN, ADMINISTRATOR, or office-scoped OFFICE_HEAD / ENCODER)
  app.post(
    '/api/programs',
    requireAuth,
    requireModule('programs'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = ProgramRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const clean = sanitizeProgramInput(parsed.data.program as Program);
      if (isOfficeScopedRole(actingUser.role)) {
        clean.officeId = actingUser.officeId;
        clean.officeName = actingUser.officeName;
      }

      if (database.getProgramById(clean.id)) {
        res.status(409).json({ error: 'Program with this ID already exists.' });
        return;
      }

      const now = new Date().toISOString();
      clean.createdAt = clean.createdAt || now;
      clean.updatedAt = now;

      const auditLog = database.createProgram(
        clean,
        makeServerAuditEntry(
          actingUser,
          'CREATE',
          'Program',
          clean.id,
          `Created program ${clean.aipRefCode}: ${clean.title}`
        )
      );

      res.json({ ok: true, program: clean, auditLog });
    }
  );

  app.put(
    '/api/programs/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER', 'EVALUATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const parsed = ProgramRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const existing = database.getProgramById(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Program not found.' });
        return;
      }

      if (!isOwnedByUserOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Office personnel can only modify Programs assigned to their own office.',
        });
        return;
      }

      const clean = sanitizeProgramInput(parsed.data.program as Program);
      let updated: Program;

      if (actingUser.role === 'EVALUATOR') {
        if (!hasModuleAccess(actingUser, 'status') && !hasModuleAccess(actingUser, 'evaluation')) {
          res.status(403).json({ error: 'Evaluator does not have Accomplishment Status module access.' });
          return;
        }
        const lockedChanges = getEvaluatorProgramLockedFieldChanges(existing, clean);
        if (lockedChanges.length > 0) {
          res.status(403).json({
            error: `Access denied: Evaluators can only update program accomplishment status. Locked field(s): ${lockedChanges.slice(0, 5).join(', ')}`,
          });
          return;
        }
        updated = {
          ...existing,
          status: clean.status || existing.status || 'PENDING',
          updatedAt: new Date().toISOString(),
        };
      } else {
        if (!hasModuleAccess(actingUser, 'programs') && !hasModuleAccess(actingUser, 'status')) {
          res.status(403).json({ error: 'Missing required module permission to update program.' });
          return;
        }
        updated = {
          ...existing,
          ...clean,
          id: existing.id,
          status: clean.status || existing.status || 'PENDING',
          officeId: isOfficeScopedRole(actingUser.role) ? actingUser.officeId : clean.officeId,
          officeName: isOfficeScopedRole(actingUser.role) ? actingUser.officeName : clean.officeName,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        };
      }

      const diffs = computeProgramDiff(existing, updated);
      const suppChanged = (existing.supplementalBudget ?? 0) !== (updated.supplementalBudget ?? 0);
      const statusChanged = (existing.status || 'PENDING') !== (updated.status || 'PENDING');
      const auditAction: AuditActionType =
        statusChanged && !suppChanged && diffs.length === 1 ? 'STATUS_CHANGE' : 'UPDATE';
      const auditLog = database.updateProgram(
        updated,
        makeServerAuditEntry(
          actingUser,
          auditAction,
          'Program',
          updated.id,
          suppChanged
            ? `Adjusted supplemental budget for ${updated.aipRefCode}: ${updated.title}`
            : statusChanged
              ? `Changed accomplishment status of program ${updated.aipRefCode} from ${existing.status || 'PENDING'} to ${updated.status || 'PENDING'}`
              : `Updated program ${updated.aipRefCode}: ${updated.title}`,
          diffs.map((d) => `${d.field}: ${d.before} → ${d.after}`).join(' | '),
          diffs
        ),
        parsed.data.expectedUpdatedAt
      );

      res.json({ ok: true, program: updated, auditLog });
    }
  );

  app.delete(
    '/api/programs/:id',
    requireAuth,
    requireModule('programs'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const existing = database.getProgramById(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Program not found.' });
        return;
      }

      if (!isOwnedByUserOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Office personnel can only delete Programs assigned to their own office.',
        });
        return;
      }

      const auditLog = database.deleteProgram(
        existing.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'Program',
          existing.id,
          `Deleted program ${existing.aipRefCode}: ${existing.title}`
        )
      );

      res.json({ ok: true, auditLog });
    }
  );

  // Activities CRUD
  app.post(
    '/api/activities',
    requireAuth,
    requireModule('programs'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = ActivityRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const clean = sanitizeActivityInput(parsed.data.activity as Activity);
      if (isOfficeScopedRole(actingUser.role)) {
        clean.officeId = actingUser.officeId;
        clean.officeName = actingUser.officeName;
      }

      if (database.getActivityById(clean.id)) {
        res.status(409).json({ error: 'Activity with this ID already exists.' });
        return;
      }

      const parentProg = database.getProgramById(clean.programId);
      if (parentProg) {
        clean.status = parentProg.status || clean.status || 'PENDING';
        if (parentProg.sourceOfFund) {
          clean.sourceOfFund = parentProg.sourceOfFund;
        }
      }

      const now = new Date().toISOString();
      clean.createdBy = actingUser.uid;
      clean.updatedBy = actingUser.uid;
      clean.createdAt = clean.createdAt || now;
      clean.updatedAt = now;

      const auditLog = database.createActivity(
        clean,
        makeServerAuditEntry(
          actingUser,
          'CREATE',
          'Activity',
          clean.id,
          `Created PPA ${clean.referenceNumber}: ${clean.description}`
        )
      );

      res.json({ ok: true, activity: clean, auditLog });
    }
  );

  app.put(
    '/api/activities/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER', 'EVALUATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const parsed = ActivityRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const existing = database.getActivityById(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Activity not found.' });
        return;
      }

      if (!isOwnedByUserOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Office personnel can only update activities assigned to their own office.',
        });
        return;
      }

      const clean = sanitizeActivityInput(parsed.data.activity as Activity);
      let updated: Activity;

      if (actingUser.role === 'EVALUATOR') {
        if (!hasModuleAccess(actingUser, 'status') && !hasModuleAccess(actingUser, 'evaluation')) {
          res.status(403).json({ error: 'Evaluator does not have Accomplishment or Evaluation module access.' });
          return;
        }
        const lockedChanges = getEvaluatorLockedFieldChanges(existing, clean);
        if (lockedChanges.length > 0) {
          res.status(403).json({
            error: `Access denied: Evaluators can only update implementation status, completion percentage, and evaluation remarks. Locked field(s): ${lockedChanges.slice(0, 5).join(', ')}`,
          });
          return;
        }
        updated = {
          ...existing,
          status: clean.status,
          completionPct: clean.completionPct ?? existing.completionPct ?? 0,
          remarks: clean.remarks,
          updatedBy: actingUser.uid,
          updatedAt: new Date().toISOString(),
        };
      } else {
        if (!hasModuleAccess(actingUser, 'programs') && !hasModuleAccess(actingUser, 'status')) {
          res.status(403).json({ error: 'Missing required module permission to update activity.' });
          return;
        }
        updated = {
          ...existing,
          ...clean,
          id: existing.id,
          officeId: isOfficeScopedRole(actingUser.role) ? actingUser.officeId : clean.officeId,
          officeName: isOfficeScopedRole(actingUser.role) ? actingUser.officeName : clean.officeName,
          createdBy: existing.createdBy,
          createdAt: existing.createdAt,
          updatedBy: actingUser.uid,
          updatedAt: new Date().toISOString(),
        };
      }

      const diffs = computeActivityDiff(existing, updated);
      const statusChanged = existing.status !== updated.status;
      const auditLog = database.updateActivity(
        updated,
        makeServerAuditEntry(
          actingUser,
          statusChanged ? 'STATUS_CHANGE' : 'UPDATE',
          'Activity',
          updated.id,
          statusChanged
            ? `Changed status of ${updated.referenceNumber} from ${existing.status} to ${updated.status}`
            : `Updated PPA ${updated.referenceNumber}: ${updated.description}`,
          diffs
            .slice(0, 8)
            .map((d) => `${d.field}: ${d.before} → ${d.after}`)
            .join(' | '),
          diffs
        ),
        parsed.data.expectedUpdatedAt
      );

      res.json({ ok: true, activity: updated, auditLog });
    }
  );

  app.post(
    '/api/activities/reorder',
    requireAuth,
    requireModule('programs'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = ReorderActivitiesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const updates = parsed.data.updates;
      if (isOfficeScopedRole(actingUser.role)) {
        for (const u of updates) {
          const act = database.getActivityById(u.id);
          if (!act || !isOwnedByUserOffice(actingUser, act.officeId, act.officeName)) {
            res.status(403).json({
              error: 'Access denied: Cannot reorder activities outside your assigned office.',
            });
            return;
          }
        }
      }

      const firstAct = database.getActivityById(updates[0].id);
      const now = new Date().toISOString();
      const auditLog = database.reorderActivities(
        updates,
        now,
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'ActivitySequence',
          firstAct?.programId || 'reorder',
          `Reordered ${updates.length} PPA item(s) in program sequence`
        )
      );

      res.json({ ok: true, updatedAt: now, auditLog });
    }
  );

  app.delete(
    '/api/activities/:id',
    requireAuth,
    requireModule('programs'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const existing = database.getActivityById(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Activity not found.' });
        return;
      }

      if (!isOwnedByUserOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Office personnel can only delete activities assigned to their own office.',
        });
        return;
      }

      const auditLog = database.deleteActivity(
        existing.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'Activity',
          existing.id,
          `Deleted PPA ${existing.referenceNumber}: ${existing.description}`
        )
      );

      res.json({ ok: true, auditLog });
    }
  );

  // Remarks Logs
  app.post(
    '/api/remarks',
    requireAuth,
    requireModule('evaluation'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER', 'EVALUATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = RemarkRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const remarkInput = parsed.data.remark;
      const targetActivity = database.getActivityById(remarkInput.activityId);
      if (!targetActivity) {
        res.status(404).json({ error: 'Target activity not found.' });
        return;
      }

      if (!isOwnedByUserOffice(actingUser, targetActivity.officeId, targetActivity.officeName)) {
        res.status(403).json({
          error: 'Access denied: Office personnel can only log observations on their own office PPAs.',
        });
        return;
      }

      const remark: RemarkLog = {
        id: remarkInput.id,
        activityId: remarkInput.activityId,
        authorUid: actingUser.uid,
        authorName: actingUser.displayName,
        authorRole: actingUser.role,
        observation: sanitizeSpreadsheetText(remarkInput.observation),
        monitoringDate: remarkInput.monitoringDate,
        createdAt: new Date().toISOString(),
      };

      const auditLog = database.createRemark(
        remark,
        makeServerAuditEntry(
          actingUser,
          'CREATE',
          'Remark',
          remark.id,
          `Added M&E observation for activity ${targetActivity.referenceNumber}`
        )
      );

      res.json({ ok: true, remark, auditLog });
    }
  );

  app.delete(
    '/api/remarks/:id',
    requireAuth,
    requireModule('evaluation'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR', 'OFFICE_HEAD', 'ENCODER', 'EVALUATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const existing = database.getRemarkById(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Remark not found.' });
        return;
      }

      if (actingUser.role === 'EVALUATOR' && existing.authorUid !== actingUser.uid) {
        res.status(403).json({
          error: 'Evaluators can only delete their own field monitoring remarks.',
        });
        return;
      }

      const parentActivity = database.getActivityById(existing.activityId);
      if (
        isOfficeScopedRole(actingUser.role) &&
        (!parentActivity ||
          !isOwnedByUserOffice(actingUser, parentActivity.officeId, parentActivity.officeName))
      ) {
        res.status(403).json({
          error: 'Access denied: Cannot delete observations outside your office scope.',
        });
        return;
      }

      const auditLog = database.deleteRemark(
        existing.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'Remark',
          existing.id,
          `Deleted monitoring observation ${existing.id}`
        )
      );

      res.json({ ok: true, auditLog });
    }
  );

  // Municipal Offices (Administrator / Super Admin)
  app.post(
    '/api/offices',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = OfficeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const officeInput = parsed.data.office;
      const office: Office = {
        id: officeInput.id,
        code: sanitizeSpreadsheetText(officeInput.code).toUpperCase(),
        name: sanitizeSpreadsheetText(officeInput.name),
        headName: sanitizeSpreadsheetText(officeInput.headName || 'Department Head'),
        createdAt: officeInput.createdAt || new Date().toISOString(),
      };

      const existing = database.getOffices();
      if (
        existing.some(
          (o) =>
            o.code.toLowerCase() === office.code.toLowerCase() ||
            o.name.toLowerCase() === office.name.toLowerCase()
        )
      ) {
        res.status(409).json({
          error: `Office "${office.code}" or "${office.name}" already exists.`,
        });
        return;
      }

      const result = database.createOffice(
        office,
        makeServerAuditEntry(
          actingUser,
          'CREATE',
          'Office',
          office.id,
          `Added office ${office.code}: ${office.name}`
        )
      );

      res.json({ ok: true, office, createdUser: result.createdUser, auditLog: result.auditLog });
    }
  );

  app.put(
    '/api/offices/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const parsed = OfficeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const existingOffices = database.getOffices();
      const target = existingOffices.find((o) => o.id === paramParsed.data.id);
      if (!target) {
        res.status(404).json({ error: 'Office not found.' });
        return;
      }

      const officeInput = parsed.data.office;
      const cleanCode = sanitizeSpreadsheetText(officeInput.code).toUpperCase();
      const cleanName = sanitizeSpreadsheetText(officeInput.name);
      const cleanHead = sanitizeSpreadsheetText(officeInput.headName || 'Department Head');

      if (
        existingOffices.some(
          (o) =>
            o.id !== target.id &&
            (o.code.toLowerCase() === cleanCode.toLowerCase() ||
              o.name.toLowerCase() === cleanName.toLowerCase())
        )
      ) {
        res.status(409).json({
          error: `Office "${cleanCode}" or "${cleanName}" already exists.`,
        });
        return;
      }

      const updatedOffice: Office = {
        ...target,
        code: cleanCode,
        name: cleanName,
        headName: cleanHead,
      };

      const diffs: AuditChangeDiff[] = [];
      if (target.code !== cleanCode)
        diffs.push({ field: 'Code', before: target.code, after: cleanCode });
      if (target.name !== cleanName)
        diffs.push({ field: 'Office Name', before: target.name, after: cleanName });
      if (target.headName !== cleanHead)
        diffs.push({ field: 'Department Head', before: target.headName, after: cleanHead });

      const auditLog = database.updateOffice(
        updatedOffice,
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'Office',
          updatedOffice.id,
          `Updated office ${updatedOffice.code}: ${updatedOffice.name}`,
          diffs.map((d) => `${d.field}: ${d.before} → ${d.after}`).join(' | '),
          diffs
        )
      );

      res.json({ ok: true, office: updatedOffice, auditLog });
    }
  );

  app.delete(
    '/api/offices/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const existing = database.getOffices().find((o) => o.id === paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Office not found.' });
        return;
      }

      const auditLog = database.deleteOffice(
        existing.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'Office',
          existing.id,
          `Removed office ${existing.code}: ${existing.name}`
        )
      );

      res.json({ ok: true, auditLog });
    }
  );

  // Fiscal Years
  app.post(
    '/api/fiscal-years',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = FiscalYearRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const fy: FiscalYear = {
        ...parsed.data.fiscalYear,
        createdAt: parsed.data.fiscalYear.createdAt || new Date().toISOString(),
      };

      if (database.getFiscalYears().some((existing) => existing.year === fy.year)) {
        res.status(409).json({ error: `Fiscal Year ${fy.year} already exists.` });
        return;
      }

      const auditLog = database.createFiscalYear(
        fy,
        makeServerAuditEntry(
          actingUser,
          'CREATE',
          'FiscalYear',
          fy.id,
          `Added fiscal year ${fy.label}`
        )
      );

      res.json({ ok: true, fiscalYear: fy, auditLog });
    }
  );

  app.put(
    '/api/fiscal-years/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const parsed = FiscalYearRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const existing = database.getFiscalYears().find((f) => f.id === paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Fiscal year not found.' });
        return;
      }

      const updated: FiscalYear = {
        ...existing,
        ...parsed.data.fiscalYear,
        id: existing.id,
      };

      const auditLog = database.updateFiscalYear(
        updated,
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'FiscalYear',
          updated.id,
          `Updated fiscal year ${updated.label}`
        )
      );

      res.json({ ok: true, fiscalYear: updated, auditLog });
    }
  );

  app.delete(
    '/api/fiscal-years/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const existing = database.getFiscalYears().find((f) => f.id === paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Fiscal year not found.' });
        return;
      }

      const auditLog = database.deleteFiscalYear(
        existing.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'FiscalYear',
          existing.id,
          `Removed fiscal year ${existing.label}`
        )
      );

      res.json({ ok: true, auditLog });
    }
  );

  // User Management & Lifecycle (SUPER_ADMIN & ADMINISTRATOR)
  app.post(
    '/api/users',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = UserRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const { passcode, clearPasscode: _c, ...rest } = parsed.data.user;
      if (rest.role === 'SUPER_ADMIN' && actingUser.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'Only a Super Administrator can create a SUPER_ADMIN account.',
        });
        return;
      }

      if (database.getUserByEmailWithHash(rest.email)) {
        res.status(409).json({ error: `An account with email "${rest.email}" already exists.` });
        return;
      }

      if (!passcode || !passcode.trim()) {
        res.status(400).json({
          error: 'A strong initial password is required when creating a new user account.',
        });
        return;
      }

      const strength = validatePasswordStrength(passcode);
      if (!strength.ok) {
        res.status(400).json({ error: strength.error });
        return;
      }

      const now = new Date().toISOString();
      const userObj: UserAccount = {
        ...rest,
        uid: rest.uid || rest.id,
        email: rest.email.toLowerCase(),
        displayName: sanitizeSpreadsheetText(rest.displayName),
        officeName: sanitizeSpreadsheetText(rest.officeName),
        position: sanitizeSpreadsheetText(rest.position || 'Monitoring Personnel'),
        approvalStatus: rest.approvalStatus || 'APPROVED',
        mustChangePassword: Boolean(rest.mustChangePassword),
        createdAt: rest.createdAt || now,
        updatedAt: now,
      };

      const result = database.createUser(
        userObj,
        strength.value,
        makeServerAuditEntry(
          actingUser,
          'CREATE',
          'UserAccount',
          userObj.id,
          `Created user ${userObj.displayName} (${userObj.role})`
        )
      );

      res.json({ ok: true, user: result.user, auditLog: result.auditLog });
    }
  );

  app.put(
    '/api/users/:id',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const parsed = UserRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const existing = database.getUserByIdWithHash(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const { passcode, clearPasscode, ...rest } = parsed.data.user;
      if (clearPasscode) {
        res.status(400).json({
          error: 'Passwordless ("Open Profile") login is disabled for production security.',
        });
        return;
      }

      if (
        (existing.role === 'SUPER_ADMIN' || rest.role === 'SUPER_ADMIN') &&
        actingUser.role !== 'SUPER_ADMIN'
      ) {
        res.status(403).json({
          error: 'Only a Super Administrator can modify or assign SUPER_ADMIN privileges.',
        });
        return;
      }

      const emailOwner = database.getUserByEmailWithHash(rest.email);
      if (emailOwner && emailOwner.id !== existing.id) {
        res.status(409).json({ error: `Another account already uses email "${rest.email}".` });
        return;
      }

      if (
        existing.id === actingUser.id &&
        (!rest.isActive || !isAdminRole(rest.role))
      ) {
        res.status(400).json({
          error: 'You cannot deactivate your own active Administrator session or remove your administrative role.',
        });
        return;
      }

      let validNewPasscode: string | undefined;
      if (passcode && passcode.trim()) {
        const strength = validatePasswordStrength(passcode);
        if (!strength.ok) {
          res.status(400).json({ error: strength.error });
          return;
        }
        validNewPasscode = strength.value;
      }

      const updatedUser: UserAccount = {
        ...existing,
        ...rest,
        id: existing.id,
        uid: existing.uid,
        email: rest.email.toLowerCase(),
        displayName: sanitizeSpreadsheetText(rest.displayName),
        officeName: sanitizeSpreadsheetText(rest.officeName),
        position: sanitizeSpreadsheetText(rest.position || 'Monitoring Personnel'),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      const diffs: AuditChangeDiff[] = [];
      if (existing.role !== updatedUser.role)
        diffs.push({ field: 'Role', before: existing.role, after: updatedUser.role });
      if (existing.officeName !== updatedUser.officeName)
        diffs.push({ field: 'Office', before: existing.officeName, after: updatedUser.officeName });
      if (existing.isActive !== updatedUser.isActive)
        diffs.push({
          field: 'Active Status',
          before: String(existing.isActive),
          after: String(updatedUser.isActive),
        });
      if (existing.approvalStatus !== updatedUser.approvalStatus)
        diffs.push({
          field: 'Approval Status',
          before: String(existing.approvalStatus || 'APPROVED'),
          after: String(updatedUser.approvalStatus || 'APPROVED'),
        });
      if (validNewPasscode)
        diffs.push({ field: 'Password', before: 'Protected', after: 'Updated (scrypt hash)' });

      const result = database.updateUser(
        updatedUser,
        { rawPasscode: validNewPasscode, clearPasscode: false },
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'UserAccount',
          updatedUser.id,
          `Updated user ${updatedUser.displayName} (${updatedUser.role})`,
          diffs.map((d) => `${d.field}: ${d.before} → ${d.after}`).join(' | '),
          diffs
        )
      );

      res.json({ ok: true, user: result.user, auditLog: result.auditLog });
    }
  );

  app.post(
    '/api/users/:id/approve',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const parsed = ApproveUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const existing = database.getUserByIdWithHash(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      if (
        (existing.role === 'SUPER_ADMIN' || parsed.data.role === 'SUPER_ADMIN') &&
        actingUser.role !== 'SUPER_ADMIN'
      ) {
        res.status(403).json({
          error: 'Only a Super Administrator can approve or assign SUPER_ADMIN roles.',
        });
        return;
      }

      const result = database.approveUser(
        existing.id,
        parsed.data,
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'UserApproval',
          existing.id,
          `Set approval status for ${existing.displayName} (${existing.email}) to ${parsed.data.approvalStatus}`
        )
      );
      res.json({ ok: true, user: result.user, auditLog: result.auditLog });
    }
  );

  app.post(
    '/api/users/:id/reset-token',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const parsed = IssueResetTokenSchema.safeParse(req.body || {});
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const existing = database.getUserByIdWithHash(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      if (existing.role === 'SUPER_ADMIN' && actingUser.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'Only a Super Administrator can issue a recovery token for a SUPER_ADMIN account.',
        });
        return;
      }

      const issued = database.createResetToken(
        existing.id,
        actingUser.uid,
        parsed.data.expiresMinutes,
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'PasswordResetToken',
          existing.id,
          `Issued single-use password recovery token for ${existing.email} (valid ${parsed.data.expiresMinutes} min)`
        )
      );

      res.json({
        ok: true,
        resetToken: issued.rawToken,
        expiresAt: issued.expiresAt,
        auditLog: issued.auditLog,
      });
    }
  );

  app.delete(
    '/api/users/:id',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      if (paramParsed.data.id === actingUser.id) {
        res.status(400).json({ error: 'You cannot delete your own signed-in user account.' });
        return;
      }

      const existing = database.getUserByIdWithHash(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      if (existing.role === 'SUPER_ADMIN' && actingUser.role !== 'SUPER_ADMIN') {
        res.status(403).json({
          error: 'Only a Super Administrator can delete a SUPER_ADMIN account.',
        });
        return;
      }

      const auditLog = database.deleteUser(
        existing.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'UserAccount',
          existing.id,
          `Deleted user ${existing.displayName} (${existing.role})`
        )
      );

      res.json({ ok: true, auditLog });
    }
  );

  app.post(
    '/api/users/provision-offices',
    requireAuth,
    requireModule('users'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const result = database.provisionOfficeAccounts(
        makeServerAuditEntry(
          actingUser,
          'CREATE',
          'UserAccount',
          'office-provision',
          'Provisioned dedicated monitoring accounts for missing LGU offices'
        )
      );
      res.json({ ok: true, users: result.users, created: result.created, auditLog: result.auditLog });
    }
  );

  // Settings
  app.put(
    '/api/settings',
    requireAuth,
    requireModule('settings'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = SettingsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const currentSettings = database.getSettings();
      const input = parsed.data.settings;
      const nextAppName =
        input.appName && input.appName.trim().length > 0
          ? input.appName.trim().slice(0, 140)
          : currentSettings.appName?.trim() || DEFAULT_APP_NAME;

      let nextLogo = currentSettings.appLogoDataUrl || '';
      if (typeof input.appLogoDataUrl === 'string') {
        const logoResult = validateAndSanitizeLogoDataUrl(input.appLogoDataUrl);
        if (!logoResult.ok) {
          res.status(400).json({ error: logoResult.error });
          return;
        }
        nextLogo = logoResult.dataUrl;
      }

      const updatedSettings: SystemSettings = {
        ...DEFAULT_SETTINGS,
        ...currentSettings,
        ...input,
        appName: nextAppName,
        appLogoDataUrl: nextLogo,
      };

      const auditLog = database.updateSettings(
        updatedSettings,
        makeServerAuditEntry(
          actingUser,
          'SETTINGS',
          'SystemSettings',
          'global',
          `Updated system settings, security policies & branding (${nextAppName})`
        )
      );

      res.json({ ok: true, settings: updatedSettings, auditLog });
    }
  );

  // Audit Logs & Integrity Verification (supports server-side pagination + filtering)
  app.get('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
    const actingUser = req.authUser!;
    const queryParsed = AuditLogsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({ error: formatValidationError(queryParsed.error.issues) });
      return;
    }

    let allowedUids: Set<string> | null = null;
    if (isOfficeScopedRole(actingUser.role) && actingUser.officeId) {
      allowedUids = new Set(
        database
          .getUsers()
          .filter((u) => u.officeId === actingUser.officeId)
          .map((u) => u.uid)
      );
      allowedUids.add(actingUser.uid);
    }

    if (
      queryParsed.data.page !== undefined ||
      queryParsed.data.pageSize !== undefined ||
      queryParsed.data.userUid !== undefined ||
      queryParsed.data.dateFrom !== undefined ||
      queryParsed.data.dateTo !== undefined
    ) {
      const paginated = database.getAuditLogsPaginated({
        page: queryParsed.data.page,
        pageSize: queryParsed.data.pageSize,
        action: queryParsed.data.action,
        search: queryParsed.data.search,
        userUid: queryParsed.data.userUid,
        dateFrom: queryParsed.data.dateFrom,
        dateTo: queryParsed.data.dateTo,
        tzOffsetMinutes: queryParsed.data.tzOffsetMinutes,
        allowedUids,
      });
      res.json(paginated);
      return;
    }

    const limit = queryParsed.data.limit ?? 200;
    let logs = database.getAuditLogs(1000);
    if (allowedUids) {
      logs = logs.filter((l) => allowedUids!.has(l.userUid));
    }
    res.json({ auditLogs: logs.slice(0, limit) });
  });

  app.get(
    '/api/audit-logs/verify',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (_req: AuthenticatedRequest, res) => {
      res.json(database.verifyAuditChain());
    }
  );

  app.post('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
    const actingUser = req.authUser!;
    const parsed = ClientAuditLogSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const auditLog = database.runTransaction(() =>
      database.insertAuditLogRow(
        makeServerAuditEntry(
          actingUser,
          parsed.data.action,
          parsed.data.entityType,
          parsed.data.entityId,
          parsed.data.summary,
          parsed.data.details || ''
        )
      )
    );

    res.json({ ok: true, auditLog });
  });

  // Batch Excel Import (Administrator-only; atomic SQLite transaction + formula sanitization)
  app.post(
    '/api/import-batch',
    requireAuth,
    requireModule('excel'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = ImportBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const now = new Date().toISOString();
      const newOffices: Office[] = (parsed.data.newOffices || []).map((o) => ({
        id: o.id,
        code: sanitizeSpreadsheetText(o.code).toUpperCase(),
        name: sanitizeSpreadsheetText(o.name),
        headName: sanitizeSpreadsheetText(o.headName || 'Department Head'),
        createdAt: o.createdAt || now,
      }));
      const newPrograms: Program[] = parsed.data.newPrograms.map((p) =>
        sanitizeProgramInput({
          ...(p as Program),
          createdAt: p.createdAt || now,
          updatedAt: now,
        })
      );
      const newActivities: Activity[] = parsed.data.newActivities.map((a) =>
        sanitizeActivityInput({
          ...(a as Activity),
          createdBy: actingUser.uid,
          updatedBy: actingUser.uid,
          createdAt: a.createdAt || now,
          updatedAt: now,
        })
      );
      const updatedActivities: Activity[] = parsed.data.updatedActivities.map((a) =>
        sanitizeActivityInput({
          ...(a as Activity),
          updatedBy: actingUser.uid,
          updatedAt: now,
        })
      );
      const uploadedDocument: UploadedDocument = {
        ...parsed.data.uploadedDocument,
        fileName: sanitizeSpreadsheetText(parsed.data.uploadedDocument.fileName),
        uploadedByUid: actingUser.uid,
        uploadedByName: actingUser.displayName,
        uploadedAt: now,
      };

      database.importBatch(
        {
          newOffices,
          newPrograms,
          updatedActivities,
          newActivities,
          uploadedDocument,
        },
        makeServerAuditEntry(
          actingUser,
          'IMPORT',
          'ExcelWorkbook',
          uploadedDocument.id,
          `Imported ${uploadedDocument.fileName} (${uploadedDocument.recordsImported} records)`
        )
      );

      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser, DEMO_SEED_ALLOWED) });
    }
  );

  // Sample Demo Seed & Reset (Demo seed strictly gated in production)
  app.post(
    '/api/seed-demo',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      if (!DEMO_SEED_ALLOWED) {
        res.status(403).json({
          error:
            'Demo dataset seeding is disabled in production mode. Set ALLOW_DEMO_SEED=true only for staging evaluation.',
        });
        return;
      }
      const actingUser = req.authUser!;
      const sample = buildSampleLGUBulaDataset();
      database.seedDemo(
        sample,
        makeServerAuditEntry(
          actingUser,
          'IMPORT',
          'Dataset',
          'sample-lgu-bula',
          'Loaded sample LGU Bula FY 2026 PPA dataset'
        )
      );
      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser, DEMO_SEED_ALLOWED) });
    }
  );

  app.post(
    '/api/reset-data',
    requireAuth,
    requireModule('settings'),
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      database.resetPPAData(
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'Dataset',
          'all-ppa',
          'Cleared all Programs, Activities, and Remarks'
        )
      );
      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser, DEMO_SEED_ALLOWED) });
    }
  );

  // Database Snapshots, SHA-256 Verification, Retention Pruning & Atomic Restore
  app.get(
    '/api/backups',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (_req: AuthenticatedRequest, res) => {
      res.json({ backups: database.listBackups() });
    }
  );

  app.post(
    '/api/backups',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const settings = database.getSettings();
      const result = database.createBackupSnapshot(
        makeServerAuditEntry(
          actingUser,
          'BACKUP',
          'Database',
          'snapshot',
          `Created verified database snapshot backup (${database.getPrograms().length} programs, ${database.getActivities().length} activities)`
        ),
        'MANUAL',
        settings.backupRetentionCount ?? 14
      );
      res.json({ ok: true, backup: result.backup, auditLog: result.auditLog });
    }
  );

  app.post(
    '/api/backups/:fileName/verify',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const paramParsed = BackupFileParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }
      const verification = database.verifyBackupSnapshot(paramParsed.data.fileName);
      res.json(verification);
    }
  );

  app.get(
    '/api/backups/:fileName',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const paramParsed = BackupFileParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }
      const filePath = database.getBackupFilePath(paramParsed.data.fileName);
      if (!filePath) {
        res.status(404).json({ error: 'Backup snapshot file not found.' });
        return;
      }
      res.download(filePath, paramParsed.data.fileName);
    }
  );

  app.post(
    '/api/backups/restore',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = RestoreBackupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const snap = parsed.data.snapshot;
      if (snap.settings.appLogoDataUrl) {
        const logoCheck = validateAndSanitizeLogoDataUrl(snap.settings.appLogoDataUrl);
        if (!logoCheck.ok) {
          res.status(400).json({ error: `Backup logo invalid: ${logoCheck.error}` });
          return;
        }
        snap.settings.appLogoDataUrl = logoCheck.dataUrl;
      }

      database.restoreSnapshot(
        {
          offices: snap.offices as Office[],
          users: snap.users as (UserAccount & { passcodeHash?: string | null })[],
          fiscalYears: snap.fiscalYears as FiscalYear[],
          programs: snap.programs as Program[],
          activities: snap.activities as Activity[],
          remarksLogs: snap.remarksLogs as RemarkLog[],
          uploadedDocuments: snap.uploadedDocuments as UploadedDocument[],
          settings: snap.settings as SystemSettings,
        },
        makeServerAuditEntry(
          actingUser,
          'RESTORE',
          'Database',
          'snapshot',
          `Restored database snapshot (${snap.programs.length} programs, ${snap.activities.length} activities)`
        )
      );

      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser, DEMO_SEED_ALLOWED) });
    }
  );

  // Official Blank Document Templates (Authorized Read/Download; Admin-Only Upload/Version/Manage)
  const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
  const TEMPLATE_MIME_MAP: Record<'xlsx' | 'docx' | 'pdf', string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
  };

  const hasTemplateReadAccess = (user: UserAccount) =>
    isAdminRole(user.role) ||
    hasModuleAccess(user, 'reports') ||
    hasModuleAccess(user, 'excel') ||
    hasModuleAccess(user, 'settings');

  const validateTemplateMagicBytes = (format: 'xlsx' | 'docx' | 'pdf', buf: Buffer): boolean => {
    if (buf.length < 8) return false;
    if (format === 'pdf') {
      return buf.subarray(0, 5).toString('ascii') === '%PDF-';
    }
    // OOXML (.xlsx / .docx) is a ZIP archive starting with PK\x03\x04
    return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  };

  app.get('/api/templates', requireAuth, (req: AuthenticatedRequest, res) => {
    const actingUser = req.authUser!;
    if (!hasTemplateReadAccess(actingUser)) {
      res.status(403).json({ error: 'Access denied to official document templates.' });
      return;
    }
    const templates = database.listDocumentTemplates();
    res.json({
      templates: isAdminRole(actingUser.role)
        ? templates
        : templates.filter((t) => t.isActive),
    });
  });

  app.get('/api/templates/:id/download', requireAuth, (req: AuthenticatedRequest, res) => {
    const actingUser = req.authUser!;
    if (!hasTemplateReadAccess(actingUser)) {
      res.status(403).json({ error: 'Access denied to official document templates.' });
      return;
    }
    const paramParsed = IdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
      return;
    }
    const tpl = database.getDocumentTemplateById(paramParsed.data.id);
    if (!tpl || (!tpl.isActive && !isAdminRole(actingUser.role))) {
      res.status(404).json({ error: 'Official document template not found.' });
      return;
    }
    const versionId =
      typeof req.query.versionId === 'string' && req.query.versionId.trim()
        ? req.query.versionId.trim()
        : undefined;
    const bin = database.getTemplateVersionBinary(paramParsed.data.id, versionId);
    if (!bin) {
      res.status(404).json({ error: 'Template binary file could not be located.' });
      return;
    }
    const safeDownloadName = path.basename(bin.fileName).replace(/["\r\n]/g, '_');
    res.setHeader('Content-Type', bin.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName}"`);
    res.sendFile(bin.filePath);
  });

  app.post(
    '/api/templates',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = CreateOrVersionTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const {
        templateId,
        name,
        description,
        format,
        targetReport,
        isDefault,
        isActive,
        fileName,
        mimeType,
        fileBase64,
        notes,
        analysis,
      } = parsed.data;

      const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
      const binary = Buffer.from(cleanBase64, 'base64');
      if (binary.length === 0 || binary.length > MAX_TEMPLATE_BYTES) {
        res.status(400).json({
          error: `Template file must be between 1 byte and 10 MB (received ${(binary.length / (1024 * 1024)).toFixed(2)} MB).`,
        });
        return;
      }

      if (!validateTemplateMagicBytes(format, binary)) {
        res.status(400).json({
          error: `Uploaded file binary header does not match a valid .${format.toUpperCase()} document.`,
        });
        return;
      }

      const safeFileName = sanitizeSpreadsheetText(path.basename(fileName));
      const resolvedMime = mimeType || TEMPLATE_MIME_MAP[format];
      const auditAction: AuditActionType = templateId ? 'UPDATE' : 'CREATE';
      const result = database.createOrVersionDocumentTemplate(
        {
          templateId,
          name: sanitizeSpreadsheetText(name),
          description: sanitizeSpreadsheetText(description),
          format,
          targetReport,
          isDefault,
          isActive,
          fileName: safeFileName,
          mimeType: resolvedMime,
          binary,
          notes: sanitizeSpreadsheetText(notes),
          analysis,
          actorUid: actingUser.uid,
          actorName: actingUser.displayName,
        },
        makeServerAuditEntry(
          actingUser,
          auditAction,
          'DocumentTemplate',
          templateId || safeFileName,
          templateId
            ? `Uploaded new version for official template "${name}" (${safeFileName})`
            : `Uploaded official blank template "${name}" (.${format}, target: ${targetReport})`
        )
      );

      res.status(templateId ? 200 : 201).json({
        ok: true,
        template: result.template,
        auditLog: result.auditLog,
      });
    }
  );

  app.put(
    '/api/templates/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }
      const parsed = UpdateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const cleanUpdates = {
        ...parsed.data,
        name: parsed.data.name ? sanitizeSpreadsheetText(parsed.data.name) : undefined,
        description:
          parsed.data.description !== undefined
            ? sanitizeSpreadsheetText(parsed.data.description)
            : undefined,
      };

      const result = database.updateDocumentTemplate(
        paramParsed.data.id,
        cleanUpdates,
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'DocumentTemplate',
          paramParsed.data.id,
          `Updated official document template settings (${cleanUpdates.name || paramParsed.data.id})`
        )
      );
      res.json({ ok: true, template: result.template, auditLog: result.auditLog });
    }
  );

  app.delete(
    '/api/templates/:id',
    requireAuth,
    requireRoles('SUPER_ADMIN', 'ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }
      const existing = database.getDocumentTemplateById(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'Official document template not found.' });
        return;
      }
      const auditLog = database.deleteDocumentTemplate(
        paramParsed.data.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'DocumentTemplate',
          paramParsed.data.id,
          `Deleted official document template "${existing.name}"`
        )
      );
      res.json({ ok: true, auditLog });
    }
  );

  // Centralized Sanitized API Error Handler
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!req.path.startsWith('/api')) {
        next(err);
        return;
      }
      console.error(`[API Error] ${req.method} ${req.path}:`, err);
      const safe = sanitizeServerError(err);
      res.status(safe.status).json({ error: safe.message });
    }
  );

  if (isProd) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Scheduled Automated Backup Check (every 15 minutes)
  const backupTimer = setInterval(() => {
    try {
      const settings = database.getSettings();
      if (!settings.autoBackupEnabled) return;
      const intervalMs = Math.max(1, settings.autoBackupIntervalHours ?? 24) * 60 * 60 * 1000;
      const lastBackupTs = database.getLastBackupTimestamp();
      if (lastBackupTs !== null && Date.now() - lastBackupTs < intervalMs) return;

      const systemActor: UserAccount = {
        id: 'system-scheduler',
        uid: 'system-scheduler',
        email: 'scheduler@municipalityofbula.gov.ph',
        displayName: 'Automated Backup Scheduler',
        role: 'SUPER_ADMIN',
        officeId: 'off-mpdo',
        officeName: 'Municipal Planning and Development Office',
        position: 'Background Maintenance Service',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      database.createBackupSnapshot(
        makeServerAuditEntry(
          systemActor,
          'BACKUP',
          'Database',
          'scheduled-snapshot',
          `Automated scheduled backup snapshot (${database.getPrograms().length} programs, ${database.getActivities().length} activities)`
        ),
        'SCHEDULED',
        settings.backupRetentionCount ?? 14
      );
    } catch (err) {
      console.error('[Backup Scheduler] Failed to create scheduled snapshot:', err);
    }
  }, 15 * 60 * 1000);
  backupTimer.unref();

  const PORT = Number(process.env.PORT) || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`LGU Bula PPA Monitoring System listening on http://0.0.0.0:${PORT}`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down gracefully...`);
    clearInterval(backupTimer);
    server.close(() => {
      database.close();
      process.exit(0);
    });
    setTimeout(() => {
      database.close();
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();
