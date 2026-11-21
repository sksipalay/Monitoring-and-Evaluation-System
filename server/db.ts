import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_FISCAL_YEARS,
  DEFAULT_OFFICES,
  DEFAULT_SETTINGS,
  DEFAULT_USERS,
  buildOfficeEncoderAccount,
  ensureAllOfficeAccounts,
} from '../src/utils/demoSeedData';
import type {
  ActiveSessionInfo,
  ActiveSessionsOverview,
  Activity,
  ActivityMilestone,
  AdminActiveSession,
  ApprovalStatus,
  AuditActionType,
  AuditChangeDiff,
  AuditIntegrityResult,
  AuditLog,
  BackupInfo,
  BudgetClassification,
  DatabasePayload,
  DocumentTemplate,
  DocumentTemplateVersion,
  FiscalYear,
  ImplementationStatus,
  IpLocationGroup,
  Office,
  Program,
  ProgramSupplementalLog,
  RemarkLog,
  SessionZoneBreakdown,
  SidebarModule,
  SystemSettings,
  TemplateAnalysisSummary,
  TemplateFormat,
  TemplateReportTarget,
  UploadedDocument,
  UserAccount,
  UserRole,
} from '../src/types/ppa';
import {
  SESSION_TTL_MS,
  classifyIpAndGeo,
  computeAuditEntryHash,
  computeSha256,
  generateResetToken,
  hashPasscode,
  hashToken,
  isHashedPasscode,
  verifyPasscode,
} from './security';

export interface StoredUserRow extends UserAccount {
  passcodeHash: string | null;
}

export interface BackupSnapshotPayload {
  version: number;
  createdAt: string;
  trigger?: 'MANUAL' | 'SCHEDULED';
  offices: Office[];
  users: (Omit<UserAccount, 'passcode' | 'clearPasscode'> & { passcodeHash?: string | null })[];
  fiscalYears: FiscalYear[];
  programs: Program[];
  activities: Activity[];
  remarksLogs: RemarkLog[];
  uploadedDocuments: UploadedDocument[];
  settings: SystemSettings;
}

export class AppDatabase {
  readonly db: DatabaseSync;
  readonly dataDir: string;
  readonly sqlitePath: string;
  readonly backupDir: string;
  readonly templatesDir: string;
  readonly legacyJsonPath: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.sqlitePath = path.join(dataDir, 'bula-ppa.sqlite');
    this.backupDir = path.join(dataDir, 'backups');
    this.templatesDir = path.join(dataDir, 'templates');
    this.legacyJsonPath = path.join(dataDir, 'bula-ppa-db.json');

    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });
    if (!fs.existsSync(this.templatesDir)) fs.mkdirSync(this.templatesDir, { recursive: true });

    this.db = new DatabaseSync(this.sqlitePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    this.initSchema();
    this.bootstrapOrMigrateLegacy();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS offices (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        head_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        office_id TEXT NOT NULL,
        office_name TEXT NOT NULL,
        position TEXT NOT NULL,
        passcode_hash TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fiscal_years (
        id TEXT PRIMARY KEY,
        year TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS programs (
        id TEXT PRIMARY KEY,
        fiscal_year TEXT NOT NULL,
        aip_ref_code TEXT NOT NULL,
        title TEXT NOT NULL,
        target_outputs TEXT NOT NULL DEFAULT '',
        sector TEXT NOT NULL,
        budget REAL NOT NULL DEFAULT 0,
        supplemental_budget REAL NOT NULL DEFAULT 0,
        supplemental_logs_json TEXT NOT NULL DEFAULT '[]',
        physical_target REAL NOT NULL DEFAULT 0,
        monthly_physical_target_json TEXT NOT NULL DEFAULT '{}',
        source_of_fund TEXT NOT NULL DEFAULT '',
        gad_fund INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        office_id TEXT NOT NULL,
        office_name TEXT NOT NULL,
        parent_program_id TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL,
        subprogram_id TEXT,
        fiscal_year TEXT NOT NULL,
        reference_number TEXT NOT NULL,
        description TEXT NOT NULL,
        target_outputs TEXT NOT NULL,
        office_id TEXT NOT NULL,
        office_name TEXT NOT NULL,
        source_of_fund TEXT NOT NULL DEFAULT '',
        budget_classification TEXT NOT NULL,
        gf REAL NOT NULL DEFAULT 0,
        ps REAL NOT NULL DEFAULT 0,
        mooe REAL NOT NULL DEFAULT 0,
        co REAL NOT NULL DEFAULT 0,
        withheld_amount REAL NOT NULL DEFAULT 0,
        supplemental_budget_1 REAL NOT NULL DEFAULT 0,
        supplemental_budget_2 REAL NOT NULL DEFAULT 0,
        supplemental_budget_3 REAL NOT NULL DEFAULT 0,
        supplemental_budget_4 REAL NOT NULL DEFAULT 0,
        supplemental_budget_5 REAL NOT NULL DEFAULT 0,
        monthly_json TEXT NOT NULL,
        status TEXT NOT NULL,
        completion_pct REAL NOT NULL DEFAULT 0,
        remarks TEXT NOT NULL DEFAULT '',
        milestones_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '[]',
        order_index INTEGER NOT NULL DEFAULT 0,
        start_date TEXT NOT NULL DEFAULT '',
        end_date TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS remarks_logs (
        id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        author_uid TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        observation TEXT NOT NULL,
        monitoring_date TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS uploaded_documents (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        fiscal_year TEXT NOT NULL,
        records_imported INTEGER NOT NULL,
        uploaded_by_uid TEXT NOT NULL,
        uploaded_by_name TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        user_uid TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        user_role TEXT NOT NULL,
        user_office_name TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        changes_json TEXT NOT NULL DEFAULT '[]',
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
      BEFORE UPDATE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Audit logs are strictly append-only and cannot be modified.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
      BEFORE DELETE ON audit_logs
      BEGIN
        SELECT RAISE(ABORT, 'Audit logs are strictly append-only and cannot be deleted.');
      END;

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at INTEGER NOT NULL DEFAULT 0,
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        geo_label TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS login_attempts (
        scope_key TEXT PRIMARY KEY,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        first_attempt_at INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL,
        target_report TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        current_version_id TEXT NOT NULL,
        current_version_number INTEGER NOT NULL DEFAULT 1,
        created_by_uid TEXT NOT NULL,
        created_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_template_versions (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        storage_file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        analysis_json TEXT NOT NULL DEFAULT '{}',
        uploaded_by_uid TEXT NOT NULL,
        uploaded_by_name TEXT NOT NULL,
        uploaded_at TEXT NOT NULL,
        FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_programs_fy ON programs(fiscal_year, order_index);
      CREATE INDEX IF NOT EXISTS idx_activities_prog ON activities(program_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_activities_office ON activities(office_id);
      CREATE INDEX IF NOT EXISTS idx_remarks_act ON remarks_logs(activity_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(user_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_templates_target ON document_templates(target_report, format, is_active);
      CREATE INDEX IF NOT EXISTS idx_template_versions_tpl ON document_template_versions(template_id, version_number);
    `);

    this.ensureSchemaMigrations();
  }

  private ensureSchemaMigrations() {
    const userCols = (
      this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
    ).map((c) => c.name);
    const addUserCol = (col: string, defSql: string) => {
      if (!userCols.includes(col)) {
        this.db.exec(`ALTER TABLE users ADD COLUMN ${col} ${defSql}`);
      }
    };
    addUserCol('last_login_at', "TEXT NOT NULL DEFAULT ''");
    addUserCol('last_login_ip', "TEXT NOT NULL DEFAULT ''");
    addUserCol('must_change_password', 'INTEGER NOT NULL DEFAULT 0');
    addUserCol('approval_status', "TEXT NOT NULL DEFAULT 'APPROVED'");
    addUserCol('allowed_modules_json', "TEXT NOT NULL DEFAULT ''");
    addUserCol('privacy_consent_at', "TEXT NOT NULL DEFAULT ''");

    const programCols = (
      this.db.prepare('PRAGMA table_info(programs)').all() as { name: string }[]
    ).map((c) => c.name);
    if (!programCols.includes('target_outputs')) {
      this.db.exec("ALTER TABLE programs ADD COLUMN target_outputs TEXT NOT NULL DEFAULT ''");
    }
    if (!programCols.includes('status')) {
      this.db.exec("ALTER TABLE programs ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'");
      // Backfill program status from existing child activities once upon schema upgrade
      const progRows = this.db.prepare('SELECT id FROM programs').all() as { id: string }[];
      const actStmt = this.db.prepare(
        'SELECT status FROM activities WHERE program_id = ? OR subprogram_id = ?'
      );
      const updStmt = this.db.prepare('UPDATE programs SET status = ? WHERE id = ?');
      for (const pr of progRows) {
        const acts = actStmt.all(pr.id, pr.id) as { status: string }[];
        if (acts.length === 0) continue;
        const statuses = acts.map((a) => String(a.status || 'PENDING'));
        let derived: ImplementationStatus = 'PENDING';
        if (statuses.every((s) => s === 'COMPLETED')) {
          derived = 'COMPLETED';
        } else if (statuses.every((s) => s === 'NOT IMPLEMENTED')) {
          derived = 'NOT IMPLEMENTED';
        } else if (statuses.some((s) => s === 'ON-GOING' || s === 'COMPLETED')) {
          derived = 'ON-GOING';
        }
        updStmt.run(derived, pr.id);
      }
    }

    const activityCols = (
      this.db.prepare('PRAGMA table_info(activities)').all() as { name: string }[]
    ).map((c) => c.name);
    if (!activityCols.includes('milestones_json')) {
      this.db.exec("ALTER TABLE activities ADD COLUMN milestones_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!activityCols.includes('completion_pct')) {
      this.db.exec('ALTER TABLE activities ADD COLUMN completion_pct REAL NOT NULL DEFAULT 0');
    }
    if (!activityCols.includes('evidence_json')) {
      this.db.exec("ALTER TABLE activities ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]'");
    }

    const sessionCols = (
      this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    ).map((c) => c.name);
    if (!sessionCols.includes('last_activity_at')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN last_activity_at INTEGER NOT NULL DEFAULT 0');
    }
    if (!sessionCols.includes('geo_label')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN geo_label TEXT NOT NULL DEFAULT ''");
    }
  }

  runTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw err;
    }
  }

  private bootstrapOrMigrateLegacy() {
    const userCountRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as {
      cnt: number;
    };
    if (userCountRow.cnt > 0) return;

    if (fs.existsSync(this.legacyJsonPath)) {
      try {
        const raw = fs.readFileSync(this.legacyJsonPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<DatabasePayload>;

        // Preserve original JSON snapshot inside backups folder once
        const migrationBackupPath = path.join(
          this.backupDir,
          `pre-sqlite-migration-${Date.now()}.json`
        );
        if (!fs.existsSync(migrationBackupPath)) {
          fs.copyFileSync(this.legacyJsonPath, migrationBackupPath);
        }

        const offices =
          Array.isArray(parsed.offices) && parsed.offices.length > 0
            ? parsed.offices
            : DEFAULT_OFFICES;
        let users =
          Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : DEFAULT_USERS;
        if (!parsed.officeAccountsProvisioned) {
          users = ensureAllOfficeAccounts(offices, users).users;
        }
        const fiscalYears =
          Array.isArray(parsed.fiscalYears) && parsed.fiscalYears.length > 0
            ? parsed.fiscalYears
            : DEFAULT_FISCAL_YEARS;
        const programs = Array.isArray(parsed.programs) ? parsed.programs : [];
        const activities = Array.isArray(parsed.activities) ? parsed.activities : [];
        const remarksLogs = Array.isArray(parsed.remarksLogs) ? parsed.remarksLogs : [];
        const uploadedDocuments = Array.isArray(parsed.uploadedDocuments)
          ? parsed.uploadedDocuments
          : [];
        const auditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [];
        const settings = parsed.settings
          ? { ...DEFAULT_SETTINGS, ...parsed.settings }
          : DEFAULT_SETTINGS;

        this.runTransaction(() => {
          for (const off of offices) this.insertOfficeStmt(off);
          for (const u of users) {
            const hashed =
              u.passcode && u.passcode.trim()
                ? isHashedPasscode(u.passcode)
                  ? u.passcode
                  : hashPasscode(u.passcode)
                : null;
            this.insertUserStmt(u, hashed);
          }
          for (const fy of fiscalYears) this.insertFiscalYearStmt(fy);
          for (const p of programs) this.insertProgramStmt(p);
          for (const a of activities) this.insertActivityStmt(a);
          for (const r of remarksLogs) this.insertRemarkStmt(r);
          for (const d of uploadedDocuments) this.insertDocumentStmt(d);
          this.upsertSettingsStmt(settings);

          // Migrate existing audit logs in chronological order so hash chain starts cleanly
          const chronological = [...auditLogs].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          for (const log of chronological) {
            this.insertAuditLogRow({
              ...log,
              changes: log.changes || [],
            });
          }
        });
        console.log(
          `[SQLite] Migrated ${programs.length} programs, ${activities.length} activities, ${users.length} users from JSON database.`
        );
        return;
      } catch (err) {
        console.error('[SQLite] Legacy JSON migration error, seeding defaults:', err);
      }
    }

    // Fresh initialization with default LGU offices, fiscal years, users, and settings
    this.runTransaction(() => {
      for (const off of DEFAULT_OFFICES) this.insertOfficeStmt(off);
      for (const u of DEFAULT_USERS) this.insertUserStmt(u, null);
      for (const fy of DEFAULT_FISCAL_YEARS) this.insertFiscalYearStmt(fy);
      this.upsertSettingsStmt(DEFAULT_SETTINGS);
    });
  }

  // Low-level SQL statements
  private insertOfficeStmt(o: Office) {
    this.db
      .prepare(
        `INSERT INTO offices (id, code, name, head_name, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(o.id, o.code, o.name, o.headName || 'Department Head', o.createdAt || new Date().toISOString());
  }

  private insertUserStmt(u: UserAccount, passcodeHash: string | null) {
    const allowedModulesJson =
      Array.isArray(u.allowedModules) && u.allowedModules.length > 0
        ? JSON.stringify(u.allowedModules)
        : '';
    this.db
      .prepare(
        `INSERT INTO users (
          id, uid, email, display_name, role, office_id, office_name, position,
          passcode_hash, is_active, approval_status, must_change_password,
          allowed_modules_json, last_login_at, last_login_ip, privacy_consent_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        u.id,
        u.uid || u.id,
        u.email.toLowerCase(),
        u.displayName,
        u.role,
        u.officeId,
        u.officeName,
        u.position || 'Monitoring Personnel',
        passcodeHash,
        u.isActive ? 1 : 0,
        u.approvalStatus || 'APPROVED',
        u.mustChangePassword ? 1 : 0,
        allowedModulesJson,
        u.lastLoginAt || '',
        u.lastLoginIp || '',
        u.privacyConsentAt || '',
        u.createdAt || new Date().toISOString(),
        u.updatedAt || new Date().toISOString()
      );
  }

  private insertFiscalYearStmt(fy: FiscalYear) {
    this.db
      .prepare(
        `INSERT INTO fiscal_years (id, year, label, is_active, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        fy.id,
        fy.year,
        fy.label,
        fy.isActive ? 1 : 0,
        fy.isDefault ? 1 : 0,
        fy.createdAt || new Date().toISOString()
      );
  }

  private insertProgramStmt(p: Program) {
    this.db
      .prepare(
        `INSERT INTO programs (
          id, fiscal_year, aip_ref_code, title, target_outputs, sector, budget, supplemental_budget,
          supplemental_logs_json, physical_target, monthly_physical_target_json,
          source_of_fund, gad_fund, status, office_id, office_name, parent_program_id,
          order_index, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        p.id,
        p.fiscalYear,
        p.aipRefCode,
        p.title,
        p.targetOutputs || '',
        p.sector || 'General Public Services',
        p.budget ?? 0,
        p.supplementalBudget ?? 0,
        JSON.stringify(p.supplementalLogs || []),
        p.physicalTarget ?? 0,
        JSON.stringify(p.monthlyPhysicalTarget || {}),
        p.sourceOfFund || '',
        p.gadFund ? 1 : 0,
        p.status || 'PENDING',
        p.officeId,
        p.officeName,
        p.parentProgramId ?? null,
        p.orderIndex ?? 0,
        p.createdAt || new Date().toISOString(),
        p.updatedAt || new Date().toISOString()
      );
  }

  private insertActivityStmt(a: Activity) {
    this.db
      .prepare(
        `INSERT INTO activities (
          id, program_id, subprogram_id, fiscal_year, reference_number, description,
          target_outputs, office_id, office_name, source_of_fund, budget_classification,
          gf, ps, mooe, co, withheld_amount,
          supplemental_budget_1, supplemental_budget_2, supplemental_budget_3,
          supplemental_budget_4, supplemental_budget_5,
          monthly_json, status, completion_pct, remarks, milestones_json, evidence_json, order_index, start_date, end_date,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        a.id,
        a.programId,
        a.subprogramId ?? null,
        a.fiscalYear,
        a.referenceNumber,
        a.description,
        a.targetOutputs || '',
        a.officeId,
        a.officeName,
        a.sourceOfFund || '',
        a.budgetClassification || 'GF',
        a.gf ?? 0,
        a.ps ?? 0,
        a.mooe ?? 0,
        a.co ?? 0,
        a.withheldAmount ?? 0,
        a.supplementalBudget1 ?? 0,
        a.supplementalBudget2 ?? 0,
        a.supplementalBudget3 ?? 0,
        a.supplementalBudget4 ?? 0,
        a.supplementalBudget5 ?? 0,
        JSON.stringify(a.monthly),
        a.status || 'PENDING',
        Math.min(100, Math.max(0, Number(a.completionPct ?? 0))),
        a.remarks || '',
        JSON.stringify(a.milestones || []),
        JSON.stringify(a.evidence || []),
        a.orderIndex ?? 0,
        a.startDate || '',
        a.endDate || '',
        a.createdBy || '',
        a.updatedBy || '',
        a.createdAt || new Date().toISOString(),
        a.updatedAt || new Date().toISOString()
      );
  }

  private insertRemarkStmt(r: RemarkLog) {
    this.db
      .prepare(
        `INSERT INTO remarks_logs (id, activity_id, author_uid, author_name, author_role, observation, monitoring_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.id,
        r.activityId,
        r.authorUid,
        r.authorName,
        r.authorRole,
        r.observation,
        r.monitoringDate,
        r.createdAt || new Date().toISOString()
      );
  }

  private insertDocumentStmt(d: UploadedDocument) {
    this.db
      .prepare(
        `INSERT INTO uploaded_documents (id, file_name, file_size, fiscal_year, records_imported, uploaded_by_uid, uploaded_by_name, uploaded_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        d.id,
        d.fileName,
        d.fileSize,
        d.fiscalYear,
        d.recordsImported,
        d.uploadedByUid,
        d.uploadedByName,
        d.uploadedAt || new Date().toISOString(),
        d.notes || ''
      );
  }

  private upsertSettingsStmt(s: SystemSettings) {
    this.db
      .prepare(
        `INSERT INTO settings (id, payload_json) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json`
      )
      .run(JSON.stringify(s));
  }

  // Tamper-evident append-only audit log insertion
  insertAuditLogRow(entry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    const lastRow = this.db
      .prepare('SELECT entry_hash FROM audit_logs ORDER BY seq DESC LIMIT 1')
      .get() as { entry_hash?: string } | undefined;
    const prevHash = lastRow?.entry_hash || 'GENESIS';
    const changes = entry.changes || [];
    const entryHash = computeAuditEntryHash({
      prevHash,
      id: entry.id,
      timestamp: entry.timestamp,
      userUid: entry.userUid,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      details: entry.details || '',
      changes,
    });

    this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, user_uid, user_name, user_email, user_role, user_office_name,
          action, entity_type, entity_id, summary, details, changes_json,
          prev_hash, entry_hash, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.userUid,
        entry.userName,
        entry.userEmail,
        entry.userRole,
        entry.userOfficeName || '',
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.summary,
        entry.details || '',
        JSON.stringify(changes),
        prevHash,
        entryHash,
        entry.timestamp
      );

    return {
      ...entry,
      changes,
      prevHash,
      entryHash,
    };
  }

  verifyAuditChain(): AuditIntegrityResult {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs ORDER BY seq ASC')
      .all() as Record<string, unknown>[];
    let expectedPrev = 'GENESIS';
    for (const row of rows) {
      const prevHash = String(row.prev_hash);
      const entryHash = String(row.entry_hash);
      if (prevHash !== expectedPrev) {
        return {
          valid: false,
          totalChecked: rows.length,
          brokenAuditId: String(row.id),
          message: `Hash chain link mismatch at audit record ${String(row.id)}.`,
        };
      }
      let changes: AuditChangeDiff[] = [];
      try {
        changes = JSON.parse(String(row.changes_json || '[]')) as AuditChangeDiff[];
      } catch {
        changes = [];
      }
      const recomputed = computeAuditEntryHash({
        prevHash,
        id: String(row.id),
        timestamp: String(row.timestamp),
        userUid: String(row.user_uid),
        action: String(row.action),
        entityType: String(row.entity_type),
        entityId: String(row.entity_id),
        summary: String(row.summary),
        details: String(row.details || ''),
        changes,
      });
      if (recomputed !== entryHash) {
        return {
          valid: false,
          totalChecked: rows.length,
          brokenAuditId: String(row.id),
          message: `Tampered payload detected at audit record ${String(row.id)}.`,
        };
      }
      expectedPrev = entryHash;
    }

    return {
      valid: true,
      totalChecked: rows.length,
      message:
        rows.length === 0
          ? 'Audit log chain initialized (0 entries).'
          : `Verified ${rows.length} append-only audit log entries with intact SHA-256 hash chain.`,
    };
  }

  // Row mappers (NEVER expose passcode_hash to clients)
  private mapUserRow(r: Record<string, unknown>, includeHash = false): StoredUserRow {
    const hash = r.passcode_hash ? String(r.passcode_hash) : null;
    let allowedModules: SidebarModule[] | undefined;
    if (r.allowed_modules_json) {
      try {
        const parsed = JSON.parse(String(r.allowed_modules_json));
        if (Array.isArray(parsed) && parsed.length > 0) {
          allowedModules = parsed as SidebarModule[];
        }
      } catch {
        allowedModules = undefined;
      }
    }
    const base: StoredUserRow = {
      id: String(r.id),
      uid: String(r.uid),
      email: String(r.email),
      displayName: String(r.display_name),
      role: String(r.role) as UserRole,
      officeId: String(r.office_id),
      officeName: String(r.office_name),
      position: String(r.position),
      hasPasscode: Boolean(hash),
      isActive: Boolean(r.is_active),
      approvalStatus: (String(r.approval_status || 'APPROVED') as ApprovalStatus),
      mustChangePassword: Boolean(r.must_change_password),
      allowedModules,
      lastLoginAt: r.last_login_at ? String(r.last_login_at) : '',
      lastLoginIp: r.last_login_ip ? String(r.last_login_ip) : '',
      privacyConsentAt: r.privacy_consent_at ? String(r.privacy_consent_at) : '',
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      passcodeHash: includeHash ? hash : null,
    };
    return base;
  }

  private sanitizePublicUser(u: StoredUserRow): UserAccount {
    return {
      id: u.id,
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      officeId: u.officeId,
      officeName: u.officeName,
      position: u.position,
      hasPasscode: Boolean(u.hasPasscode),
      isActive: u.isActive,
      approvalStatus: u.approvalStatus || 'APPROVED',
      mustChangePassword: Boolean(u.mustChangePassword),
      allowedModules: u.allowedModules,
      lastLoginAt: u.lastLoginAt || '',
      lastLoginIp: u.lastLoginIp || '',
      privacyConsentAt: u.privacyConsentAt || '',
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };
  }

  private mapOfficeRow(r: Record<string, unknown>): Office {
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      headName: String(r.head_name),
      createdAt: String(r.created_at),
    };
  }

  private mapFyRow(r: Record<string, unknown>): FiscalYear {
    return {
      id: String(r.id),
      year: String(r.year),
      label: String(r.label),
      isActive: Boolean(r.is_active),
      isDefault: Boolean(r.is_default),
      createdAt: String(r.created_at),
    };
  }

  private mapProgramRow(r: Record<string, unknown>): Program {
    let logs: ProgramSupplementalLog[] = [];
    let monthlyPhys: Program['monthlyPhysicalTarget'] = {};
    try {
      logs = JSON.parse(String(r.supplemental_logs_json || '[]')) as ProgramSupplementalLog[];
    } catch {
      logs = [];
    }
    try {
      monthlyPhys = JSON.parse(
        String(r.monthly_physical_target_json || '{}')
      ) as Program['monthlyPhysicalTarget'];
    } catch {
      monthlyPhys = {};
    }
    return {
      id: String(r.id),
      fiscalYear: String(r.fiscal_year),
      aipRefCode: String(r.aip_ref_code),
      title: String(r.title),
      targetOutputs: String(r.target_outputs || ''),
      sector: String(r.sector),
      budget: Number(r.budget ?? 0),
      supplementalBudget: Number(r.supplemental_budget ?? 0),
      supplementalLogs: logs,
      physicalTarget: Number(r.physical_target ?? 0),
      monthlyPhysicalTarget: monthlyPhys,
      sourceOfFund: String(r.source_of_fund || ''),
      gadFund: Boolean(r.gad_fund),
      status: (String(r.status || 'PENDING') as ImplementationStatus),
      officeId: String(r.office_id),
      officeName: String(r.office_name),
      parentProgramId: r.parent_program_id ? String(r.parent_program_id) : null,
      orderIndex: Number(r.order_index ?? 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private mapActivityRow(r: Record<string, unknown>): Activity {
    let milestones: ActivityMilestone[] = [];
    try {
      const parsed = JSON.parse(String(r.milestones_json || '[]'));
      if (Array.isArray(parsed)) milestones = parsed as ActivityMilestone[];
    } catch {
      milestones = [];
    }
    let evidence: Activity['evidence'] = [];
    try {
      const parsedEv = JSON.parse(String(r.evidence_json || '[]'));
      if (Array.isArray(parsedEv)) evidence = parsedEv as NonNullable<Activity['evidence']>;
    } catch {
      evidence = [];
    }
    return {
      id: String(r.id),
      programId: String(r.program_id),
      subprogramId: r.subprogram_id ? String(r.subprogram_id) : null,
      fiscalYear: String(r.fiscal_year),
      referenceNumber: String(r.reference_number),
      description: String(r.description),
      targetOutputs: String(r.target_outputs),
      officeId: String(r.office_id),
      officeName: String(r.office_name),
      sourceOfFund: String(r.source_of_fund || ''),
      budgetClassification: String(r.budget_classification) as BudgetClassification,
      gf: Number(r.gf ?? 0),
      ps: Number(r.ps ?? 0),
      mooe: Number(r.mooe ?? 0),
      co: Number(r.co ?? 0),
      withheldAmount: Number(r.withheld_amount ?? 0),
      supplementalBudget1: Number(r.supplemental_budget_1 ?? 0),
      supplementalBudget2: Number(r.supplemental_budget_2 ?? 0),
      supplementalBudget3: Number(r.supplemental_budget_3 ?? 0),
      supplementalBudget4: Number(r.supplemental_budget_4 ?? 0),
      supplementalBudget5: Number(r.supplemental_budget_5 ?? 0),
      monthly: JSON.parse(String(r.monthly_json)) as Activity['monthly'],
      status: String(r.status) as ImplementationStatus,
      completionPct: Math.min(100, Math.max(0, Number(r.completion_pct ?? 0))),
      remarks: String(r.remarks || ''),
      milestones,
      evidence,
      orderIndex: Number(r.order_index ?? 0),
      startDate: String(r.start_date || ''),
      endDate: String(r.end_date || ''),
      createdBy: String(r.created_by),
      updatedBy: String(r.updated_by),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private mapRemarkRow(r: Record<string, unknown>): RemarkLog {
    return {
      id: String(r.id),
      activityId: String(r.activity_id),
      authorUid: String(r.author_uid),
      authorName: String(r.author_name),
      authorRole: String(r.author_role) as UserRole,
      observation: String(r.observation),
      monitoringDate: String(r.monitoring_date),
      createdAt: String(r.created_at),
    };
  }

  private mapDocumentRow(r: Record<string, unknown>): UploadedDocument {
    return {
      id: String(r.id),
      fileName: String(r.file_name),
      fileSize: Number(r.file_size),
      fiscalYear: String(r.fiscal_year),
      recordsImported: Number(r.records_imported),
      uploadedByUid: String(r.uploaded_by_uid),
      uploadedByName: String(r.uploaded_by_name),
      uploadedAt: String(r.uploaded_at),
      notes: String(r.notes || ''),
    };
  }

  private mapAuditRow(r: Record<string, unknown>): AuditLog {
    let changes: AuditChangeDiff[] = [];
    try {
      changes = JSON.parse(String(r.changes_json || '[]')) as AuditChangeDiff[];
    } catch {
      changes = [];
    }
    return {
      id: String(r.id),
      userUid: String(r.user_uid),
      userName: String(r.user_name),
      userEmail: String(r.user_email),
      userRole: String(r.user_role) as UserRole,
      userOfficeName: String(r.user_office_name || ''),
      action: String(r.action) as AuditActionType,
      entityType: String(r.entity_type),
      entityId: String(r.entity_id),
      summary: String(r.summary),
      details: String(r.details || ''),
      changes,
      prevHash: String(r.prev_hash),
      entryHash: String(r.entry_hash),
      timestamp: String(r.timestamp),
    };
  }

  // Public Reads & Queries
  getSettings(): SystemSettings {
    const row = this.db
      .prepare('SELECT payload_json FROM settings WHERE id = 1')
      .get() as { payload_json?: string } | undefined;
    if (!row?.payload_json) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(row.payload_json) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  getOffices(): Office[] {
    const rows = this.db.prepare('SELECT * FROM offices ORDER BY rowid ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.mapOfficeRow(r));
  }

  getFiscalYears(): FiscalYear[] {
    const rows = this.db
      .prepare('SELECT * FROM fiscal_years ORDER BY year ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapFyRow(r));
  }

  getUsers(): UserAccount[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY rowid ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.sanitizePublicUser(this.mapUserRow(r, false)));
  }

  getUserByIdWithHash(id: string): StoredUserRow | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapUserRow(row, true) : null;
  }

  getUserByEmailWithHash(email: string): StoredUserRow | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(email) as Record<string, unknown> | undefined;
    return row ? this.mapUserRow(row, true) : null;
  }

  getSetupStatus(): { setupRequired: boolean; passwordProtectedUsers: number; totalUsers: number } {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN passcode_hash IS NOT NULL AND passcode_hash != '' THEN 1 ELSE 0 END) AS protected FROM users"
      )
      .get() as { total?: number; protected?: number };
    const protectedCount = Number(row?.protected ?? 0);
    const totalCount = Number(row?.total ?? 0);
    return {
      setupRequired: protectedCount === 0,
      passwordProtectedUsers: protectedCount,
      totalUsers: totalCount,
    };
  }

  getAuthPublicStatus(firebaseConfigured: boolean, demoSeedAllowed: boolean): {
    setupRequired: boolean;
    allowSelfRegistration: boolean;
    privacyNoticeText: string;
    demoSeedAllowed: boolean;
    firebaseConfigured: boolean;
    offices: Pick<Office, 'id' | 'code' | 'name'>[];
    branding: { appName: string; appLogoDataUrl: string; municipalityName: string };
  } {
    const settings = this.getSettings();
    const { setupRequired } = this.getSetupStatus();
    const allowSelfRegistration = Boolean(settings.allowSelfRegistration);
    return {
      setupRequired,
      allowSelfRegistration,
      privacyNoticeText: settings.privacyNoticeText || DEFAULT_SETTINGS.privacyNoticeText || '',
      demoSeedAllowed,
      firebaseConfigured,
      offices: allowSelfRegistration
        ? this.getOffices().map((o) => ({ id: o.id, code: o.code, name: o.name }))
        : [],
      branding: {
        appName: settings.appName || DEFAULT_SETTINGS.appName || '',
        appLogoDataUrl: settings.appLogoDataUrl || '',
        municipalityName: settings.municipalityName || DEFAULT_SETTINGS.municipalityName,
      },
    };
  }

  getPrograms(): Program[] {
    const rows = this.db
      .prepare('SELECT * FROM programs ORDER BY order_index ASC, rowid ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapProgramRow(r));
  }

  getProgramById(id: string): Program | null {
    const row = this.db.prepare('SELECT * FROM programs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapProgramRow(row) : null;
  }

  getActivities(): Activity[] {
    const rows = this.db
      .prepare('SELECT * FROM activities ORDER BY order_index ASC, rowid ASC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapActivityRow(r));
  }

  getActivityById(id: string): Activity | null {
    const row = this.db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapActivityRow(row) : null;
  }

  getRemarks(): RemarkLog[] {
    const rows = this.db
      .prepare('SELECT * FROM remarks_logs ORDER BY created_at DESC, rowid DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRemarkRow(r));
  }

  getRemarkById(id: string): RemarkLog | null {
    const row = this.db.prepare('SELECT * FROM remarks_logs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRemarkRow(row) : null;
  }

  getUploadedDocuments(): UploadedDocument[] {
    const rows = this.db
      .prepare('SELECT * FROM uploaded_documents ORDER BY uploaded_at DESC, rowid DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapDocumentRow(r));
  }

  getAuditLogs(limit = 1000): AuditLog[] {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
    const rows = this.db
      .prepare('SELECT * FROM audit_logs ORDER BY seq DESC LIMIT ?')
      .all(safeLimit) as Record<string, unknown>[];
    return rows.map((r) => this.mapAuditRow(r));
  }

  getAuditLogsPaginated(params: {
    page?: number;
    pageSize?: number;
    action?: string;
    search?: string;
    userUid?: string;
    dateFrom?: string;
    dateTo?: string;
    tzOffsetMinutes?: number;
    allowedUids?: Set<string> | null;
  }): {
    auditLogs: AuditLog[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    const page = Math.max(1, Math.floor(params.page || 1));
    const pageSize = Math.min(200, Math.max(5, Math.floor(params.pageSize || 25)));
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (params.action && params.action !== 'ALL') {
      conditions.push('action = ?');
      args.push(params.action);
    }
    if (params.userUid && params.userUid !== 'ALL') {
      conditions.push('user_uid = ?');
      args.push(params.userUid);
    }
    const tzOffsetMs =
      typeof params.tzOffsetMinutes === 'number' && Number.isFinite(params.tzOffsetMinutes)
        ? params.tzOffsetMinutes * 60_000
        : 0;
    if (params.dateFrom && params.dateFrom.trim()) {
      const df = params.dateFrom.trim();
      const baseMs = Date.parse(`${df}T00:00:00.000Z`);
      if (Number.isFinite(baseMs)) {
        conditions.push('timestamp >= ?');
        args.push(new Date(baseMs + tzOffsetMs).toISOString());
      }
    }
    if (params.dateTo && params.dateTo.trim()) {
      const dt = params.dateTo.trim();
      const baseMs = Date.parse(`${dt}T23:59:59.999Z`);
      if (Number.isFinite(baseMs)) {
        conditions.push('timestamp <= ?');
        args.push(new Date(baseMs + tzOffsetMs).toISOString());
      }
    }
    if (params.search && params.search.trim()) {
      const like = `%${params.search.trim().toLowerCase()}%`;
      conditions.push(
        '(lower(user_name) LIKE ? OR lower(user_email) LIKE ? OR lower(entity_type) LIKE ? OR lower(entity_id) LIKE ? OR lower(summary) LIKE ?)'
      );
      args.push(like, like, like, like, like);
    }
    if (params.allowedUids && params.allowedUids.size > 0) {
      const uidList = Array.from(params.allowedUids);
      conditions.push(`user_uid IN (${uidList.map(() => '?').join(',')})`);
      args.push(...uidList);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM audit_logs ${whereSql}`)
      .get(...args) as { cnt?: number };
    const total = Number(countRow?.cnt ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY seq DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, offset) as Record<string, unknown>[];

    return {
      auditLogs: rows.map((r) => this.mapAuditRow(r)),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }

  getScopedDatabasePayload(actingUser: UserAccount, demoSeedAllowed = false): DatabasePayload {
    const offices = this.getOffices();
    const fiscalYears = this.getFiscalYears();
    const settings = this.getSettings();
    const allUsers = this.getUsers();
    const allPrograms = this.getPrograms();
    const allActivities = this.getActivities();
    const allRemarks = this.getRemarks();
    const uploadedDocuments = this.getUploadedDocuments();
    const allAuditLogs = this.getAuditLogs(1000);

    const isOfficeScoped =
      (actingUser.role === 'ENCODER' || actingUser.role === 'OFFICE_HEAD') &&
      Boolean(actingUser.officeId);

    if (isOfficeScoped) {
      const offId = actingUser.officeId;
      const offNameLower = actingUser.officeName.toLowerCase();
      const scopedActivities = allActivities.filter(
        (a) => a.officeId === offId || a.officeName.toLowerCase() === offNameLower
      );
      const actIds = new Set(scopedActivities.map((a) => a.id));
      const parentProgramIds = new Set(scopedActivities.map((a) => a.programId));
      const scopedPrograms = allPrograms.filter(
        (p) =>
          p.officeId === offId ||
          p.officeName.toLowerCase() === offNameLower ||
          parentProgramIds.has(p.id)
      );
      const scopedRemarks = allRemarks.filter((r) => actIds.has(r.activityId));
      const officeUids = new Set(
        allUsers.filter((u) => u.officeId === offId).map((u) => u.uid)
      );
      officeUids.add(actingUser.uid);
      const scopedLogs = allAuditLogs.filter((l) => officeUids.has(l.userUid));
      const scopedUsers = allUsers.filter((u) => u.officeId === offId || u.id === actingUser.id);
      return {
        users: scopedUsers,
        offices,
        fiscalYears,
        programs: scopedPrograms,
        activities: scopedActivities,
        remarksLogs: scopedRemarks,
        uploadedDocuments,
        auditLogs: scopedLogs,
        settings,
        officeAccountsProvisioned: true,
        demoSeedAllowed,
      };
    }

    const isAdmin = actingUser.role === 'SUPER_ADMIN' || actingUser.role === 'ADMINISTRATOR';
    return {
      users: isAdmin ? allUsers : allUsers.filter((u) => u.id === actingUser.id),
      offices,
      fiscalYears,
      programs: allPrograms,
      activities: allActivities,
      remarksLogs: allRemarks,
      uploadedDocuments,
      auditLogs: isAdmin ? allAuditLogs : allAuditLogs.slice(0, 150),
      settings,
      officeAccountsProvisioned: true,
      demoSeedAllowed,
    };
  }

  // Session Management, Idle Expiration & Login Rate Limiting
  getInactivityTimeoutMs(): number {
    const envMin = Number(process.env.SESSION_INACTIVITY_MINUTES || 0);
    const settingsMin = Number(this.getSettings().sessionTimeoutMinutes || 30);
    const mins = envMin >= 5 && envMin <= 480 ? envMin : Math.min(480, Math.max(5, settingsMin));
    return mins * 60 * 1000;
  }

  createSession(
    userId: string,
    ipAddress: string,
    userAgent: string,
    geoLabel = ''
  ): string {
    const sessionId = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, expires_at, created_at, last_activity_at, ip_address, user_agent, geo_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        userId,
        expiresAt,
        new Date(now).toISOString(),
        now,
        ipAddress.slice(0, 64),
        userAgent.slice(0, 200),
        geoLabel.slice(0, 120)
      );
    return sessionId;
  }

  recordLoginMetadata(userId: string, ipAddress: string) {
    const nowIso = new Date().toISOString();
    this.db
      .prepare('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?')
      .run(nowIso, ipAddress.slice(0, 64), userId);
  }

  getSessionStatus(sessionId: string): {
    user: UserAccount | null;
    expiredReason?: 'EXPIRED' | 'IDLE_TIMEOUT' | 'INACTIVE';
  } {
    const row = this.db
      .prepare('SELECT user_id, expires_at, last_activity_at FROM sessions WHERE id = ?')
      .get(sessionId) as
      | { user_id: string; expires_at: number; last_activity_at?: number }
      | undefined;
    if (!row) return { user: null };

    const now = Date.now();
    if (now > row.expires_at) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return { user: null, expiredReason: 'EXPIRED' };
    }

    const lastActivity = Number(row.last_activity_at || 0);
    const idleLimit = this.getInactivityTimeoutMs();
    if (lastActivity > 0 && now - lastActivity > idleLimit) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return { user: null, expiredReason: 'IDLE_TIMEOUT' };
    }

    const storedUser = this.getUserByIdWithHash(row.user_id);
    if (
      !storedUser ||
      !storedUser.isActive ||
      (storedUser.approvalStatus && storedUser.approvalStatus !== 'APPROVED')
    ) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return { user: null, expiredReason: 'INACTIVE' };
    }

    // Throttle SQLite activity heartbeat write to once per 30 seconds
    if (now - lastActivity > 30_000) {
      this.db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(now, sessionId);
    }

    return { user: this.sanitizePublicUser(storedUser) };
  }

  getSessionUser(sessionId: string): UserAccount | null {
    return this.getSessionStatus(sessionId).user;
  }

  getUserSessions(userId: string, currentSessionId?: string): ActiveSessionInfo[] {
    const now = Date.now();
    const rows = this.db
      .prepare(
        'SELECT id, created_at, last_activity_at, expires_at, ip_address, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_activity_at DESC'
      )
      .all(userId, now) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      createdAt: String(r.created_at),
      lastActivityAt: r.last_activity_at
        ? new Date(Number(r.last_activity_at)).toISOString()
        : String(r.created_at),
      expiresAt: Number(r.expires_at),
      ipAddress: String(r.ip_address || ''),
      userAgent: String(r.user_agent || ''),
      isCurrent: Boolean(currentSessionId && String(r.id) === currentSessionId),
    }));
  }

  revokeUserSession(userId: string, sessionId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
      .run(sessionId, userId);
    return Number(res.changes ?? 0) > 0;
  }

  getActiveSessionsOverview(currentSessionId?: string): ActiveSessionsOverview {
    const now = Date.now();
    const idleLimit = this.getInactivityTimeoutMs();
    const staleCutoff = now - idleLimit;

    // Prune expired and idle-expired sessions before aggregating live security telemetry
    this.db
      .prepare(
        'DELETE FROM sessions WHERE expires_at <= ? OR (last_activity_at > 0 AND last_activity_at < ?)'
      )
      .run(now, staleCutoff);

    const rows = this.db
      .prepare(
        `SELECT s.id, s.user_id, s.created_at, s.last_activity_at, s.expires_at,
                s.ip_address, s.user_agent, s.geo_label,
                u.display_name, u.email, u.role, u.office_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > ? AND u.is_active = 1 AND u.approval_status = 'APPROVED'
         ORDER BY s.last_activity_at DESC`
      )
      .all(now) as Record<string, unknown>[];

    const sessions: AdminActiveSession[] = rows.map((r) => {
      const classified = classifyIpAndGeo(
        String(r.ip_address || ''),
        String(r.geo_label || '')
      );
      const lastActivityIso = r.last_activity_at
        ? new Date(Number(r.last_activity_at)).toISOString()
        : String(r.created_at);
      return {
        id: String(r.id),
        userId: String(r.user_id),
        userName: String(r.display_name),
        userEmail: String(r.email),
        userRole: String(r.role) as UserRole,
        officeName: String(r.office_name),
        createdAt: String(r.created_at),
        lastActivityAt: lastActivityIso,
        expiresAt: Number(r.expires_at),
        ipAddress: classified.ipAddress,
        userAgent: String(r.user_agent || ''),
        isCurrent: Boolean(currentSessionId && String(r.id) === currentSessionId),
        subnet: classified.subnet,
        locationLabel: classified.locationLabel,
        networkZone: classified.networkZone,
        scope: classified.scope,
      };
    });

    const ipMap = new Map<
      string,
      IpLocationGroup & { userIds: Set<string>; userObjMap: Map<string, IpLocationGroup['users'][number]> }
    >();
    const zoneMap = new Map<
      string,
      { zone: string; scope: AdminActiveSession['scope']; sessionCount: number; ips: Set<string> }
    >();
    const uniqueIps = new Set<string>();
    const uniqueUsers = new Set<string>();

    for (const s of sessions) {
      uniqueIps.add(s.ipAddress);
      uniqueUsers.add(s.userId);

      const groupKey = `${s.ipAddress}::${s.locationLabel}`;
      let grp = ipMap.get(groupKey);
      if (!grp) {
        grp = {
          key: groupKey,
          ipAddress: s.ipAddress,
          subnet: s.subnet,
          locationLabel: s.locationLabel,
          networkZone: s.networkZone,
          scope: s.scope,
          sessionCount: 0,
          userCount: 0,
          lastActivityAt: s.lastActivityAt,
          users: [],
          userIds: new Set<string>(),
          userObjMap: new Map(),
        };
        ipMap.set(groupKey, grp);
      }
      grp.sessionCount += 1;
      if (s.lastActivityAt > grp.lastActivityAt) {
        grp.lastActivityAt = s.lastActivityAt;
      }
      if (!grp.userIds.has(s.userId)) {
        grp.userIds.add(s.userId);
        grp.userObjMap.set(s.userId, {
          userId: s.userId,
          displayName: s.userName,
          role: s.userRole,
          officeName: s.officeName,
        });
      }

      const zKey = `${s.scope}::${s.networkZone}`;
      let zEntry = zoneMap.get(zKey);
      if (!zEntry) {
        zEntry = {
          zone: s.networkZone,
          scope: s.scope,
          sessionCount: 0,
          ips: new Set<string>(),
        };
        zoneMap.set(zKey, zEntry);
      }
      zEntry.sessionCount += 1;
      zEntry.ips.add(s.ipAddress);
    }

    const locationGroups: IpLocationGroup[] = Array.from(ipMap.values())
      .map((g) => ({
        key: g.key,
        ipAddress: g.ipAddress,
        subnet: g.subnet,
        locationLabel: g.locationLabel,
        networkZone: g.networkZone,
        scope: g.scope,
        sessionCount: g.sessionCount,
        userCount: g.userIds.size,
        lastActivityAt: g.lastActivityAt,
        users: Array.from(g.userObjMap.values()),
      }))
      .sort(
        (a, b) =>
          b.sessionCount - a.sessionCount ||
          b.lastActivityAt.localeCompare(a.lastActivityAt)
      );

    const totalActiveSessions = sessions.length;
    const zoneBreakdown: SessionZoneBreakdown[] = Array.from(zoneMap.values())
      .map((z) => ({
        zone: z.zone,
        scope: z.scope,
        sessionCount: z.sessionCount,
        uniqueIpCount: z.ips.size,
        pct:
          totalActiveSessions > 0
            ? Math.round((z.sessionCount / totalActiveSessions) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.sessionCount - a.sessionCount);

    return {
      totalActiveSessions,
      uniqueIpCount: uniqueIps.size,
      uniqueUserCount: uniqueUsers.size,
      locationGroups,
      zoneBreakdown,
      sessions,
    };
  }

  getSessionRecordById(sessionId: string): { id: string; userId: string; ipAddress: string } | null {
    const row = this.db
      .prepare('SELECT id, user_id, ip_address FROM sessions WHERE id = ?')
      .get(sessionId) as { id: string; user_id: string; ip_address: string } | undefined;
    return row
      ? { id: row.id, userId: row.user_id, ipAddress: String(row.ip_address || '') }
      : null;
  }

  revokeOtherSessions(userId: string, keepSessionId: string) {
    this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .run(userId, keepSessionId);
  }

  deleteSession(sessionId: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  deleteSessionsForUser(userId: string) {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  checkLoginLockout(scopeKey: string): { locked: boolean; retryAfterSec: number } {
    const now = Date.now();
    const row = this.db
      .prepare('SELECT attempt_count, first_attempt_at, locked_until FROM login_attempts WHERE scope_key = ?')
      .get(scopeKey) as
      | { attempt_count: number; first_attempt_at: number; locked_until: number }
      | undefined;
    if (!row) return { locked: false, retryAfterSec: 0 };
    if (row.locked_until > now) {
      return {
        locked: true,
        retryAfterSec: Math.ceil((row.locked_until - now) / 1000),
      };
    }
    return { locked: false, retryAfterSec: 0 };
  }

  recordFailedLoginAttempt(
    scopeKey: string,
    maxAttempts: number,
    windowMs = 15 * 60 * 1000,
    lockoutMs = 5 * 60 * 1000
  ): { locked: boolean; retryAfterSec: number; attemptsRemaining: number } {
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT attempt_count, first_attempt_at, locked_until FROM login_attempts WHERE scope_key = ?')
      .get(scopeKey) as
      | { attempt_count: number; first_attempt_at: number; locked_until: number }
      | undefined;

    let count = 1;
    let firstAt = now;
    if (existing && now - existing.first_attempt_at <= windowMs && existing.locked_until <= now) {
      count = existing.attempt_count + 1;
      firstAt = existing.first_attempt_at;
    }

    const lockedUntil = count >= maxAttempts ? now + lockoutMs : 0;
    this.db
      .prepare(
        `INSERT INTO login_attempts (scope_key, attempt_count, first_attempt_at, locked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           attempt_count = excluded.attempt_count,
           first_attempt_at = excluded.first_attempt_at,
           locked_until = excluded.locked_until`
      )
      .run(scopeKey, count, firstAt, lockedUntil);

    return {
      locked: lockedUntil > now,
      retryAfterSec: lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0,
      attemptsRemaining: Math.max(0, maxAttempts - count),
    };
  }

  clearLoginAttempts(scopeKey: string) {
    this.db.prepare('DELETE FROM login_attempts WHERE scope_key = ?').run(scopeKey);
  }

  verifyUserPasscode(user: StoredUserRow, candidatePasscode: string): boolean {
    if (!user.passcodeHash || !candidatePasscode) return false;
    const valid = verifyPasscode(candidatePasscode, user.passcodeHash);
    if (valid && !isHashedPasscode(user.passcodeHash)) {
      const upgraded = hashPasscode(candidatePasscode);
      this.db.prepare('UPDATE users SET passcode_hash = ? WHERE id = ?').run(upgraded, user.id);
    }
    return valid;
  }

  private makeHttpError(status: number, message: string): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = status;
    return err;
  }

  setupInitialAdmin(params: {
    email: string;
    displayName: string;
    position: string;
    rawPassword: string;
    ipAddress: string;
  }): UserAccount {
    return this.runTransaction(() => {
      const status = this.getSetupStatus();
      if (!status.setupRequired) {
        throw this.makeHttpError(
          403,
          'Initial system setup has already been completed. Sign in with an authorized account.'
        );
      }

      const offices = this.getOffices();
      const mpdo = offices.find((o) => o.id === 'off-mpdo') || offices[0];
      const now = new Date().toISOString();
      const hashed = hashPasscode(params.rawPassword);
      const existingByEmail = this.getUserByEmailWithHash(params.email);
      const fallbackAdmin = this.getUserByIdWithHash('usr-admin-bula');
      const target = existingByEmail || fallbackAdmin;

      let adminUser: UserAccount;
      if (target) {
        this.db
          .prepare(
            `UPDATE users SET
              email = ?, display_name = ?, role = 'SUPER_ADMIN',
              position = ?, passcode_hash = ?, is_active = 1,
              approval_status = 'APPROVED', must_change_password = 0,
              privacy_consent_at = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            params.email.toLowerCase(),
            params.displayName,
            params.position || 'MPDO System Administrator',
            hashed,
            now,
            now,
            target.id
          );
        adminUser = this.sanitizePublicUser(this.getUserByIdWithHash(target.id)!);
      } else {
        const uid = `usr-superadmin-${Date.now().toString(36)}`;
        adminUser = {
          id: uid,
          uid,
          email: params.email.toLowerCase(),
          displayName: params.displayName,
          role: 'SUPER_ADMIN',
          officeId: mpdo?.id || 'off-mpdo',
          officeName: mpdo?.name || 'Municipal Planning and Development Office',
          position: params.position || 'MPDO System Administrator',
          isActive: true,
          approvalStatus: 'APPROVED',
          mustChangePassword: false,
          privacyConsentAt: now,
          createdAt: now,
          updatedAt: now,
        };
        this.insertUserStmt(adminUser, hashed);
      }

      this.insertAuditLogRow({
        id: `aud-${Date.now()}-setup`,
        userUid: adminUser.uid,
        userName: adminUser.displayName,
        userEmail: adminUser.email,
        userRole: adminUser.role,
        userOfficeName: adminUser.officeName,
        action: 'SETTINGS',
        entityType: 'SystemSetup',
        entityId: adminUser.id,
        summary: `Completed initial Super Administrator security setup (${adminUser.email}) from ${params.ipAddress}`,
        details: 'Password-protected authentication enforced across all accounts.',
        changes: [],
        timestamp: now,
      });

      return adminUser;
    });
  }

  registerPendingUser(params: {
    email: string;
    displayName: string;
    officeId: string;
    position: string;
    rawPassword: string;
    ipAddress: string;
  }): UserAccount {
    return this.runTransaction(() => {
      if (this.getUserByEmailWithHash(params.email)) {
        throw this.makeHttpError(409, `An account with email "${params.email}" already exists.`);
      }
      const office = this.getOffices().find((o) => o.id === params.officeId);
      if (!office) {
        throw this.makeHttpError(400, 'Selected Implementing Office does not exist.');
      }

      const now = new Date().toISOString();
      const uid = `usr-reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newUser: UserAccount = {
        id: uid,
        uid,
        email: params.email.toLowerCase(),
        displayName: params.displayName,
        role: 'VIEWER',
        officeId: office.id,
        officeName: office.name,
        position: params.position,
        isActive: false,
        approvalStatus: 'PENDING',
        mustChangePassword: false,
        privacyConsentAt: now,
        createdAt: now,
        updatedAt: now,
      };
      this.insertUserStmt(newUser, hashPasscode(params.rawPassword));
      this.insertAuditLogRow({
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userUid: newUser.uid,
        userName: newUser.displayName,
        userEmail: newUser.email,
        userRole: newUser.role,
        userOfficeName: newUser.officeName,
        action: 'CREATE',
        entityType: 'UserRegistration',
        entityId: newUser.id,
        summary: `Self-registration submitted by ${newUser.displayName} (${newUser.email}) from ${params.ipAddress} — awaiting Administrator approval`,
        details: '',
        changes: [],
        timestamp: now,
      });
      return this.sanitizePublicUser(this.getUserByIdWithHash(uid)!);
    });
  }

  approveUser(
    userId: string,
    params: {
      approvalStatus: ApprovalStatus;
      role?: UserRole;
      officeId?: string;
      isActive?: boolean;
      allowedModules?: SidebarModule[];
    },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { user: UserAccount; auditLog: AuditLog } {
    return this.runTransaction(() => {
      const existing = this.getUserByIdWithHash(userId);
      if (!existing) throw this.makeHttpError(404, 'User not found.');
      const office = params.officeId
        ? this.getOffices().find((o) => o.id === params.officeId)
        : undefined;
      if (params.officeId && !office) {
        throw this.makeHttpError(400, 'Selected office does not exist.');
      }

      const nextRole = params.role || existing.role;
      const nextActive =
        params.approvalStatus === 'APPROVED'
          ? (params.isActive ?? true)
          : false;
      const nextModulesJson =
        Array.isArray(params.allowedModules) && params.allowedModules.length > 0
          ? JSON.stringify(params.allowedModules)
          : existing.allowedModules
            ? JSON.stringify(existing.allowedModules)
            : '';

      this.db
        .prepare(
          `UPDATE users SET
            approval_status = ?, role = ?, office_id = ?, office_name = ?,
            is_active = ?, allowed_modules_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          params.approvalStatus,
          nextRole,
          office?.id || existing.officeId,
          office?.name || existing.officeName,
          nextActive ? 1 : 0,
          nextModulesJson,
          new Date().toISOString(),
          userId
        );

      if (!nextActive || params.approvalStatus !== 'APPROVED') {
        this.deleteSessionsForUser(userId);
      }

      const saved = this.sanitizePublicUser(this.getUserByIdWithHash(userId)!);
      const auditLog = this.insertAuditLogRow(auditEntry);
      return { user: saved, auditLog };
    });
  }

  updateOwnProfile(
    userId: string,
    params: { displayName: string; position: string },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { user: UserAccount; auditLog: AuditLog } {
    return this.runTransaction(() => {
      const existing = this.getUserByIdWithHash(userId);
      if (!existing) throw this.makeHttpError(404, 'User not found.');
      this.db
        .prepare('UPDATE users SET display_name = ?, position = ?, updated_at = ? WHERE id = ?')
        .run(params.displayName, params.position, new Date().toISOString(), userId);
      const saved = this.sanitizePublicUser(this.getUserByIdWithHash(userId)!);
      const auditLog = this.insertAuditLogRow(auditEntry);
      return { user: saved, auditLog };
    });
  }

  updateOwnPassword(
    userId: string,
    newRawPassword: string,
    keepSessionId: string | undefined,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { user: UserAccount; auditLog: AuditLog } {
    return this.runTransaction(() => {
      const existing = this.getUserByIdWithHash(userId);
      if (!existing) throw this.makeHttpError(404, 'User not found.');
      this.db
        .prepare(
          'UPDATE users SET passcode_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?'
        )
        .run(hashPasscode(newRawPassword), new Date().toISOString(), userId);
      if (keepSessionId) {
        this.revokeOtherSessions(userId, keepSessionId);
      }
      const saved = this.sanitizePublicUser(this.getUserByIdWithHash(userId)!);
      const auditLog = this.insertAuditLogRow(auditEntry);
      return { user: saved, auditLog };
    });
  }

  createResetToken(
    userId: string,
    createdByUid: string,
    expiresMinutes: number,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { rawToken: string; expiresAt: string; auditLog: AuditLog } {
    return this.runTransaction(() => {
      const existing = this.getUserByIdWithHash(userId);
      if (!existing) throw this.makeHttpError(404, 'User not found.');
      // Invalidate any prior unused reset tokens for this user
      this.db
        .prepare("DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at = ''")
        .run(userId);

      const rawToken = generateResetToken();
      const tokenHash = hashToken(rawToken);
      const now = Date.now();
      const expiresAtMs = now + expiresMinutes * 60 * 1000;
      const tokenId = `rst-${now}-${Math.random().toString(36).slice(2, 7)}`;

      this.db
        .prepare(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_by, created_at)
           VALUES (?, ?, ?, ?, '', ?, ?)`
        )
        .run(tokenId, userId, tokenHash, expiresAtMs, createdByUid, new Date(now).toISOString());

      const auditLog = this.insertAuditLogRow(auditEntry);
      return {
        rawToken,
        expiresAt: new Date(expiresAtMs).toISOString(),
        auditLog,
      };
    });
  }

  consumeResetToken(
    email: string,
    rawToken: string,
    newRawPassword: string,
    ipAddress: string
  ): UserAccount {
    return this.runTransaction(() => {
      const user = this.getUserByEmailWithHash(email);
      if (!user) {
        throw this.makeHttpError(400, 'Invalid email or recovery token.');
      }
      const tokenHash = hashToken(rawToken);
      const now = Date.now();
      const tokenRow = this.db
        .prepare(
          "SELECT id, expires_at, used_at FROM password_reset_tokens WHERE user_id = ? AND token_hash = ? ORDER BY created_at DESC LIMIT 1"
        )
        .get(user.id, tokenHash) as
        | { id: string; expires_at: number; used_at: string }
        | undefined;

      if (!tokenRow || tokenRow.used_at !== '' || tokenRow.expires_at < now) {
        throw this.makeHttpError(400, 'Recovery token is invalid or has expired.');
      }

      const nowIso = new Date(now).toISOString();
      this.db
        .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?')
        .run(nowIso, tokenRow.id);
      this.db
        .prepare(
          'UPDATE users SET passcode_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?'
        )
        .run(hashPasscode(newRawPassword), nowIso, user.id);
      this.deleteSessionsForUser(user.id);

      const updatedUser = this.sanitizePublicUser(this.getUserByIdWithHash(user.id)!);
      this.insertAuditLogRow({
        id: `aud-${now}-${Math.random().toString(36).slice(2, 6)}`,
        userUid: updatedUser.uid,
        userName: updatedUser.displayName,
        userEmail: updatedUser.email,
        userRole: updatedUser.role,
        userOfficeName: updatedUser.officeName,
        action: 'UPDATE',
        entityType: 'PasswordReset',
        entityId: updatedUser.id,
        summary: `Completed password reset via recovery token from ${ipAddress}`,
        details: '',
        changes: [{ field: 'Password', before: 'Reset Pending', after: 'Updated (scrypt hash)' }],
        timestamp: nowIso,
      });

      return updatedUser;
    });
  }

  // Transactional Mutations with Relational Integrity & Optimistic Locking
  createProgram(p: Program, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      const officeExists = this.db
        .prepare('SELECT id FROM offices WHERE id = ?')
        .get(p.officeId);
      if (!officeExists) {
        throw this.makeHttpError(400, 'Implementing office referenced by this program does not exist.');
      }
      if (p.parentProgramId && !this.getProgramById(p.parentProgramId)) {
        throw this.makeHttpError(400, 'Parent program referenced by this subprogram does not exist.');
      }
      const duplicate = this.db
        .prepare(
          `SELECT id FROM programs
           WHERE fiscal_year = ? AND lower(aip_ref_code) = lower(?) AND office_id = ? AND lower(title) = lower(?)`
        )
        .get(p.fiscalYear, p.aipRefCode, p.officeId, p.title);
      if (duplicate) {
        throw this.makeHttpError(
          409,
          `Duplicate program detected for FY ${p.fiscalYear} (${p.aipRefCode}: ${p.title}).`
        );
      }

      this.insertProgramStmt(p);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  updateProgram(
    p: Program,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>,
    expectedUpdatedAt?: string
  ): AuditLog {
    return this.runTransaction(() => {
      const existing = this.getProgramById(p.id);
      if (!existing) throw this.makeHttpError(404, 'Program not found.');
      if (expectedUpdatedAt && existing.updatedAt && existing.updatedAt !== expectedUpdatedAt) {
        throw this.makeHttpError(
          409,
          'This program was modified by another user. Refresh the workspace to load the latest version before saving.'
        );
      }
      const officeExists = this.db
        .prepare('SELECT id FROM offices WHERE id = ?')
        .get(p.officeId);
      if (!officeExists) {
        throw this.makeHttpError(400, 'Implementing office referenced by this program does not exist.');
      }

      const nextStatus = p.status || existing.status || 'PENDING';

      this.db
        .prepare(
          `UPDATE programs SET
            fiscal_year = ?, aip_ref_code = ?, title = ?, target_outputs = ?, sector = ?,
            budget = ?, supplemental_budget = ?, supplemental_logs_json = ?,
            physical_target = ?, monthly_physical_target_json = ?,
            source_of_fund = ?, gad_fund = ?, status = ?, office_id = ?, office_name = ?,
            parent_program_id = ?, order_index = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          p.fiscalYear,
          p.aipRefCode,
          p.title,
          p.targetOutputs || '',
          p.sector,
          p.budget ?? 0,
          p.supplementalBudget ?? 0,
          JSON.stringify(p.supplementalLogs || []),
          p.physicalTarget ?? 0,
          JSON.stringify(p.monthlyPhysicalTarget || {}),
          p.sourceOfFund || '',
          p.gadFund ? 1 : 0,
          nextStatus,
          p.officeId,
          p.officeName,
          p.parentProgramId ?? null,
          p.orderIndex ?? 0,
          p.updatedAt,
          p.id
        );

      if ((existing.status || 'PENDING') !== nextStatus) {
        this.db
          .prepare('UPDATE activities SET status = ? WHERE program_id = ? OR subprogram_id = ?')
          .run(nextStatus, p.id, p.id);
      }

      return this.insertAuditLogRow(auditEntry);
    });
  }

  deleteProgram(id: string, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      const actIds = (
        this.db
          .prepare('SELECT id FROM activities WHERE program_id = ? OR subprogram_id = ?')
          .all(id, id) as { id: string }[]
      ).map((r) => r.id);
      for (const actId of actIds) {
        this.db.prepare('DELETE FROM remarks_logs WHERE activity_id = ?').run(actId);
      }
      this.db
        .prepare('DELETE FROM activities WHERE program_id = ? OR subprogram_id = ?')
        .run(id, id);
      this.db.prepare('DELETE FROM programs WHERE id = ? OR parent_program_id = ?').run(id, id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  createActivity(a: Activity, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      if (!this.getProgramById(a.programId)) {
        throw this.makeHttpError(400, 'Parent program does not exist.');
      }
      const officeExists = this.db
        .prepare('SELECT id FROM offices WHERE id = ?')
        .get(a.officeId);
      if (!officeExists) {
        throw this.makeHttpError(400, 'Implementing office does not exist.');
      }
      const duplicate = this.db
        .prepare(
          `SELECT id FROM activities
           WHERE program_id = ? AND fiscal_year = ? AND lower(reference_number) = lower(?) AND lower(description) = lower(?)`
        )
        .get(a.programId, a.fiscalYear, a.referenceNumber, a.description);
      if (duplicate) {
        throw this.makeHttpError(
          409,
          `Duplicate PPA activity "${a.referenceNumber}" already exists under this program.`
        );
      }

      this.insertActivityStmt(a);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  updateActivity(
    a: Activity,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>,
    expectedUpdatedAt?: string
  ): AuditLog {
    return this.runTransaction(() => {
      const existing = this.getActivityById(a.id);
      if (!existing) throw this.makeHttpError(404, 'Activity not found.');
      if (expectedUpdatedAt && existing.updatedAt && existing.updatedAt !== expectedUpdatedAt) {
        throw this.makeHttpError(
          409,
          'This activity was modified by another user. Refresh the workspace to load the latest version before saving.'
        );
      }
      if (!this.getProgramById(a.programId)) {
        throw this.makeHttpError(400, 'Parent program does not exist.');
      }
      const officeExists = this.db
        .prepare('SELECT id FROM offices WHERE id = ?')
        .get(a.officeId);
      if (!officeExists) {
        throw this.makeHttpError(400, 'Implementing office does not exist.');
      }

      this.db
        .prepare(
          `UPDATE activities SET
            program_id = ?, subprogram_id = ?, fiscal_year = ?, reference_number = ?,
            description = ?, target_outputs = ?, office_id = ?, office_name = ?,
            source_of_fund = ?, budget_classification = ?,
            gf = ?, ps = ?, mooe = ?, co = ?, withheld_amount = ?,
            supplemental_budget_1 = ?, supplemental_budget_2 = ?, supplemental_budget_3 = ?,
            supplemental_budget_4 = ?, supplemental_budget_5 = ?,
            monthly_json = ?, status = ?, completion_pct = ?, remarks = ?, milestones_json = ?, evidence_json = ?, order_index = ?,
            start_date = ?, end_date = ?, updated_by = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          a.programId,
          a.subprogramId ?? null,
          a.fiscalYear,
          a.referenceNumber,
          a.description,
          a.targetOutputs || '',
          a.officeId,
          a.officeName,
          a.sourceOfFund || '',
          a.budgetClassification,
          a.gf ?? 0,
          a.ps,
          a.mooe,
          a.co,
          a.withheldAmount,
          a.supplementalBudget1,
          a.supplementalBudget2,
          a.supplementalBudget3,
          a.supplementalBudget4,
          a.supplementalBudget5,
          JSON.stringify(a.monthly),
          a.status,
          Math.min(100, Math.max(0, Number(a.completionPct ?? 0))),
          a.remarks || '',
          JSON.stringify(a.milestones || []),
          JSON.stringify(a.evidence || []),
          a.orderIndex ?? 0,
          a.startDate || '',
          a.endDate || '',
          a.updatedBy,
          a.updatedAt,
          a.id
        );
      return this.insertAuditLogRow(auditEntry);
    });
  }

  reorderActivities(
    updates: { id: string; orderIndex: number }[],
    now: string,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    return this.runTransaction(() => {
      const stmt = this.db.prepare(
        'UPDATE activities SET order_index = ?, updated_at = ? WHERE id = ?'
      );
      for (const u of updates) {
        stmt.run(u.orderIndex, now, u.id);
      }
      return this.insertAuditLogRow(auditEntry);
    });
  }

  deleteActivity(id: string, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.db.prepare('DELETE FROM remarks_logs WHERE activity_id = ?').run(id);
      this.db.prepare('DELETE FROM activities WHERE id = ?').run(id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  createRemark(r: RemarkLog, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      if (!this.getActivityById(r.activityId)) {
        throw this.makeHttpError(400, 'Target activity does not exist.');
      }
      this.insertRemarkStmt(r);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  deleteRemark(id: string, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.db.prepare('DELETE FROM remarks_logs WHERE id = ?').run(id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  createOffice(
    office: Office,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { createdUser: UserAccount | null; auditLog: AuditLog } {
    return this.runTransaction(() => {
      this.insertOfficeStmt(office);
      const existingUsers = this.getUsers();
      let createdUser: UserAccount | null = null;
      if (!existingUsers.some((u) => u.officeId === office.id && u.role === 'ENCODER')) {
        createdUser = buildOfficeEncoderAccount(office, existingUsers);
        this.insertUserStmt(createdUser, null);
      }
      const auditLog = this.insertAuditLogRow(auditEntry);
      return { createdUser, auditLog };
    });
  }

  updateOffice(office: Office, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.db
        .prepare('UPDATE offices SET code = ?, name = ?, head_name = ? WHERE id = ?')
        .run(office.code, office.name, office.headName, office.id);
      this.db
        .prepare('UPDATE users SET office_name = ? WHERE office_id = ?')
        .run(office.name, office.id);
      this.db
        .prepare('UPDATE programs SET office_name = ? WHERE office_id = ?')
        .run(office.name, office.id);
      this.db
        .prepare('UPDATE activities SET office_name = ? WHERE office_id = ?')
        .run(office.name, office.id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  deleteOffice(id: string, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      const progRef = this.db.prepare('SELECT COUNT(*) AS cnt FROM programs WHERE office_id = ?').get(id) as { cnt?: number };
      const actRef = this.db.prepare('SELECT COUNT(*) AS cnt FROM activities WHERE office_id = ?').get(id) as { cnt?: number };
      const usrRef = this.db.prepare('SELECT COUNT(*) AS cnt FROM users WHERE office_id = ?').get(id) as { cnt?: number };
      if ((progRef.cnt || 0) > 0 || (actRef.cnt || 0) > 0 || (usrRef.cnt || 0) > 0) {
        throw this.makeHttpError(
          409,
          'Cannot delete office while programs, activities, or personnel accounts are still assigned to it.'
        );
      }
      this.db.prepare('DELETE FROM offices WHERE id = ?').run(id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  createFiscalYear(
    fy: FiscalYear,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    return this.runTransaction(() => {
      if (fy.isDefault) {
        this.db.prepare('UPDATE fiscal_years SET is_default = 0').run();
      }
      this.insertFiscalYearStmt(fy);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  updateFiscalYear(
    fy: FiscalYear,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    return this.runTransaction(() => {
      if (fy.isDefault) {
        this.db.prepare('UPDATE fiscal_years SET is_default = 0').run();
      }
      this.db
        .prepare(
          'UPDATE fiscal_years SET year = ?, label = ?, is_active = ?, is_default = ? WHERE id = ?'
        )
        .run(fy.year, fy.label, fy.isActive ? 1 : 0, fy.isDefault ? 1 : 0, fy.id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  deleteFiscalYear(id: string, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      const fy = this.getFiscalYears().find((f) => f.id === id);
      if (!fy) throw this.makeHttpError(404, 'Fiscal year not found.');
      const progRef = this.db.prepare('SELECT COUNT(*) AS cnt FROM programs WHERE fiscal_year = ?').get(fy.year) as { cnt?: number };
      const actRef = this.db.prepare('SELECT COUNT(*) AS cnt FROM activities WHERE fiscal_year = ?').get(fy.year) as { cnt?: number };
      if ((progRef.cnt || 0) > 0 || (actRef.cnt || 0) > 0) {
        throw this.makeHttpError(
          409,
          `Cannot delete FY ${fy.year} while programs or activities exist under this fiscal year.`
        );
      }
      this.db.prepare('DELETE FROM fiscal_years WHERE id = ?').run(id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  createUser(
    user: UserAccount,
    rawPasscode: string | undefined,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { user: UserAccount; auditLog: AuditLog } {
    return this.runTransaction(() => {
      const officeExists = this.db.prepare('SELECT id FROM offices WHERE id = ?').get(user.officeId);
      if (!officeExists) {
        throw this.makeHttpError(400, 'Assigned Implementing Office does not exist.');
      }
      const passcodeHash =
        rawPasscode && rawPasscode.trim() ? hashPasscode(rawPasscode.trim()) : null;
      this.insertUserStmt(user, passcodeHash);
      const saved = this.sanitizePublicUser(this.getUserByIdWithHash(user.id)!);
      const auditLog = this.insertAuditLogRow(auditEntry);
      return { user: saved, auditLog };
    });
  }

  updateUser(
    user: UserAccount,
    options: { rawPasscode?: string; clearPasscode?: boolean },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { user: UserAccount; auditLog: AuditLog } {
    return this.runTransaction(() => {
      const existing = this.getUserByIdWithHash(user.id);
      if (!existing) throw this.makeHttpError(404, 'User not found.');
      let nextHash = existing.passcodeHash;
      if (options.clearPasscode) {
        nextHash = null;
      } else if (options.rawPasscode && options.rawPasscode.trim()) {
        nextHash = hashPasscode(options.rawPasscode.trim());
      }

      const allowedModulesJson =
        Array.isArray(user.allowedModules) && user.allowedModules.length > 0
          ? JSON.stringify(user.allowedModules)
          : '';

      this.db
        .prepare(
          `UPDATE users SET
            email = ?, display_name = ?, role = ?, office_id = ?, office_name = ?,
            position = ?, passcode_hash = ?, is_active = ?,
            approval_status = ?, must_change_password = ?, allowed_modules_json = ?,
            updated_at = ?
           WHERE id = ?`
        )
        .run(
          user.email.toLowerCase(),
          user.displayName,
          user.role,
          user.officeId,
          user.officeName,
          user.position || 'Monitoring Personnel',
          nextHash,
          user.isActive ? 1 : 0,
          user.approvalStatus || existing.approvalStatus || 'APPROVED',
          user.mustChangePassword ? 1 : 0,
          allowedModulesJson,
          user.updatedAt,
          user.id
        );

      if (
        !user.isActive ||
        existing.role !== user.role ||
        existing.officeId !== user.officeId ||
        options.clearPasscode
      ) {
        this.deleteSessionsForUser(user.id);
      }

      const saved = this.sanitizePublicUser(this.getUserByIdWithHash(user.id)!);
      const auditLog = this.insertAuditLogRow(auditEntry);
      return { user: saved, auditLog };
    });
  }

  deleteUser(id: string, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.deleteSessionsForUser(id);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  provisionOfficeAccounts(
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { users: UserAccount[]; created: UserAccount[]; auditLog: AuditLog } {
    return this.runTransaction(() => {
      const offices = this.getOffices();
      const currentUsers = this.getUsers();
      const { created } = ensureAllOfficeAccounts(offices, currentUsers);
      for (const acc of created) {
        this.insertUserStmt(acc, null);
      }
      const auditLog = this.insertAuditLogRow(auditEntry);
      return {
        users: this.getUsers(),
        created,
        auditLog,
      };
    });
  }

  updateSettings(
    settings: SystemSettings,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    return this.runTransaction(() => {
      this.upsertSettingsStmt(settings);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  importBatch(
    payload: {
      newOffices: Office[];
      newPrograms: Program[];
      updatedActivities: Activity[];
      newActivities: Activity[];
      uploadedDocument: UploadedDocument;
    },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    return this.runTransaction(() => {
      const existingOffices = this.getOffices();
      const existingOfficeNames = new Set(existingOffices.map((o) => o.name.toLowerCase()));
      for (const off of payload.newOffices) {
        if (!existingOfficeNames.has(off.name.toLowerCase())) {
          this.insertOfficeStmt(off);
          existingOfficeNames.add(off.name.toLowerCase());
          const allUsers = this.getUsers();
          if (!allUsers.some((u) => u.officeId === off.id && u.role === 'ENCODER')) {
            this.insertUserStmt(buildOfficeEncoderAccount(off, allUsers), null);
          }
        }
      }

      const existingProgIds = new Set(this.getPrograms().map((p) => p.id));
      for (const prog of payload.newPrograms) {
        if (!existingProgIds.has(prog.id)) {
          this.insertProgramStmt(prog);
          existingProgIds.add(prog.id);
        }
      }

      for (const act of payload.updatedActivities) {
        this.db
          .prepare(
            `UPDATE activities SET
              program_id = ?, subprogram_id = ?, fiscal_year = ?, reference_number = ?,
              description = ?, target_outputs = ?, office_id = ?, office_name = ?,
              source_of_fund = ?, budget_classification = ?,
              gf = ?, ps = ?, mooe = ?, co = ?, withheld_amount = ?,
              supplemental_budget_1 = ?, supplemental_budget_2 = ?, supplemental_budget_3 = ?,
              supplemental_budget_4 = ?, supplemental_budget_5 = ?,
              monthly_json = ?, status = ?, remarks = ?, updated_by = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            act.programId,
            act.subprogramId ?? null,
            act.fiscalYear,
            act.referenceNumber,
            act.description,
            act.targetOutputs || '',
            act.officeId,
            act.officeName,
            act.sourceOfFund || '',
            act.budgetClassification,
            act.gf ?? 0,
            act.ps,
            act.mooe,
            act.co,
            act.withheldAmount,
            act.supplementalBudget1,
            act.supplementalBudget2,
            act.supplementalBudget3,
            act.supplementalBudget4,
            act.supplementalBudget5,
            JSON.stringify(act.monthly),
            act.status,
            act.remarks || '',
            act.updatedBy,
            act.updatedAt,
            act.id
          );
      }

      const existingActIds = new Set(this.getActivities().map((a) => a.id));
      for (const act of payload.newActivities) {
        if (!existingActIds.has(act.id)) {
          this.insertActivityStmt(act);
          existingActIds.add(act.id);
        }
      }

      this.insertDocumentStmt(payload.uploadedDocument);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  seedDemo(
    sample: { programs: Program[]; activities: Activity[] },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    return this.runTransaction(() => {
      const existingProgIds = new Set(this.getPrograms().map((p) => p.id));
      for (const p of sample.programs) {
        if (!existingProgIds.has(p.id)) this.insertProgramStmt(p);
      }
      const existingActIds = new Set(this.getActivities().map((a) => a.id));
      for (const a of sample.activities) {
        if (!existingActIds.has(a.id)) this.insertActivityStmt(a);
      }
      return this.insertAuditLogRow(auditEntry);
    });
  }

  resetPPAData(auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.db.prepare('DELETE FROM remarks_logs').run();
      this.db.prepare('DELETE FROM activities').run();
      this.db.prepare('DELETE FROM programs').run();
      return this.insertAuditLogRow(auditEntry);
    });
  }

  // Backup Snapshots, SHA-256 Verification, Retention Pruning & Atomic Restore
  buildSnapshot(trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL'): BackupSnapshotPayload {
    const rawUsers = (
      this.db.prepare('SELECT * FROM users ORDER BY rowid ASC').all() as Record<string, unknown>[]
    ).map((r) => {
      const u = this.mapUserRow(r, true);
      const { passcodeHash, passcode: _p, clearPasscode: _c, hasPasscode: _h, ...rest } = u;
      return { ...rest, passcodeHash };
    });

    return {
      version: 2,
      createdAt: new Date().toISOString(),
      trigger,
      offices: this.getOffices(),
      users: rawUsers,
      fiscalYears: this.getFiscalYears(),
      programs: this.getPrograms(),
      activities: this.getActivities(),
      remarksLogs: this.getRemarks(),
      uploadedDocuments: this.getUploadedDocuments(),
      settings: this.getSettings(),
    };
  }

  createBackupSnapshot(
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>,
    trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL',
    retentionCount?: number
  ): {
    backup: BackupInfo;
    auditLog: AuditLog;
  } {
    const snapshot = this.buildSnapshot(trigger);
    const stamp = snapshot.createdAt.replace(/[:.]/g, '-');
    const prefix = trigger === 'SCHEDULED' ? 'bula-ppa-backup-auto' : 'bula-ppa-backup';
    const fileName = `${prefix}-${stamp}.json`;
    const targetPath = path.join(this.backupDir, fileName);
    const jsonStr = JSON.stringify(snapshot, null, 2);
    const sha256 = computeSha256(jsonStr);
    fs.writeFileSync(targetPath, jsonStr, 'utf-8');
    fs.writeFileSync(`${targetPath}.sha256`, `${sha256}  ${fileName}\n`, 'utf-8');

    const auditLog = this.runTransaction(() => this.insertAuditLogRow(auditEntry));

    if (retentionCount && retentionCount > 0) {
      this.pruneOldScheduledBackups(retentionCount);
    }

    return {
      backup: {
        fileName,
        createdAt: snapshot.createdAt,
        sizeBytes: Buffer.byteLength(jsonStr, 'utf-8'),
        programCount: snapshot.programs.length,
        activityCount: snapshot.activities.length,
        sha256,
        verified: true,
        trigger,
      },
      auditLog,
    };
  }

  pruneOldScheduledBackups(retentionCount: number) {
    if (!fs.existsSync(this.backupDir)) return;
    const autoFiles = fs
      .readdirSync(this.backupDir)
      .filter((f) => /^bula-ppa-backup-auto-.*\.json$/.test(f))
      .map((f) => ({
        fileName: f,
        fullPath: path.join(this.backupDir, f),
        mtimeMs: fs.statSync(path.join(this.backupDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const obsolete of autoFiles.slice(Math.max(1, retentionCount))) {
      try {
        fs.unlinkSync(obsolete.fullPath);
        if (fs.existsSync(`${obsolete.fullPath}.sha256`)) {
          fs.unlinkSync(`${obsolete.fullPath}.sha256`);
        }
      } catch {
        // ignore cleanup error
      }
    }
  }

  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) return [];
    const files = fs
      .readdirSync(this.backupDir)
      .filter((f) => /^bula-ppa-backup-.*\.json$/.test(f));
    const list: BackupInfo[] = [];
    for (const fileName of files) {
      try {
        const fullPath = path.join(this.backupDir, fileName);
        const stat = fs.statSync(fullPath);
        const rawText = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(rawText) as Partial<BackupSnapshotPayload>;
        const actualSha = computeSha256(rawText);
        const sidecarPath = `${fullPath}.sha256`;
        let verified: boolean | undefined;
        if (fs.existsSync(sidecarPath)) {
          const expectedSha = fs.readFileSync(sidecarPath, 'utf-8').trim().split(/\s+/)[0];
          verified = expectedSha === actualSha;
        }
        list.push({
          fileName,
          createdAt: parsed.createdAt || stat.mtime.toISOString(),
          sizeBytes: stat.size,
          programCount: Array.isArray(parsed.programs) ? parsed.programs.length : 0,
          activityCount: Array.isArray(parsed.activities) ? parsed.activities.length : 0,
          sha256: actualSha,
          verified,
          trigger:
            parsed.trigger || (fileName.startsWith('bula-ppa-backup-auto-') ? 'SCHEDULED' : 'MANUAL'),
        });
      } catch {
        // skip corrupted backup entry
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  verifyBackupSnapshot(fileName: string): {
    valid: boolean;
    fileName: string;
    sha256: string;
    programCount: number;
    activityCount: number;
    message: string;
  } {
    const fullPath = this.getBackupFilePath(fileName);
    if (!fullPath) {
      throw this.makeHttpError(404, 'Backup snapshot file not found.');
    }
    const rawText = fs.readFileSync(fullPath, 'utf-8');
    const actualSha = computeSha256(rawText);
    const sidecarPath = `${fullPath}.sha256`;
    let checksumMatch = true;
    if (fs.existsSync(sidecarPath)) {
      const expectedSha = fs.readFileSync(sidecarPath, 'utf-8').trim().split(/\s+/)[0];
      checksumMatch = expectedSha === actualSha;
    }
    const parsed = JSON.parse(rawText) as Partial<BackupSnapshotPayload>;
    const structureOk =
      Array.isArray(parsed.offices) &&
      Array.isArray(parsed.users) &&
      Array.isArray(parsed.fiscalYears) &&
      Array.isArray(parsed.programs) &&
      Array.isArray(parsed.activities);
    const valid = checksumMatch && structureOk;
    return {
      valid,
      fileName,
      sha256: actualSha,
      programCount: Array.isArray(parsed.programs) ? parsed.programs.length : 0,
      activityCount: Array.isArray(parsed.activities) ? parsed.activities.length : 0,
      message: !checksumMatch
        ? 'SHA-256 integrity mismatch: backup file was modified outside the system.'
        : !structureOk
          ? 'Backup JSON structure is incomplete.'
          : fs.existsSync(sidecarPath)
            ? `Snapshot verified (${actualSha.slice(0, 12)}...).`
            : `Structure valid (legacy snapshot without sidecar; SHA-256 ${actualSha.slice(0, 12)}...).`,
    };
  }

  getLastBackupTimestamp(): number | null {
    const latest = this.listBackups()[0];
    return latest ? new Date(latest.createdAt).getTime() : null;
  }

  getBackupFilePath(fileName: string): string | null {
    if (!/^bula-ppa-backup-[A-Za-z0-9_-]+\.json$/.test(fileName)) return null;
    const fullPath = path.join(this.backupDir, fileName);
    if (!fs.existsSync(fullPath)) return null;
    return fullPath;
  }

  restoreSnapshot(
    snapshot: {
      offices: Office[];
      users: (UserAccount & { passcodeHash?: string | null })[];
      fiscalYears: FiscalYear[];
      programs: Program[];
      activities: Activity[];
      remarksLogs: RemarkLog[];
      uploadedDocuments: UploadedDocument[];
      settings: SystemSettings;
    },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    return this.runTransaction(() => {
      // Never delete audit_logs (strictly append-only)
      this.db.prepare('DELETE FROM remarks_logs').run();
      this.db.prepare('DELETE FROM activities').run();
      this.db.prepare('DELETE FROM programs').run();
      this.db.prepare('DELETE FROM uploaded_documents').run();
      this.db.prepare('DELETE FROM fiscal_years').run();
      this.db.prepare('DELETE FROM users').run();
      this.db.prepare('DELETE FROM offices').run();

      for (const off of snapshot.offices) this.insertOfficeStmt(off);
      for (const u of snapshot.users) {
        const hash = u.passcodeHash
          ? u.passcodeHash
          : u.passcode
            ? isHashedPasscode(u.passcode)
              ? u.passcode
              : hashPasscode(u.passcode)
            : null;
        this.insertUserStmt(u, hash);
      }
      for (const fy of snapshot.fiscalYears) this.insertFiscalYearStmt(fy);
      for (const p of snapshot.programs) this.insertProgramStmt(p);
      for (const a of snapshot.activities) this.insertActivityStmt(a);
      for (const r of snapshot.remarksLogs) this.insertRemarkStmt(r);
      for (const d of snapshot.uploadedDocuments) this.insertDocumentStmt(d);
      this.upsertSettingsStmt({ ...DEFAULT_SETTINGS, ...snapshot.settings });
      return this.insertAuditLogRow(auditEntry);
    });
  }

  // Official Document Templates & Version History
  private mapTemplateVersionRow(r: Record<string, unknown>): DocumentTemplateVersion {
    let analysis: TemplateAnalysisSummary = {
      format: 'xlsx',
      pageCountOrSheets: 1,
      sheetOrPageNames: [],
      detectedPlaceholders: [],
      detectedColumns: [],
      warnings: [],
    };
    try {
      analysis = JSON.parse(String(r.analysis_json || '{}')) as TemplateAnalysisSummary;
    } catch {
      // keep default empty summary
    }
    return {
      id: String(r.id),
      templateId: String(r.template_id),
      versionNumber: Number(r.version_number),
      fileName: String(r.file_name),
      mimeType: String(r.mime_type),
      fileSize: Number(r.file_size),
      sha256: String(r.sha256),
      notes: String(r.notes || ''),
      analysis,
      uploadedByUid: String(r.uploaded_by_uid),
      uploadedByName: String(r.uploaded_by_name),
      uploadedAt: String(r.uploaded_at),
    };
  }

  listDocumentTemplates(): DocumentTemplate[] {
    const tplRows = this.db
      .prepare('SELECT * FROM document_templates ORDER BY is_default DESC, updated_at DESC')
      .all() as Record<string, unknown>[];
    const verRows = this.db
      .prepare('SELECT * FROM document_template_versions ORDER BY version_number DESC')
      .all() as Record<string, unknown>[];

    const versionsByTemplate = new Map<string, DocumentTemplateVersion[]>();
    for (const vr of verRows) {
      const mapped = this.mapTemplateVersionRow(vr);
      const list = versionsByTemplate.get(mapped.templateId) || [];
      list.push(mapped);
      versionsByTemplate.set(mapped.templateId, list);
    }

    return tplRows.map((tr) => {
      const id = String(tr.id);
      const versions = versionsByTemplate.get(id) || [];
      const currentVersionId = String(tr.current_version_id);
      const activeVer =
        versions.find((v) => v.id === currentVersionId) || versions[0];

      return {
        id,
        name: String(tr.name),
        description: String(tr.description || ''),
        format: String(tr.format) as TemplateFormat,
        targetReport: String(tr.target_report) as TemplateReportTarget,
        isDefault: Boolean(Number(tr.is_default)),
        isActive: Boolean(Number(tr.is_active)),
        currentVersionId,
        currentVersionNumber: Number(tr.current_version_number || activeVer?.versionNumber || 1),
        fileName: activeVer?.fileName || '',
        fileSize: activeVer?.fileSize || 0,
        sha256: activeVer?.sha256 || '',
        analysis: activeVer?.analysis || {
          format: String(tr.format) as TemplateFormat,
          pageCountOrSheets: 1,
          sheetOrPageNames: [],
          detectedPlaceholders: [],
          detectedColumns: [],
          warnings: [],
        },
        versions,
        createdByUid: String(tr.created_by_uid),
        createdByName: String(tr.created_by_name),
        createdAt: String(tr.created_at),
        updatedAt: String(tr.updated_at),
      };
    });
  }

  getDocumentTemplateById(id: string): DocumentTemplate | null {
    return this.listDocumentTemplates().find((t) => t.id === id) || null;
  }

  createOrVersionDocumentTemplate(
    params: {
      templateId?: string;
      name: string;
      description: string;
      format: TemplateFormat;
      targetReport: TemplateReportTarget;
      isDefault: boolean;
      isActive: boolean;
      fileName: string;
      mimeType: string;
      binary: Buffer;
      notes: string;
      analysis: TemplateAnalysisSummary;
      actorUid: string;
      actorName: string;
    },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { template: DocumentTemplate; auditLog: AuditLog } {
    if (!fs.existsSync(this.templatesDir)) {
      fs.mkdirSync(this.templatesDir, { recursive: true });
    }

    const now = new Date().toISOString();
    const sha256 = crypto.createHash('sha256').update(params.binary).digest('hex');

    const result = this.runTransaction(() => {
      let templateId = params.templateId;
      let existingRow: Record<string, unknown> | undefined;
      if (templateId) {
        existingRow = this.db
          .prepare('SELECT * FROM document_templates WHERE id = ?')
          .get(templateId) as Record<string, unknown> | undefined;
        if (!existingRow) {
          throw this.makeHttpError(404, 'Template to version was not found.');
        }
        if (String(existingRow.format) !== params.format) {
          throw this.makeHttpError(
            400,
            `New version must match the existing template format (.${String(existingRow.format)}).`
          );
        }
      } else {
        templateId = `tpl-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      }

      const maxVerRow = this.db
        .prepare('SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM document_template_versions WHERE template_id = ?')
        .get(templateId) as { max_ver?: number };
      const nextVersion = Number(maxVerRow?.max_ver || 0) + 1;
      const versionId = `tplv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const storageFileName = `${templateId}_v${nextVersion}_${crypto.randomBytes(4).toString('hex')}.${params.format}`;
      const storagePath = path.join(this.templatesDir, storageFileName);
      fs.writeFileSync(storagePath, params.binary);

      if (params.isDefault) {
        this.db
          .prepare(
            'UPDATE document_templates SET is_default = 0 WHERE format = ? AND target_report = ? AND id != ?'
          )
          .run(params.format, params.targetReport, templateId);
      }

      if (existingRow) {
        this.db
          .prepare(
            `UPDATE document_templates
             SET name = ?, description = ?, target_report = ?, is_default = ?, is_active = ?,
                 current_version_id = ?, current_version_number = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            params.name,
            params.description,
            params.targetReport,
            params.isDefault ? 1 : 0,
            params.isActive ? 1 : 0,
            versionId,
            nextVersion,
            now,
            templateId
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO document_templates (
               id, name, description, format, target_report, is_default, is_active,
               current_version_id, current_version_number, created_by_uid, created_by_name,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            templateId,
            params.name,
            params.description,
            params.format,
            params.targetReport,
            params.isDefault ? 1 : 0,
            params.isActive ? 1 : 0,
            versionId,
            nextVersion,
            params.actorUid,
            params.actorName,
            now,
            now
          );
      }

      this.db
        .prepare(
          `INSERT INTO document_template_versions (
             id, template_id, version_number, file_name, storage_file_name, mime_type,
             file_size, sha256, notes, analysis_json, uploaded_by_uid, uploaded_by_name, uploaded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          templateId,
          nextVersion,
          params.fileName,
          storageFileName,
          params.mimeType,
          params.binary.length,
          sha256,
          params.notes,
          JSON.stringify(params.analysis),
          params.actorUid,
          params.actorName,
          now
        );

      const auditLog = this.insertAuditLogRow(auditEntry);
      return { templateId, auditLog };
    });

    const template = this.getDocumentTemplateById(result.templateId);
    if (!template) {
      throw this.makeHttpError(500, 'Saved template could not be reloaded.');
    }
    return { template, auditLog: result.auditLog };
  }

  updateDocumentTemplate(
    id: string,
    updates: {
      name?: string;
      description?: string;
      targetReport?: TemplateReportTarget;
      isDefault?: boolean;
      isActive?: boolean;
      activeVersionId?: string;
    },
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): { template: DocumentTemplate; auditLog: AuditLog } {
    const result = this.runTransaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM document_templates WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined;
      if (!existing) {
        throw this.makeHttpError(404, 'Official document template not found.');
      }

      const nextName = updates.name ?? String(existing.name);
      const nextDesc = updates.description ?? String(existing.description || '');
      const nextTarget = (updates.targetReport ?? String(existing.target_report)) as TemplateReportTarget;
      const nextActive = updates.isActive ?? Boolean(Number(existing.is_active));
      const nextDefault = nextActive ? (updates.isDefault ?? Boolean(Number(existing.is_default))) : false;
      const format = String(existing.format) as TemplateFormat;

      let nextVerId = String(existing.current_version_id);
      let nextVerNum = Number(existing.current_version_number || 1);

      if (updates.activeVersionId) {
        const verRow = this.db
          .prepare('SELECT id, version_number FROM document_template_versions WHERE id = ? AND template_id = ?')
          .get(updates.activeVersionId, id) as { id: string; version_number: number } | undefined;
        if (!verRow) {
          throw this.makeHttpError(404, 'Requested template version does not belong to this template.');
        }
        nextVerId = verRow.id;
        nextVerNum = Number(verRow.version_number);
      }

      if (nextDefault) {
        this.db
          .prepare(
            'UPDATE document_templates SET is_default = 0 WHERE format = ? AND target_report = ? AND id != ?'
          )
          .run(format, nextTarget, id);
      }

      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE document_templates
           SET name = ?, description = ?, target_report = ?, is_default = ?, is_active = ?,
               current_version_id = ?, current_version_number = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextName,
          nextDesc,
          nextTarget,
          nextDefault ? 1 : 0,
          nextActive ? 1 : 0,
          nextVerId,
          nextVerNum,
          now,
          id
        );

      const auditLog = this.insertAuditLogRow(auditEntry);
      return { auditLog };
    });

    const template = this.getDocumentTemplateById(id);
    if (!template) {
      throw this.makeHttpError(404, 'Updated template not found.');
    }
    return { template, auditLog: result.auditLog };
  }

  deleteDocumentTemplate(
    id: string,
    auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>
  ): AuditLog {
    const versionFiles = this.db
      .prepare('SELECT storage_file_name FROM document_template_versions WHERE template_id = ?')
      .all(id) as { storage_file_name: string }[];

    const auditLog = this.runTransaction(() => {
      const existing = this.db
        .prepare('SELECT id FROM document_templates WHERE id = ?')
        .get(id) as { id: string } | undefined;
      if (!existing) {
        throw this.makeHttpError(404, 'Official document template not found.');
      }
      this.db.prepare('DELETE FROM document_template_versions WHERE template_id = ?').run(id);
      this.db.prepare('DELETE FROM document_templates WHERE id = ?').run(id);
      return this.insertAuditLogRow(auditEntry);
    });

    for (const vf of versionFiles) {
      const safeName = path.basename(String(vf.storage_file_name || ''));
      if (!safeName) continue;
      const fullPath = path.join(this.templatesDir, safeName);
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // ignore best-effort disk cleanup
      }
    }
    return auditLog;
  }

  getTemplateVersionBinary(
    templateId: string,
    versionId?: string
  ): { filePath: string; fileName: string; mimeType: string; sha256: string } | null {
    const tplRow = this.db
      .prepare('SELECT current_version_id FROM document_templates WHERE id = ?')
      .get(templateId) as { current_version_id?: string } | undefined;
    if (!tplRow) return null;

    const targetVerId = versionId || tplRow.current_version_id;
    if (!targetVerId) return null;

    const verRow = this.db
      .prepare(
        'SELECT file_name, storage_file_name, mime_type, sha256 FROM document_template_versions WHERE id = ? AND template_id = ?'
      )
      .get(targetVerId, templateId) as
      | { file_name: string; storage_file_name: string; mime_type: string; sha256: string }
      | undefined;
    if (!verRow) return null;

    const safeStorageName = path.basename(String(verRow.storage_file_name));
    const resolvedPath = path.resolve(this.templatesDir, safeStorageName);
    const resolvedDir = path.resolve(this.templatesDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
      return null;
    }
    if (!fs.existsSync(resolvedPath)) return null;

    return {
      filePath: resolvedPath,
      fileName: String(verRow.file_name),
      mimeType: String(verRow.mime_type),
      sha256: String(verRow.sha256),
    };
  }

  close() {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // ignore checkpoint error during shutdown
    }
    this.db.close();
  }
}
