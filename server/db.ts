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
  Activity,
  AuditActionType,
  AuditChangeDiff,
  AuditIntegrityResult,
  AuditLog,
  AuthDirectoryUser,
  BackupInfo,
  BudgetClassification,
  DatabasePayload,
  FiscalYear,
  ImplementationStatus,
  Office,
  Program,
  ProgramSupplementalLog,
  RemarkLog,
  SystemSettings,
  UploadedDocument,
  UserAccount,
  UserRole,
} from '../src/types/ppa';
import {
  SESSION_TTL_MS,
  computeAuditEntryHash,
  hashPasscode,
  isHashedPasscode,
  verifyPasscode,
} from './security';

export interface StoredUserRow extends UserAccount {
  passcodeHash: string | null;
}

export interface BackupSnapshotPayload {
  version: number;
  createdAt: string;
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
  readonly legacyJsonPath: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.sqlitePath = path.join(dataDir, 'bula-ppa.sqlite');
    this.backupDir = path.join(dataDir, 'backups');
    this.legacyJsonPath = path.join(dataDir, 'bula-ppa-db.json');

    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });

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
        sector TEXT NOT NULL,
        budget REAL NOT NULL DEFAULT 0,
        supplemental_budget REAL NOT NULL DEFAULT 0,
        supplemental_logs_json TEXT NOT NULL DEFAULT '[]',
        physical_target REAL NOT NULL DEFAULT 0,
        monthly_physical_target_json TEXT NOT NULL DEFAULT '{}',
        source_of_fund TEXT NOT NULL DEFAULT '',
        gad_fund INTEGER NOT NULL DEFAULT 0,
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
        remarks TEXT NOT NULL DEFAULT '',
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
        ip_address TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS login_attempts (
        scope_key TEXT PRIMARY KEY,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        first_attempt_at INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_programs_fy ON programs(fiscal_year, order_index);
      CREATE INDEX IF NOT EXISTS idx_activities_prog ON activities(program_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_activities_office ON activities(office_id);
      CREATE INDEX IF NOT EXISTS idx_remarks_act ON remarks_logs(activity_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
    `);
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
    this.db
      .prepare(
        `INSERT INTO users (id, uid, email, display_name, role, office_id, office_name, position, passcode_hash, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          id, fiscal_year, aip_ref_code, title, sector, budget, supplemental_budget,
          supplemental_logs_json, physical_target, monthly_physical_target_json,
          source_of_fund, gad_fund, office_id, office_name, parent_program_id,
          order_index, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        p.id,
        p.fiscalYear,
        p.aipRefCode,
        p.title,
        p.sector || 'General Public Services',
        p.budget ?? 0,
        p.supplementalBudget ?? 0,
        JSON.stringify(p.supplementalLogs || []),
        p.physicalTarget ?? 0,
        JSON.stringify(p.monthlyPhysicalTarget || {}),
        p.sourceOfFund || '',
        p.gadFund ? 1 : 0,
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
          monthly_json, status, remarks, order_index, start_date, end_date,
          created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        a.remarks || '',
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
      sector: String(r.sector),
      budget: Number(r.budget ?? 0),
      supplementalBudget: Number(r.supplemental_budget ?? 0),
      supplementalLogs: logs,
      physicalTarget: Number(r.physical_target ?? 0),
      monthlyPhysicalTarget: monthlyPhys,
      sourceOfFund: String(r.source_of_fund || ''),
      gadFund: Boolean(r.gad_fund),
      officeId: String(r.office_id),
      officeName: String(r.office_name),
      parentProgramId: r.parent_program_id ? String(r.parent_program_id) : null,
      orderIndex: Number(r.order_index ?? 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private mapActivityRow(r: Record<string, unknown>): Activity {
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
      remarks: String(r.remarks || ''),
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

  getAuthDirectory(): {
    users: AuthDirectoryUser[];
    offices: Office[];
    branding: { appName: string; appLogoDataUrl: string; municipalityName: string };
  } {
    const users = (
      this.db
        .prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY rowid ASC')
        .all() as Record<string, unknown>[]
    ).map((r) => {
      const u = this.mapUserRow(r, false);
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
      };
    });
    const settings = this.getSettings();
    return {
      users,
      offices: this.getOffices(),
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

  getScopedDatabasePayload(actingUser: UserAccount): DatabasePayload {
    const offices = this.getOffices();
    const fiscalYears = this.getFiscalYears();
    const settings = this.getSettings();
    const allUsers = this.getUsers();
    const allPrograms = this.getPrograms();
    const allActivities = this.getActivities();
    const allRemarks = this.getRemarks();
    const uploadedDocuments = this.getUploadedDocuments();
    const allAuditLogs = this.getAuditLogs(1000);

    if (actingUser.role === 'ENCODER' && actingUser.officeId) {
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
      // Do not send full directory of other users' accounts to ENCODER; keep only own account & office co-encoders
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
      };
    }

    return {
      users: actingUser.role === 'ADMINISTRATOR' ? allUsers : allUsers.filter((u) => u.id === actingUser.id),
      offices,
      fiscalYears,
      programs: allPrograms,
      activities: allActivities,
      remarksLogs: allRemarks,
      uploadedDocuments,
      auditLogs: actingUser.role === 'ADMINISTRATOR' ? allAuditLogs : allAuditLogs.slice(0, 100),
      settings,
      officeAccountsProvisioned: true,
    };
  }

  // Session Management & Login Rate Limiting
  createSession(userId: string, ipAddress: string, userAgent: string): string {
    const sessionId = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, expires_at, created_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        userId,
        expiresAt,
        new Date(now).toISOString(),
        ipAddress.slice(0, 64),
        userAgent.slice(0, 200)
      );
    return sessionId;
  }

  getSessionUser(sessionId: string): UserAccount | null {
    const row = this.db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
      .get(sessionId) as { user_id: string; expires_at: number } | undefined;
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return null;
    }
    const storedUser = this.getUserByIdWithHash(row.user_id);
    if (!storedUser || !storedUser.isActive) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return null;
    }
    return this.sanitizePublicUser(storedUser);
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
    if (!user.passcodeHash) return true;
    const valid = verifyPasscode(candidatePasscode, user.passcodeHash);
    // Transparently upgrade any non-scrypt hash if encountered
    if (valid && !isHashedPasscode(user.passcodeHash)) {
      const upgraded = hashPasscode(candidatePasscode);
      this.db.prepare('UPDATE users SET passcode_hash = ? WHERE id = ?').run(upgraded, user.id);
    }
    return valid;
  }

  // Transactional Mutations
  createProgram(p: Program, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.insertProgramStmt(p);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  updateProgram(p: Program, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.db
        .prepare(
          `UPDATE programs SET
            fiscal_year = ?, aip_ref_code = ?, title = ?, sector = ?,
            budget = ?, supplemental_budget = ?, supplemental_logs_json = ?,
            physical_target = ?, monthly_physical_target_json = ?,
            source_of_fund = ?, gad_fund = ?, office_id = ?, office_name = ?,
            parent_program_id = ?, order_index = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          p.fiscalYear,
          p.aipRefCode,
          p.title,
          p.sector,
          p.budget ?? 0,
          p.supplementalBudget ?? 0,
          JSON.stringify(p.supplementalLogs || []),
          p.physicalTarget ?? 0,
          JSON.stringify(p.monthlyPhysicalTarget || {}),
          p.sourceOfFund || '',
          p.gadFund ? 1 : 0,
          p.officeId,
          p.officeName,
          p.parentProgramId ?? null,
          p.orderIndex ?? 0,
          p.updatedAt,
          p.id
        );
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
      this.insertActivityStmt(a);
      return this.insertAuditLogRow(auditEntry);
    });
  }

  updateActivity(a: Activity, auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): AuditLog {
    return this.runTransaction(() => {
      this.db
        .prepare(
          `UPDATE activities SET
            program_id = ?, subprogram_id = ?, fiscal_year = ?, reference_number = ?,
            description = ?, target_outputs = ?, office_id = ?, office_name = ?,
            source_of_fund = ?, budget_classification = ?,
            gf = ?, ps = ?, mooe = ?, co = ?, withheld_amount = ?,
            supplemental_budget_1 = ?, supplemental_budget_2 = ?, supplemental_budget_3 = ?,
            supplemental_budget_4 = ?, supplemental_budget_5 = ?,
            monthly_json = ?, status = ?, remarks = ?, order_index = ?,
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
          a.remarks || '',
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
      if (!existing) throw new Error('User not found.');
      let nextHash = existing.passcodeHash;
      if (options.clearPasscode) {
        nextHash = null;
      } else if (options.rawPasscode && options.rawPasscode.trim()) {
        nextHash = hashPasscode(options.rawPasscode.trim());
      }

      this.db
        .prepare(
          `UPDATE users SET
            email = ?, display_name = ?, role = ?, office_id = ?, office_name = ?,
            position = ?, passcode_hash = ?, is_active = ?, updated_at = ?
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
          user.updatedAt,
          user.id
        );

      // Invalidate existing sessions if user was deactivated or role/office changed
      if (!user.isActive || existing.role !== user.role || existing.officeId !== user.officeId) {
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

  // Backup Snapshots & Atomic Restore
  buildSnapshot(): BackupSnapshotPayload {
    const rawUsers = (
      this.db.prepare('SELECT * FROM users ORDER BY rowid ASC').all() as Record<string, unknown>[]
    ).map((r) => {
      const u = this.mapUserRow(r, true);
      const { passcodeHash, passcode: _p, clearPasscode: _c, hasPasscode: _h, ...rest } = u;
      return { ...rest, passcodeHash };
    });

    return {
      version: 1,
      createdAt: new Date().toISOString(),
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

  createBackupSnapshot(auditEntry: Omit<AuditLog, 'prevHash' | 'entryHash'>): {
    backup: BackupInfo;
    auditLog: AuditLog;
  } {
    const snapshot = this.buildSnapshot();
    const stamp = snapshot.createdAt.replace(/[:.]/g, '-');
    const fileName = `bula-ppa-backup-${stamp}.json`;
    const targetPath = path.join(this.backupDir, fileName);
    const jsonStr = JSON.stringify(snapshot, null, 2);
    fs.writeFileSync(targetPath, jsonStr, 'utf-8');

    const auditLog = this.runTransaction(() => this.insertAuditLogRow(auditEntry));
    return {
      backup: {
        fileName,
        createdAt: snapshot.createdAt,
        sizeBytes: Buffer.byteLength(jsonStr, 'utf-8'),
        programCount: snapshot.programs.length,
        activityCount: snapshot.activities.length,
      },
      auditLog,
    };
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
        const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Partial<BackupSnapshotPayload>;
        list.push({
          fileName,
          createdAt: parsed.createdAt || stat.mtime.toISOString(),
          sizeBytes: stat.size,
          programCount: Array.isArray(parsed.programs) ? parsed.programs.length : 0,
          activityCount: Array.isArray(parsed.activities) ? parsed.activities.length : 0,
        });
      } catch {
        // skip corrupted backup entry
      }
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
}
