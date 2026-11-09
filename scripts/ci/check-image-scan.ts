/**
 * Release gate (F9, D11C): reads a Grype JSON report and fails when it holds a high or critical
 * finding that has a fix available and no live exception. Exceptions live in a versioned file;
 * each one names its reason, owner and date, and stops applying on its expiry date.
 *
 * Usage: node scripts/ci/check-image-scan.ts <grype-report.json> [exceptions.json]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface ScanException {
  /** Vulnerability id, e.g. a CVE. */
  id: string;
  /** Optional package name; without it the exception covers every package with that id. */
  package?: string;
  reason: string;
  owner: string;
  /** Day the exception was added (YYYY-MM-DD). */
  date: string;
  /** First day the exception no longer applies (YYYY-MM-DD). */
  expires: string;
}

export interface Finding {
  id: string;
  severity: string;
  package: string;
  version: string;
  fixedIn: string[];
}

export interface ScanResult {
  blocking: Finding[];
  excepted: Finding[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where}: "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function day(value: unknown, field: string, where: string): string {
  const raw = text(value, field, where);
  if (!DAY.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new Error(`${where}: "${field}" must be a date as YYYY-MM-DD.`);
  }
  return raw;
}

export function parseExceptions(source: string): ScanException[] {
  const data: unknown = JSON.parse(source);
  if (!Array.isArray(data)) throw new Error('The exceptions file must be a JSON array.');
  const seen = new Set<string>();
  return data.map((entry: unknown, index) => {
    const where = `exceptions[${index}]`;
    if (!isRecord(entry)) throw new Error(`${where}: must be an object.`);
    const id = text(entry.id, 'id', where);
    const parsed: ScanException = {
      id,
      reason: text(entry.reason, 'reason', where),
      owner: text(entry.owner, 'owner', where),
      date: day(entry.date, 'date', where),
      expires: day(entry.expires, 'expires', where),
    };
    if (entry.package !== undefined) parsed.package = text(entry.package, 'package', where);
    if (parsed.expires <= parsed.date) {
      throw new Error(`${where}: "expires" must be after "date".`);
    }
    const key = `${id}|${parsed.package ?? ''}`;
    if (seen.has(key)) throw new Error(`${where}: duplicate exception for ${key}.`);
    seen.add(key);
    return parsed;
  });
}

function toFinding(match: unknown): Finding | null {
  if (!isRecord(match) || !isRecord(match.vulnerability) || !isRecord(match.artifact)) return null;
  const vulnerability = match.vulnerability;
  const fix = isRecord(vulnerability.fix) ? vulnerability.fix : {};
  if (fix.state !== 'fixed') return null;
  const severity = typeof vulnerability.severity === 'string' ? vulnerability.severity : '';
  if (!BLOCKING_SEVERITIES.has(severity.toLowerCase())) return null;
  const versions = Array.isArray(fix.versions) ? fix.versions : [];
  return {
    id: typeof vulnerability.id === 'string' ? vulnerability.id : 'unknown',
    severity,
    package: typeof match.artifact.name === 'string' ? match.artifact.name : 'unknown',
    version: typeof match.artifact.version === 'string' ? match.artifact.version : 'unknown',
    fixedIn: versions.filter((version): version is string => typeof version === 'string'),
  };
}

export function evaluateScan(
  report: unknown,
  exceptions: readonly ScanException[],
  now: Date,
): ScanResult {
  if (!isRecord(report) || !Array.isArray(report.matches)) {
    throw new Error('Not a Grype report: the "matches" array is missing.');
  }
  const today = now.toISOString().slice(0, 10);
  const live = exceptions.filter((item) => item.expires > today);
  const result: ScanResult = { blocking: [], excepted: [] };
  for (const match of report.matches) {
    const finding = toFinding(match);
    if (!finding) continue;
    const covered = live.some(
      (item) =>
        item.id === finding.id && (item.package === undefined || item.package === finding.package),
    );
    (covered ? result.excepted : result.blocking).push(finding);
  }
  return result;
}

function describeFinding(finding: Finding): string {
  const fix = finding.fixedIn.length > 0 ? ` (fixed in ${finding.fixedIn.join(', ')})` : '';
  return `${finding.severity} ${finding.id} ${finding.package}@${finding.version}${fix}`;
}

function main(argv: string[]): number {
  const [reportPath, exceptionsPath] = argv;
  if (!reportPath) {
    console.error('Usage: check-image-scan.ts <grype-report.json> [exceptions.json]');
    return 2;
  }
  const exceptions = exceptionsPath ? parseExceptions(readFileSync(exceptionsPath, 'utf8')) : [];
  const result = evaluateScan(JSON.parse(readFileSync(reportPath, 'utf8')), exceptions, new Date());
  for (const finding of result.excepted) console.log(`excepted: ${describeFinding(finding)}`);
  for (const finding of result.blocking) console.error(`blocking: ${describeFinding(finding)}`);
  if (result.blocking.length > 0) {
    console.error(
      `${result.blocking.length} high or critical finding(s) with a fix: publication blocked.`,
    );
    return 1;
  }
  console.log('No high or critical finding with an available fix.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
