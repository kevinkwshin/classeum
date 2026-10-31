/**
 * Rows as CSV that Korean Excel opens as UTF-8 (with a BOM). Excel runs a cell starting with = + - @ (or a tab or a
 * return) as a formula, and a name on a pasted roster or a student's answer can start with one, so a leading ' keeps
 * such a cell plain text. Numbers are left as they are.
 */
export function csvText(rows: unknown[][]): string {
  const esc = (v: unknown) => {
    let t = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
