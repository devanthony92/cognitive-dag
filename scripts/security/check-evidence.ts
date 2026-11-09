import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

/**
 * F8 (FR-001, FR-002, SC-003, SC-008): checks `docs/security/owasp-evidence.md` and
 * `docs/threat-model.md` without network access.
 *
 * - Every backticked file path and relative link must exist (a bare file name may be anywhere in
 *   the repository).
 * - The matrix has one row per OWASP risk (LLM01-LLM10 and A01-A10), each with a state from a
 *   closed vocabulary; the threat model uses the same vocabulary.
 * - `verified` cites evidence, `accepted` names a reason, an owner and a review phase, `deferred:F9`
 *   names the requirement and `not-applicable` names what would activate it.
 * - No `planned:F4` or `planned:F8` survives, because those phases are closed.
 */
export const MATRIX_FILE = 'docs/security/owasp-evidence.md';
export const THREAT_MODEL_FILE = 'docs/threat-model.md';

export const STATES = ['verified', 'accepted', 'deferred:F9', 'not-applicable'] as const;
const THREAT_MODEL_STATES = ['mitigated', 'accepted', 'deferred:F9', 'not-applicable'] as const;

const RISK_IDS = [
  ...Array.from({ length: 10 }, (_, index) => `LLM${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
];

const FORBIDDEN_STATES = /planned:(?:F[48]\b|<)/g;
const FILE_TOKEN =
  /^(?:[\w.@-]+\/)*[\w.@-]+\.(?:ts|tsx|mts|md|json|ya?ml|sh|py|tsv|sql|toml)$|^(?:apps|packages|scripts|docs|specs|infra|\.github|\.zap)\/[\w./@-]+$/;
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  'coverage',
  '.vite',
]);

export interface CheckOptions {
  root: string;
  matrixFile?: string;
  threatModelFile?: string;
}

export interface CheckResult {
  errors: string[];
  /** Rows of the matrix that carry one of the 20 risk ids. */
  rows: number;
}

interface Table {
  header: string[];
  rows: Array<{ line: number; cells: string[] }>;
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && line[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  // A closing pipe leaves an empty remainder that is not a cell; an empty cell before it is.
  if (current.trim() !== '' || !line.trimEnd().endsWith('|')) cells.push(current.trim());
  if (cells[0] === '') cells.shift();
  return cells;
}

function parseTables(text: string): Table[] {
  const lines = text.split(/\r?\n/);
  const tables: Table[] = [];
  let index = 0;
  while (index < lines.length) {
    const separator = lines[index + 1] ?? '';
    if (lines[index]?.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test(separator)) {
      const table: Table = { header: splitRow(lines[index] ?? ''), rows: [] };
      index += 2;
      while (index < lines.length && lines[index]?.startsWith('|')) {
        table.rows.push({ line: index + 1, cells: splitRow(lines[index] ?? '') });
        index += 1;
      }
      tables.push(table);
    } else {
      index += 1;
    }
  }
  return tables;
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? '');
}

function stripCode(cell: string): string {
  return cell.replaceAll('`', '').trim();
}

function indexByName(root: string): Set<string> {
  const names = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (IGNORED_DIRECTORIES.has(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else names.add(entry);
    }
  };
  walk(root);
  return names;
}

function pathsCited(text: string): string[] {
  const found = new Set<string>();
  for (const token of backticked(text)) {
    if (/[\s*<>{}]/.test(token)) continue;
    if (FILE_TOKEN.test(token)) found.add(token);
  }
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = (match[1] ?? '').split('#')[0] ?? '';
    if (target && !/^[a-z]+:/i.test(target)) found.add(target);
  }
  return [...found];
}

function checkPaths(root: string, file: string, text: string, names: () => Set<string>): string[] {
  const errors: string[] = [];
  const directory = dirname(join(root, file));
  for (const token of pathsCited(text)) {
    const candidates = token.includes('/')
      ? [resolve(root, token), resolve(directory, token)]
      : [resolve(root, token)];
    if (candidates.some((candidate) => existsSync(candidate))) continue;
    if (!token.includes('/') && names().has(basename(token))) continue;
    errors.push(`${file}: la ruta citada no existe: ${token}`);
  }
  return errors;
}

function checkForbidden(file: string, text: string): string[] {
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(FORBIDDEN_STATES)) {
      errors.push(`${file}:${index + 1}: estado ${match[0]} no permitido (fase cerrada)`);
    }
  });
  return errors;
}

/** Rules each state imposes on the text of its row. */
function checkStateRules(
  label: string,
  state: string,
  rowText: string,
  evidence: string,
): string[] {
  const errors: string[] = [];
  if (state === 'verified' && backticked(evidence).length === 0) {
    errors.push(`${label}: \`verified\` sin evidencia (comando o prueba entre comillas inversas)`);
  }
  if (state === 'accepted' && !(/Dueño:/.test(rowText) && /Revisión:/.test(rowText))) {
    errors.push(`${label}: \`accepted\` sin "Dueño:" y "Revisión:"`);
  }
  if (state === 'deferred:F9' && !/Requisito/.test(rowText)) {
    errors.push(`${label}: \`deferred:F9\` sin "Requisito"`);
  }
  if (state === 'not-applicable' && !/Activaría:/.test(rowText)) {
    errors.push(`${label}: \`not-applicable\` sin "Activaría:"`);
  }
  return errors;
}

function checkMatrix(file: string, text: string): { errors: string[]; rows: number } {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const table of parseTables(text)) {
    const stateColumn = table.header.findIndex((cell) => cell.toLowerCase() === 'estado');
    const evidenceColumn = table.header.findIndex((cell) => /^evidencia/i.test(cell));
    if (stateColumn < 0) continue;
    for (const row of table.rows) {
      const id = /^(LLM(?:0[1-9]|10)|A(?:0[1-9]|10))\b/.exec(stripCode(row.cells[0] ?? ''))?.[1];
      if (!id) continue;
      const label = `${file}:${row.line} ${id}`;
      seen.set(id, (seen.get(id) ?? 0) + 1);
      if (row.cells.length !== table.header.length) {
        errors.push(`${label}: ${row.cells.length} celdas, se esperaban ${table.header.length}`);
        continue;
      }
      const states = stripCode(row.cells[stateColumn] ?? '')
        .split(/\s*\+\s*/)
        .filter(Boolean);
      if (states.length === 0) errors.push(`${label}: fila sin estado`);
      for (const state of states) {
        if (!(STATES as readonly string[]).includes(state)) {
          errors.push(`${label}: estado fuera del vocabulario: ${state}`);
          continue;
        }
        errors.push(
          ...checkStateRules(label, state, row.cells.join(' | '), row.cells[evidenceColumn] ?? ''),
        );
      }
    }
  }
  for (const id of RISK_IDS) {
    const count = seen.get(id) ?? 0;
    if (count === 0) errors.push(`${file}: falta la fila ${id}`);
    if (count > 1) errors.push(`${file}: la fila ${id} aparece ${count} veces`);
  }
  return { errors, rows: RISK_IDS.filter((id) => seen.has(id)).length };
}

function checkThreatModel(file: string, text: string): string[] {
  const errors: string[] = [];
  for (const table of parseTables(text)) {
    const stateColumn = table.header.findIndex((cell) => cell.toLowerCase() === 'estado');
    // The legend table lists the states themselves in its first column.
    if (stateColumn <= 0) continue;
    const evidenceColumn = table.header.length - 1;
    for (const row of table.rows) {
      const label = `${file}:${row.line}`;
      if (row.cells.length !== table.header.length) {
        errors.push(`${label}: ${row.cells.length} celdas, se esperaban ${table.header.length}`);
        continue;
      }
      const state = stripCode(row.cells[stateColumn] ?? '');
      if (!(THREAT_MODEL_STATES as readonly string[]).includes(state)) {
        errors.push(`${label}: estado fuera del vocabulario: ${state || '(vacío)'}`);
        continue;
      }
      errors.push(
        ...checkStateRules(
          label,
          state === 'mitigated' ? 'verified' : state,
          row.cells.join(' | '),
          row.cells[evidenceColumn] ?? '',
        ),
      );
    }
  }
  return errors;
}

export function checkEvidence(options: CheckOptions): CheckResult {
  const root = options.root;
  const matrixFile = options.matrixFile ?? MATRIX_FILE;
  const threatModelFile = options.threatModelFile ?? THREAT_MODEL_FILE;
  const errors: string[] = [];
  let rows = 0;
  let cachedNames: Set<string> | undefined;
  const names = (): Set<string> => (cachedNames ??= indexByName(root));

  const matrixPath = join(root, matrixFile);
  if (existsSync(matrixPath)) {
    const text = readFileSync(matrixPath, 'utf8');
    const matrix = checkMatrix(matrixFile, text);
    rows = matrix.rows;
    errors.push(...matrix.errors, ...checkForbidden(matrixFile, text));
    errors.push(...checkPaths(root, matrixFile, text, names));
  } else {
    errors.push(`${matrixFile}: no existe`);
  }

  const modelPath = join(root, threatModelFile);
  if (existsSync(modelPath)) {
    const text = readFileSync(modelPath, 'utf8');
    errors.push(
      ...checkThreatModel(threatModelFile, text),
      ...checkForbidden(threatModelFile, text),
    );
    errors.push(...checkPaths(root, threatModelFile, text, names));
  } else {
    errors.push(`${threatModelFile}: no existe`);
  }
  return { errors, rows };
}

function main(): void {
  const root = resolve(import.meta.dirname, '../..');
  const result = checkEvidence({ root });
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error);
    console.error(`\nsecurity:evidence falló: ${result.errors.length} problema(s).`);
    process.exit(1);
  }
  console.log(`security:evidence OK: ${result.rows} de ${RISK_IDS.length} filas con estado.`);
}

if (process.argv[1] && relative(process.argv[1], import.meta.filename) === '') main();
