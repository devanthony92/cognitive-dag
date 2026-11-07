import { normalizeIpLiteral } from './address.js';

/** Entries the allowlist of an organization may hold (research R9.7). */
export const HTTP_ALLOWED_HOSTS_MAX = 100;

export type AllowlistEntryResult = { ok: true; pattern: string } | { ok: false; reason: string };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_MAX_LENGTH = 253;

/** A name with at least two labels whose last one is not a number (so never an IP in disguise). */
function validHostName(host: string): boolean {
  if (host.length === 0 || host.length > HOST_MAX_LENGTH) return false;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false;
  return /[a-z]/.test(labels[labels.length - 1] ?? '');
}

/**
 * Checks one allowlist entry: an exact host or `*.domain`, in lower case, with no IP literal, scheme,
 * port or path (research R9.7). The wildcard stands for subdomains only and needs a registrable
 * base of at least two labels, so `*.com` is not an entry.
 */
export function validateAllowlistEntry(entry: string): AllowlistEntryResult {
  const reject = (reason: string): AllowlistEntryResult => ({ ok: false, reason });
  if (entry.length === 0) return reject('La entrada está vacía.');
  if (entry !== entry.toLowerCase()) return reject('Debe estar en minúsculas.');
  if (/[/:@?#\s[\]]/.test(entry)) {
    return reject('Debe ser solo un dominio, sin esquema, puerto, ruta ni usuario.');
  }
  const wildcard = entry.startsWith('*.');
  const host = wildcard ? entry.slice(2) : entry;
  if (host.includes('*')) return reject('El comodín solo puede ir al inicio, como «*.dominio».');
  if (normalizeIpLiteral(host) !== undefined) return reject('No se admiten direcciones IP.');
  if (!validHostName(host)) return reject('No es un nombre de dominio válido.');
  return { ok: true, pattern: entry };
}

function bareHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * True when the host may be called under the allowlist of the organization. An empty list restricts
 * nothing; a non-empty list admits exact hosts and subdomains of `*.domain` entries, never IPs.
 */
export function isHostAllowed(host: string, entries: readonly string[]): boolean {
  if (entries.length === 0) return true;
  const name = bareHost(host);
  if (normalizeIpLiteral(name) !== undefined) return false;
  return entries.some((entry) =>
    entry.startsWith('*.')
      ? name.length > entry.length - 1 && name.endsWith(entry.slice(1))
      : name === entry,
  );
}
