/**
 * A privacy-safe outline of a JSON file's STRUCTURE: field names and value types only. Numbers
 * become "number", text becomes "text" (so no measurements, positions, identifiers, names or
 * device details appear), and long lists are summarised by their length and first item.
 *
 * Used when a scan file isn't recognised, so the person can share how the file is laid out
 * (to get an adapter written) without sharing the scan itself.
 */

const MAX_DEPTH = 7;
const MAX_KEYS = 40;
const MAX_LENGTH = 6000;

export function describeShape(data: unknown): string {
  const lines: string[] = [];
  walk(data, 0, '', lines);
  const text = lines.join('\n');
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}\n…` : text;
}

function kind(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `list(${v.length})`;
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'boolean') return 'true/false';
  return typeof v === 'object' ? 'object' : 'other';
}

/** Keys are shown only when they look like field names, never like data (ids, free text). */
function safeKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,40}$/.test(key) && !/^[0-9a-f]{8}-/i.test(key) ? key : '‹key›';
}

function walk(v: unknown, depth: number, prefix: string, lines: string[]) {
  const pad = '  '.repeat(depth);
  if (depth > MAX_DEPTH) {
    lines.push(`${pad}${prefix}…`);
    return;
  }
  if (Array.isArray(v)) {
    const allNumbers = v.length > 0 && v.every((x) => typeof x === 'number');
    if (allNumbers || v.length === 0) {
      lines.push(`${pad}${prefix}${kind(v)}${allNumbers ? ' of numbers' : ''}`);
      return;
    }
    lines.push(`${pad}${prefix}${kind(v)}, first item:`);
    walk(v[0], depth + 1, '', lines);
    return;
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 0) {
      lines.push(`${pad}${prefix}{}`);
      return;
    }
    lines.push(`${pad}${prefix}{`);
    for (const key of keys.slice(0, MAX_KEYS)) walk((v as Record<string, unknown>)[key], depth + 1, `${safeKey(key)}: `, lines);
    if (keys.length > MAX_KEYS) lines.push(`${pad}  … ${keys.length - MAX_KEYS} more fields`);
    lines.push(`${pad}}`);
    return;
  }
  lines.push(`${pad}${prefix}${kind(v)}`);
}
