/**
 * Redaction helpers.
 *
 * Committed output and terminal logs must not carry customer identity. These
 * produce stable, non-reversible labels so the same customer reads as the same
 * token across a report without the report naming them.
 */

import { createHash } from 'node:crypto';

/** Short stable token for correlating rows without naming anyone. */
export function token(value: string): string {
  if (value.trim() === '') return 'none';
  return createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, 8);
}

/** `a****@e******.com` — enough to recognise a typo, not enough to contact. */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const stem = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}${'*'.repeat(Math.max(1, local.length - 1))}@${stem[0]}${'*'.repeat(Math.max(1, stem.length - 1))}${tld}`;
}

/** Keeps the outward postcode only: `PL7 1AG` -> `PL7`. */
export function maskPostcode(value: string): string {
  const outward = value.trim().split(/\s+/)[0];
  return outward ? outward.toUpperCase() : '***';
}

/** `Smith` -> `S****`. */
export function maskName(value: string): string {
  const v = value.trim();
  if (v === '') return '***';
  return `${v[0]}${'*'.repeat(Math.max(1, v.length - 1))}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}

/** Replaces anything that looks like contact detail inside free text. */
export function scrubFreeText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b(?:\+44|0)\d[\d\s-]{7,}\b/g, '<phone>')
    .replace(/https?:\/\/\S+/gi, '<url>');
}
