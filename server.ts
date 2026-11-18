import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import {
  DEFAULT_APP_NAME,
  DEFAULT_SETTINGS,
  DEFAULT_USERS,
  buildSampleLGUBulaDataset,
} from './src/utils/demoSeedData';
import type {
  Activity,
  AuditActionType,
  AuditChangeDiff,
  AuditLog,
  FiscalYear,
  Office,
  Program,
  RemarkLog,
  SystemSettings,
  UploadedDocument,
  UserAccount,
  UserRole,
} from './src/types/ppa';
import { AppDatabase } from './server/db';
import {
  ActivityRequestSchema,
  AuditLogsQuerySchema,
  BackupFileParamSchema,
  ClientAuditLogSchema,
  FirebaseLoginSchema,
  FiscalYearRequestSchema,
  IdParamSchema,
  ImportBatchSchema,
  LoginSchema,
  OfficeRequestSchema,
  ProgramRequestSchema,
  RemarkRequestSchema,
  ReorderActivitiesSchema,
  RestoreBackupSchema,
  SettingsRequestSchema,
  UserRequestSchema,
} from './server/schemas';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  computeActivityDiff,
  computeProgramDiff,
  getClientIp,
  getSessionSecret,
  parseCookies,
  sanitizeSpreadsheetText,
  setSessionCookie,
  signSessionToken,
  validateAndSanitizeLogoDataUrl,
  verifyFirebaseIdToken,
  verifySignedSessionToken,
} from './server/security';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '.data');

interface AuthenticatedRequest extends express.Request {
  authUser?: UserAccount;
  sessionId?: string;
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
    sector: sanitizeSpreadsheetText(raw.sector || 'General Public Services'),
    sourceOfFund: raw.sourceOfFund ? sanitizeSpreadsheetText(raw.sourceOfFund) : '',
    officeName: sanitizeSpreadsheetText(raw.officeName),
  };
}

function sanitizeActivityInput(raw: Activity): Activity {
  return {
    ...raw,
    referenceNumber: sanitizeSpreadsheetText(raw.referenceNumber),
    description: sanitizeSpreadsheetText(raw.description),
    targetOutputs: raw.targetOutputs ? sanitizeSpreadsheetText(raw.targetOutputs) : '',
    officeName: sanitizeSpreadsheetText(raw.officeName),
    sourceOfFund: raw.sourceOfFund ? sanitizeSpreadsheetText(raw.sourceOfFund) : '',
    remarks: raw.remarks ? sanitizeSpreadsheetText(raw.remarks) : '',
  };
}

function formatValidationError(issues: { path: PropertyKey[]; message: string }[]): string {
  const first = issues[0];
  if (!first) return 'Invalid request payload.';
  const field = first.path.map((p) => String(p)).join('.');
  return field ? `${field}: ${first.message}` : first.message;
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
    const user = database.getSessionUser(sessionId);
    if (!user) return;
    req.authUser = user;
    req.sessionId = sessionId;
  };

  const requireAuth = (
    req: AuthenticatedRequest,
    res: express.Response,
    next: express.NextFunction
  ) => {
    attachSession(req);
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
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

  const isOwnedByEncoderOffice = (
    user: UserAccount,
    targetOfficeId?: string,
    targetOfficeName?: string
  ) => {
    if (user.role !== 'ENCODER') return true;
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

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, storage: 'sqlite-wal', timestamp: new Date().toISOString() });
  });

  // Public Auth Directory (never exposes passcode hashes)
  app.get('/api/auth/directory', (_req, res) => {
    res.json(database.getAuthDirectory());
  });

  app.get('/api/auth/session', (req: AuthenticatedRequest, res) => {
    attachSession(req);
    const settings = database.getSettings();
    res.json({
      authenticated: Boolean(req.authUser),
      user: req.authUser || null,
      branding: {
        appName: settings.appName || DEFAULT_APP_NAME,
        appLogoDataUrl: settings.appLogoDataUrl || '',
        municipalityName: settings.municipalityName || DEFAULT_SETTINGS.municipalityName,
      },
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error.issues) });
      return;
    }

    const { userId, passcode } = parsed.data;
    const ip = getClientIp(req);
    const ipScope = `ip:${ip}`;
    const acctScope = `acct:${ip}:${userId}`;

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
        error: `Account sign-in temporarily locked due to repeated invalid passcode attempts. Retry in ${acctLock.retryAfterSec} seconds.`,
      });
      return;
    }

    const storedUser = database.getUserByIdWithHash(userId);
    if (!storedUser || !storedUser.isActive) {
      database.recordFailedLoginAttempt(ipScope, 25);
      res.status(401).json({ error: 'Selected office account was not found or is inactive.' });
      return;
    }

    if (storedUser.passcodeHash && !database.verifyUserPasscode(storedUser, passcode)) {
      database.recordFailedLoginAttempt(ipScope, 25);
      const acctResult = database.recordFailedLoginAttempt(acctScope, 5);

      const publicActor: UserAccount = {
        id: storedUser.id,
        uid: storedUser.uid,
        email: storedUser.email,
        displayName: storedUser.displayName,
        role: storedUser.role,
        officeId: storedUser.officeId,
        officeName: storedUser.officeName,
        position: storedUser.position,
        isActive: storedUser.isActive,
        createdAt: storedUser.createdAt,
        updatedAt: storedUser.updatedAt,
      };
      database.insertAuditLogRow(
        makeServerAuditEntry(
          publicActor,
          'AUTH_FAILED',
          'Session',
          storedUser.id,
          `Failed passcode sign-in attempt for ${storedUser.displayName} from ${ip}`
        )
      );

      if (acctResult.locked) {
        res.status(429).json({
          error: `Too many invalid passcode attempts. Sign-in locked for ${acctResult.retryAfterSec} seconds.`,
        });
        return;
      }

      res.status(401).json({
        error: `Invalid passcode for ${storedUser.displayName}. (${acctResult.attemptsRemaining} attempt${acctResult.attemptsRemaining === 1 ? '' : 's'} remaining before temporary lockout.)`,
      });
      return;
    }

    database.clearLoginAttempts(acctScope);
    database.clearLoginAttempts(ipScope);

    const sessionId = database.createSession(
      storedUser.id,
      ip,
      String(req.headers['user-agent'] || '')
    );
    const signedToken = signSessionToken(sessionId, sessionSecret);
    setSessionCookie(res, req, signedToken);

    const publicUser: UserAccount = {
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
      createdAt: storedUser.createdAt,
      updatedAt: storedUser.updatedAt,
    };

    database.insertAuditLogRow(
      makeServerAuditEntry(
        publicUser,
        'LOGIN',
        'Session',
        publicUser.id,
        `Signed in as ${publicUser.displayName} (${publicUser.role})`
      )
    );

    res.json({ ok: true, user: publicUser, sessionToken: signedToken });
  });

  app.post('/api/auth/firebase-login', async (req, res) => {
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

    // Resolve Firebase Project ID from environment or saved SystemSettings
    let projectId = process.env.VITE_FIREBASE_PROJECT_ID?.trim() || '';
    if (!projectId) {
      const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          const parsedCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
            projectId?: string;
          };
          if (parsedCfg.projectId) projectId = parsedCfg.projectId.trim();
        } catch {
          // ignore
        }
      }
    }
    if (!projectId) {
      const savedCfg = database.getSettings().firebaseWebConfigJson;
      if (savedCfg) {
        try {
          const parsedSaved = JSON.parse(savedCfg) as { projectId?: string };
          if (parsedSaved.projectId) projectId = parsedSaved.projectId.trim();
        } catch {
          // ignore
        }
      }
    }

    try {
      const verified = await verifyFirebaseIdToken(parsed.data.idToken, projectId);
      let matched = database.getUserByEmailWithHash(verified.email);

      if (
        !matched &&
        verified.email === 'stephenkent.sipalay@municipalityofbula.gov.ph'
      ) {
        matched =
          database.getUsers().find((u) => u.role === 'ADMINISTRATOR' && u.isActive)
            ? database.getUserByIdWithHash(
                database.getUsers().find((u) => u.role === 'ADMINISTRATOR' && u.isActive)!.id
              )
            : null;
      }

      if (!matched || !matched.isActive) {
        database.recordFailedLoginAttempt(ipScope, 25);
        res.status(403).json({
          error: `Account "${verified.email}" is not registered in the LGU Bula Personnel Directory. Ask the MPDO Administrator to add your account.`,
        });
        return;
      }

      database.clearLoginAttempts(ipScope);
      const sessionId = database.createSession(
        matched.id,
        ip,
        String(req.headers['user-agent'] || '')
      );
      const signedToken = signSessionToken(sessionId, sessionSecret);
      setSessionCookie(res, req, signedToken);

      const publicUser: UserAccount = {
        id: matched.id,
        uid: matched.uid,
        email: matched.email,
        displayName: matched.displayName,
        role: matched.role,
        officeId: matched.officeId,
        officeName: matched.officeName,
        position: matched.position,
        hasPasscode: Boolean(matched.passcodeHash),
        isActive: matched.isActive,
        createdAt: matched.createdAt,
        updatedAt: matched.updatedAt,
      };

      database.insertAuditLogRow(
        makeServerAuditEntry(
          publicUser,
          'LOGIN',
          'Session',
          publicUser.id,
          `Signed in via verified Google ID token (${verified.email})`
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

  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    attachSession(req);
    if (req.sessionId) {
      database.deleteSession(req.sessionId);
    }
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  // Protected Bootstrap
  app.get('/api/bootstrap', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json(database.getScopedDatabasePayload(req.authUser!));
  });

  // Programs CRUD (ADMINISTRATOR or office-scoped ENCODER)
  app.post(
    '/api/programs',
    requireAuth,
    requireRoles('ADMINISTRATOR', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = ProgramRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const clean = sanitizeProgramInput(parsed.data.program as Program);
      if (actingUser.role === 'ENCODER') {
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
    requireRoles('ADMINISTRATOR', 'ENCODER'),
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

      if (!isOwnedByEncoderOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Encoders can only modify Programs assigned to their own office.',
        });
        return;
      }

      const clean = sanitizeProgramInput(parsed.data.program as Program);
      const updated: Program = {
        ...existing,
        ...clean,
        id: existing.id,
        officeId: actingUser.role === 'ENCODER' ? actingUser.officeId : clean.officeId,
        officeName: actingUser.role === 'ENCODER' ? actingUser.officeName : clean.officeName,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };

      const diffs = computeProgramDiff(existing, updated);
      const suppChanged = (existing.supplementalBudget ?? 0) !== (updated.supplementalBudget ?? 0);
      const auditLog = database.updateProgram(
        updated,
        makeServerAuditEntry(
          actingUser,
          'UPDATE',
          'Program',
          updated.id,
          suppChanged
            ? `Adjusted supplemental budget for ${updated.aipRefCode}: ${updated.title}`
            : `Updated program ${updated.aipRefCode}: ${updated.title}`,
          diffs.map((d) => `${d.field}: ${d.before} → ${d.after}`).join(' | '),
          diffs
        )
      );

      res.json({ ok: true, program: updated, auditLog });
    }
  );

  app.delete(
    '/api/programs/:id',
    requireAuth,
    requireRoles('ADMINISTRATOR', 'ENCODER'),
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

      if (!isOwnedByEncoderOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Encoders can only delete Programs assigned to their own office.',
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

  // Activities CRUD (ADMINISTRATOR or office-scoped ENCODER)
  app.post(
    '/api/activities',
    requireAuth,
    requireRoles('ADMINISTRATOR', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = ActivityRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const clean = sanitizeActivityInput(parsed.data.activity as Activity);
      if (actingUser.role === 'ENCODER') {
        clean.officeId = actingUser.officeId;
        clean.officeName = actingUser.officeName;
      }

      if (database.getActivityById(clean.id)) {
        res.status(409).json({ error: 'Activity with this ID already exists.' });
        return;
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
    requireRoles('ADMINISTRATOR', 'ENCODER'),
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

      if (!isOwnedByEncoderOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Encoders can only update activities assigned to their own office.',
        });
        return;
      }

      const clean = sanitizeActivityInput(parsed.data.activity as Activity);
      const updated: Activity = {
        ...existing,
        ...clean,
        id: existing.id,
        officeId: actingUser.role === 'ENCODER' ? actingUser.officeId : clean.officeId,
        officeName: actingUser.role === 'ENCODER' ? actingUser.officeName : clean.officeName,
        createdBy: existing.createdBy,
        createdAt: existing.createdAt,
        updatedBy: actingUser.uid,
        updatedAt: new Date().toISOString(),
      };

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
        )
      );

      res.json({ ok: true, activity: updated, auditLog });
    }
  );

  app.post(
    '/api/activities/reorder',
    requireAuth,
    requireRoles('ADMINISTRATOR', 'ENCODER'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = ReorderActivitiesSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const updates = parsed.data.updates;
      if (actingUser.role === 'ENCODER') {
        for (const u of updates) {
          const act = database.getActivityById(u.id);
          if (!act || !isOwnedByEncoderOffice(actingUser, act.officeId, act.officeName)) {
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

      res.json({ ok: true, auditLog });
    }
  );

  app.delete(
    '/api/activities/:id',
    requireAuth,
    requireRoles('ADMINISTRATOR', 'ENCODER'),
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

      if (!isOwnedByEncoderOffice(actingUser, existing.officeId, existing.officeName)) {
        res.status(403).json({
          error: 'Access denied: Encoders can only delete activities assigned to their own office.',
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

  // Remarks Logs (ADMINISTRATOR or office-scoped ENCODER)
  app.post(
    '/api/remarks',
    requireAuth,
    requireRoles('ADMINISTRATOR', 'ENCODER'),
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

      if (
        !isOwnedByEncoderOffice(actingUser, targetActivity.officeId, targetActivity.officeName)
      ) {
        res.status(403).json({
          error: 'Access denied: Encoders can only log observations on their own office PPAs.',
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
    requireRoles('ADMINISTRATOR', 'ENCODER'),
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

      const parentActivity = database.getActivityById(existing.activityId);
      if (
        actingUser.role === 'ENCODER' &&
        (!parentActivity ||
          !isOwnedByEncoderOffice(actingUser, parentActivity.officeId, parentActivity.officeName))
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

  // Municipal Offices (Administrator-only)
  app.post(
    '/api/offices',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
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
    requireRoles('ADMINISTRATOR'),
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
    requireRoles('ADMINISTRATOR'),
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

  // Fiscal Years (Administrator-only)
  app.post(
    '/api/fiscal-years',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
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
    requireRoles('ADMINISTRATOR'),
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
    requireRoles('ADMINISTRATOR'),
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

  // User Management (Administrator-only; scrypt passcode hashing)
  app.post(
    '/api/users',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const parsed = UserRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error.issues) });
        return;
      }

      const { passcode, clearPasscode: _c, ...rest } = parsed.data.user;
      if (database.getUserByEmailWithHash(rest.email)) {
        res.status(409).json({ error: `An account with email "${rest.email}" already exists.` });
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
        createdAt: rest.createdAt || now,
        updatedAt: now,
      };

      const result = database.createUser(
        userObj,
        passcode,
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
    requireRoles('ADMINISTRATOR'),
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
      const emailOwner = database.getUserByEmailWithHash(rest.email);
      if (emailOwner && emailOwner.id !== existing.id) {
        res.status(409).json({ error: `Another account already uses email "${rest.email}".` });
        return;
      }

      if (existing.id === actingUser.id && (!rest.isActive || rest.role !== 'ADMINISTRATOR')) {
        res.status(400).json({
          error: 'You cannot deactivate your own active Administrator session or remove your Administrator role.',
        });
        return;
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
      if (clearPasscode)
        diffs.push({ field: 'Passcode', before: 'Protected', after: 'Open Profile' });
      else if (passcode && passcode.trim())
        diffs.push({ field: 'Passcode', before: '****', after: 'Updated (scrypt hash)' });

      const result = database.updateUser(
        updatedUser,
        { rawPasscode: passcode, clearPasscode },
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

  app.delete(
    '/api/users/:id',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const paramParsed = IdParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        res.status(400).json({ error: formatValidationError(paramParsed.error.issues) });
        return;
      }

      const existing = database.getUserByIdWithHash(paramParsed.data.id);
      if (!existing) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      if (existing.id === actingUser.id) {
        res.status(400).json({ error: 'You cannot delete your own active account.' });
        return;
      }

      const auditLog = database.deleteUser(
        existing.id,
        makeServerAuditEntry(
          actingUser,
          'DELETE',
          'UserAccount',
          existing.id,
          `Deleted user ${existing.displayName} (${existing.email})`
        )
      );

      res.json({ ok: true, auditLog });
    }
  );

  app.post(
    '/api/users/provision-offices',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
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

  // Settings (Administrator-only; strict magic-byte & SVG logo sanitization)
  app.put(
    '/api/settings',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
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
          `Updated system settings & application branding (${nextAppName})`
        )
      );

      res.json({ ok: true, settings: updatedSettings, auditLog });
    }
  );

  // Audit Logs & Integrity Verification
  app.get('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
    const actingUser = req.authUser!;
    const queryParsed = AuditLogsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({ error: formatValidationError(queryParsed.error.issues) });
      return;
    }
    const limit = queryParsed.data.limit;

    let logs = database.getAuditLogs(1000);
    if (actingUser.role === 'ENCODER' && actingUser.officeId) {
      const officeUids = new Set(
        database
          .getUsers()
          .filter((u) => u.officeId === actingUser.officeId)
          .map((u) => u.uid)
      );
      officeUids.add(actingUser.uid);
      logs = logs.filter((l) => officeUids.has(l.userUid));
    }

    res.json({ auditLogs: logs.slice(0, limit) });
  });

  app.get(
    '/api/audit-logs/verify',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
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
    requireRoles('ADMINISTRATOR'),
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

      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser) });
    }
  );

  // Sample Demo Seed & Reset (Administrator-only)
  app.post(
    '/api/seed-demo',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
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
      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser) });
    }
  );

  app.post(
    '/api/reset-data',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
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
      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser) });
    }
  );

  // Database Snapshots, Backup & Atomic Restore (Administrator-only)
  app.get(
    '/api/backups',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
    (_req: AuthenticatedRequest, res) => {
      res.json({ backups: database.listBackups() });
    }
  );

  app.post(
    '/api/backups',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
    (req: AuthenticatedRequest, res) => {
      const actingUser = req.authUser!;
      const result = database.createBackupSnapshot(
        makeServerAuditEntry(
          actingUser,
          'BACKUP',
          'Database',
          'snapshot',
          `Created database snapshot backup (${database.getPrograms().length} programs, ${database.getActivities().length} activities)`
        )
      );
      res.json({ ok: true, backup: result.backup, auditLog: result.auditLog });
    }
  );

  app.get(
    '/api/backups/:fileName',
    requireAuth,
    requireRoles('ADMINISTRATOR'),
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
    requireRoles('ADMINISTRATOR'),
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

      res.json({ ok: true, db: database.getScopedDatabasePayload(actingUser) });
    }
  );

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
      const message =
        err instanceof Error ? err.message : 'Unexpected server error while processing API request.';
      const status =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      res.status(status).json({ error: message });
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

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LGU Bula PPA Monitoring System listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
