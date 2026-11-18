import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import type { Activity, AuditChangeDiff, Program } from '../src/types/ppa';
import { MONTHS } from '../src/utils/calculations';

export const SESSION_COOKIE_NAME = 'bula_ppa_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

let cachedSessionSecret: string | null = null;

export function getSessionSecret(dataDir: string): string {
  if (cachedSessionSecret) return cachedSessionSecret;
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 32) {
    cachedSessionSecret = envSecret;
    return cachedSessionSecret;
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const secretFile = path.join(dataDir, '.session-secret');
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, 'utf-8').trim();
    if (existing.length >= 32) {
      cachedSessionSecret = existing;
      return cachedSessionSecret;
    }
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  cachedSessionSecret = generated;
  return cachedSessionSecret;
}

// Scrypt Passcode Hashing
const SCRYPT_PREFIX = 'scrypt$';

export function hashPasscode(passcode: string): string {
  const normalized = passcode.trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(normalized, salt, 64).toString('hex');
  return `${SCRYPT_PREFIX}${salt}$${derived}`;
}

export function isHashedPasscode(stored?: string | null): boolean {
  return typeof stored === 'string' && stored.startsWith(SCRYPT_PREFIX);
}

export function verifyPasscode(candidate: string, storedHash?: string | null): boolean {
  if (!storedHash) return true;
  if (!isHashedPasscode(storedHash)) {
    // Fallback for any unmigrated literal value, constant-time compare
    const a = Buffer.from(candidate);
    const b = Buffer.from(storedHash);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const expected = Buffer.from(hexHash, 'hex');
    const derived = crypto.scryptSync(candidate, salt, 64);
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

// Signed Session Cookie Helpers
export function signSessionToken(sessionId: string, secret: string): string {
  const mac = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${mac}`;
}

export function verifySignedSessionToken(token: string, secret: string): string | null {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const sessionId = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);
  if (!sessionId || !sigHex || !/^[a-f0-9]+$/i.test(sigHex)) return null;
  const expectedHex = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  const a = Buffer.from(sigHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  const forwardedSsl = req.headers['x-forwarded-ssl'];
  if (typeof forwardedSsl === 'string' && forwardedSsl.trim().toLowerCase() === 'on') {
    return true;
  }
  if (req.secure || req.protocol === 'https') return true;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('https://')) return true;
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.startsWith('https://')) return true;
  return false;
}

export function setSessionCookie(res: Response, req: Request, signedToken: string) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const secure = isSecureRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(signedToken)}`,
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) {
    parts.push('Secure', 'Partitioned');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response, req: Request) {
  const secure = isSecureRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure', 'Partitioned');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

// Tamper-Evident Audit Hash Chain
export function computeAuditEntryHash(params: {
  prevHash: string;
  id: string;
  timestamp: string;
  userUid: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  details: string;
  changes: AuditChangeDiff[];
}): string {
  const canonical = [
    params.prevHash,
    params.id,
    params.timestamp,
    params.userUid,
    params.action,
    params.entityType,
    params.entityId,
    params.summary,
    params.details,
    JSON.stringify(params.changes || []),
  ].join('|');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// Logo Image Magic-Byte Validation & Strict SVG Sanitization
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function validateAndSanitizeLogoDataUrl(
  input: string
): { ok: true; dataUrl: string } | { ok: false; error: string } {
  const candidate = input.trim();
  if (!candidate) {
    return { ok: true, dataUrl: '' };
  }

  const match = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i.exec(
    candidate
  );
  if (!match) {
    return {
      ok: false,
      error: 'Invalid logo data URL. Allowed formats: PNG, JPG, WEBP, or SVG.',
    };
  }

  const mime = match[1].toLowerCase();
  const base64Body = match[2];
  let buf: Buffer;
  try {
    buf = Buffer.from(base64Body, 'base64');
  } catch {
    return { ok: false, error: 'Malformed base64 image payload.' };
  }

  if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) {
    return { ok: false, error: 'Logo image must be between 1 byte and 2 MB.' };
  }

  if (mime === 'png') {
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(pngSig)) {
      return { ok: false, error: 'Uploaded file header does not match PNG format.' };
    }
    return { ok: true, dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
  }

  if (mime === 'jpeg' || mime === 'jpg') {
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return { ok: false, error: 'Uploaded file header does not match JPEG format.' };
    }
    return { ok: true, dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` };
  }

  if (mime === 'webp') {
    if (
      buf.length < 12 ||
      buf.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      buf.subarray(8, 12).toString('ascii') !== 'WEBP'
    ) {
      return { ok: false, error: 'Uploaded file header does not match WEBP format.' };
    }
    return { ok: true, dataUrl: `data:image/webp;base64,${buf.toString('base64')}` };
  }

  // SVG sanitization: strip active scripting elements, event handlers, foreignObject, external refs
  let svgText = buf.toString('utf8');
  if (!/<svg[\s>]/i.test(svgText)) {
    return { ok: false, error: 'Invalid SVG file: missing root <svg> element.' };
  }

  // Reject or strip dangerous tags & constructs
  svgText = svgText
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<foreignObject\b[^>]*\/?>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe\b[^>]*\/?>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/<handler\b[^>]*>[\s\S]*?<\/handler>/gi, '')
    .replace(/<set\b[^>]*\bon\w+\b[^>]*\/?>/gi, '')
    // Strip inline JS event handlers on*="..." / '...' / unquoted
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Strip javascript:, vbscript:, data:text/html URIs in href/xlink:href/src
    .replace(
      /\s+(?:xlink:)?(?:href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|vbscript|data:text\/html)[^"]*"|'\s*(?:javascript|vbscript|data:text\/html)[^']*')/gi,
      ''
    )
    // Strip external http(s) references in <use href="..."> / <image href="...">
    .replace(
      /\s+(?:xlink:)?href\s*=\s*(?:"\s*https?:[^"]*"|'\s*https?:[^']*')/gi,
      ''
    )
    // Neutralize url(javascript:...) or @import in style attributes / <style> blocks
    .replace(/@import\b[^;]*;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');

  if (!/<svg[\s>]/i.test(svgText)) {
    return { ok: false, error: 'Sanitized SVG is invalid.' };
  }

  const sanitizedB64 = Buffer.from(svgText, 'utf8').toString('base64');
  return { ok: true, dataUrl: `data:image/svg+xml;base64,${sanitizedB64}` };
}

// Spreadsheet Formula Injection Sanitization (server-side defense-in-depth)
export function sanitizeSpreadsheetText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    // Preserve signed negative numbers if pure numeric, otherwise neutralize leading formula char
    if (/^-\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    return `'${trimmed}`;
  }
  return trimmed;
}

// Program & Activity Change Diff Builders
function fmtVal(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
  const s = String(val).trim();
  return s === '' ? '—' : s;
}

export function computeProgramDiff(before: Program, after: Program): AuditChangeDiff[] {
  const diffs: AuditChangeDiff[] = [];
  const check = (label: string, oldVal: unknown, newVal: unknown) => {
    const a = fmtVal(oldVal);
    const b = fmtVal(newVal);
    if (a !== b) diffs.push({ field: label, before: a, after: b });
  };

  check('AIP Ref Code', before.aipRefCode, after.aipRefCode);
  check('Program Title', before.title, after.title);
  check('Sector', before.sector, after.sector);
  check('Base Budget', before.budget ?? 0, after.budget ?? 0);
  check('Net Supplemental Budget', before.supplementalBudget ?? 0, after.supplementalBudget ?? 0);
  check('Source of Fund', before.sourceOfFund || '', after.sourceOfFund || '');
  check('GAD Fund', Boolean(before.gadFund), Boolean(after.gadFund));
  check('Implementing Office', before.officeName, after.officeName);
  return diffs;
}

export function computeActivityDiff(before: Activity, after: Activity): AuditChangeDiff[] {
  const diffs: AuditChangeDiff[] = [];
  const check = (label: string, oldVal: unknown, newVal: unknown) => {
    const a = fmtVal(oldVal);
    const b = fmtVal(newVal);
    if (a !== b) diffs.push({ field: label, before: a, after: b });
  };

  check('Ref Code', before.referenceNumber, after.referenceNumber);
  check('Description / Target Outputs', before.description, after.description);
  check('Actual Output', before.targetOutputs, after.targetOutputs);
  check('Implementing Office', before.officeName, after.officeName);
  check('Source of Fund', before.sourceOfFund || '', after.sourceOfFund || '');
  check('Classification', before.budgetClassification, after.budgetClassification);
  check('GF Budget', before.gf ?? 0, after.gf ?? 0);
  check('PS Budget', before.ps, after.ps);
  check('MOOE Budget', before.mooe, after.mooe);
  check('CO Budget', before.co, after.co);
  check('Withheld Amount', before.withheldAmount, after.withheldAmount);
  check('Status', before.status, after.status);
  check('Remarks', before.remarks, after.remarks);
  check('Start Date', before.startDate || '', after.startDate || '');
  check('End Date', before.endDate || '', after.endDate || '');

  for (const m of MONTHS) {
    const bm = before.monthly?.[m.key];
    const am = after.monthly?.[m.key];
    if (!bm || !am) continue;
    if (bm.physicalTarget !== am.physicalTarget) {
      check(`${m.short} Physical Target`, bm.physicalTarget, am.physicalTarget);
    }
    if (bm.financialTarget !== am.financialTarget) {
      check(`${m.short} Financial Target`, bm.financialTarget, am.financialTarget);
    }
    if (bm.physicalActual !== am.physicalActual) {
      check(`${m.short} Physical Actual`, bm.physicalActual, am.physicalActual);
    }
    if (bm.financialActual !== am.financialActual) {
      check(`${m.short} Financial Actual`, bm.financialActual, am.financialActual);
    }
  }

  return diffs;
}

// Firebase ID Token Verifier via Google Public x509 Certificates (no firebase-admin required)
interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}
let certCache: CertCache | null = null;

async function getGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() < certCache.expiresAt) {
    return certCache.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error('Unable to fetch Firebase public signing certificates.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cc = resp.headers.get('cache-control') || '';
  const maxAgeMatch = /max-age=(\d+)/.exec(cc);
  const ttlSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  certCache = {
    certs,
    expiresAt: Date.now() + Math.max(60, ttlSec) * 1000,
  };
  return certs;
}

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  expectedProjectId: string
): Promise<VerifiedFirebaseToken> {
  if (!expectedProjectId) {
    throw new Error('Firebase Project ID is not configured on the server.');
  }
  const segments = idToken.split('.');
  if (segments.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = segments;
  const decodeJson = (b64u: string) => {
    const padded = b64u.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  };

  const header = decodeJson(headerB64) as { alg?: string; kid?: string };
  const payload = decodeJson(payloadB64) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid Firebase token algorithm or key identifier.');
  }

  const certs = await getGoogleSecureTokenCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error('Unrecognized Firebase signing key.');
  }

  const sigBuf = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(certPem, sigBuf)) {
    throw new Error('Firebase ID token signature verification failed.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== expectedProjectId) {
    throw new Error('Firebase ID token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
    throw new Error('Firebase ID token issuer mismatch.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Firebase ID token missing subject.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at claim is invalid.');
  }
  if (!payload.email || typeof payload.email !== 'string') {
    throw new Error('Firebase ID token does not contain an email address.');
  }

  return {
    uid: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    name: payload.name,
  };
}
