export function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return '""';
  const str = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!str) return '""';
  const isSignedNumeric = /^-\d+(\.\d+)?$/.test(str);
  const safe =
    !isSignedNumeric && /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsvBlob(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
): Blob {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const bodyLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  const content = '\uFEFF' + [headerLine, ...bodyLines].join('\r\n');
  return new Blob([content], { type: 'text/csv;charset=utf-8;' });
}

export function sanitizeCsvFileSegment(raw: string): string {
  return (raw || 'export')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'export';
}
