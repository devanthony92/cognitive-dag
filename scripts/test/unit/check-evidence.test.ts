import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkEvidence } from '../../security/check-evidence.ts';

/**
 * F8 (FR-001, FR-002, SC-003, SC-008): the evidence matrix and the threat model are checked by a
 * script, so a cited file that moves, a row without a state or a leftover `planned:F4` fails CI.
 */
const REAL_ROOT = resolve(import.meta.dirname, '../../..');

const IDS = [
  ...Array.from({ length: 10 }, (_, index) => `LLM${String(index + 1).padStart(2, '0')}`),
  ...Array.from({ length: 10 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
];

const HEADER =
  '| Riesgo | Aplica | Control | Ubicación | Evidencia | Resultado y fecha | Estado |\n' +
  '| --- | --- | --- | --- | --- | --- | --- |';

interface RowOverrides {
  evidence?: string;
  result?: string;
  state?: string;
}

function row(id: string, overrides: RowOverrides = {}): string {
  const evidence = overrides.evidence ?? '`pnpm test`; `scripts/test/unit/ok.test.ts`';
  const result = overrides.result ?? 'Pasa, 2026-11-09';
  const state = overrides.state ?? '`verified`';
  return `| ${id} Riesgo | Sí | Control | \`scripts/ok.ts\` | ${evidence} | ${result} | ${state} |`;
}

function matrix(overrides: Record<string, RowOverrides> = {}, skip: string[] = []): string {
  const rows = IDS.filter((id) => !skip.includes(id)).map((id) => row(id, overrides[id]));
  return `# Matriz\n\n## 6.1 y 6.2\n\n${HEADER}\n${rows.join('\n')}\n`;
}

function threatModel(rows: string[] = []): string {
  const body = [
    '| Cat. | Amenaza | Estado | Evidencia o razón |',
    '| --- | --- | --- | --- |',
    '| S | Algo | `mitigated` | `ok.test.ts` |',
    ...rows,
  ];
  return `# Modelo\n\n${body.join('\n')}\n`;
}

let root: string;

function put(file: string, content: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function setup(matrixText: string, modelText: string = threatModel()): void {
  put('docs/security/owasp-evidence.md', matrixText);
  put('docs/threat-model.md', modelText);
  put('scripts/ok.ts', '');
  put('scripts/test/unit/ok.test.ts', '');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-evidence-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('checkEvidence', () => {
  it('passes a complete matrix and threat model', () => {
    setup(matrix());
    const result = checkEvidence({ root });
    expect(result.errors).toEqual([]);
    expect(result.rows).toBe(20);
  });

  it('fails when a cited path does not exist', () => {
    setup(matrix({ LLM03: { evidence: '`scripts/test/unit/missing.test.ts`' } }));
    const result = checkEvidence({ root });
    expect(result.errors.join('\n')).toContain('missing.test.ts');
  });

  it('fails when a path cited in the threat model does not exist', () => {
    setup(matrix(), threatModel(['| T | Otra | `mitigated` | `gone.test.ts` |']));
    const result = checkEvidence({ root });
    expect(result.errors.join('\n')).toContain('gone.test.ts');
  });

  it('resolves a bare file name anywhere in the repository', () => {
    put('apps/api/test/ok-bare.test.ts', '');
    setup(matrix({ A01: { evidence: '`ok-bare.test.ts`' } }));
    expect(checkEvidence({ root }).errors).toEqual([]);
  });

  it('fails a row without a state', () => {
    setup(matrix({ A05: { state: '' } }));
    expect(checkEvidence({ root }).errors.join('\n')).toContain('A05');
  });

  it('fails a row with a state outside the vocabulary', () => {
    setup(matrix({ A06: { state: '`pending`' } }));
    expect(checkEvidence({ root }).errors.join('\n')).toContain('A06');
  });

  it('fails a verified row that cites no evidence', () => {
    setup(matrix({ LLM07: { evidence: 'a ojo' } }));
    const result = checkEvidence({ root });
    expect(result.errors.join('\n')).toContain('LLM07');
  });

  it('fails an accepted row without owner and review', () => {
    setup(matrix({ A07: { state: '`accepted`', result: 'Sin MFA' } }));
    const result = checkEvidence({ root });
    expect(result.errors.join('\n')).toContain('A07');
  });

  it('accepts an accepted row with reason, owner and review', () => {
    setup(matrix({ A07: { state: '`accepted`', result: 'Sin MFA. Dueño: autor · Revisión: F9' } }));
    expect(checkEvidence({ root }).errors).toEqual([]);
  });

  it('fails when a row of the 20 is missing', () => {
    setup(matrix({}, ['LLM09']));
    expect(checkEvidence({ root }).errors.join('\n')).toContain('LLM09');
  });

  it.each(['planned:F4', 'planned:F8'])('fails on %s in the threat model', (state) => {
    setup(matrix(), threatModel([`| E | Pendiente | \`${state}\` | Nada |`]));
    expect(checkEvidence({ root }).errors.join('\n')).toContain(state);
  });

  it.each(['planned:F4', 'planned:F8'])('fails on %s in the matrix', (state) => {
    setup(matrix({ A02: { result: `Falta (${state})` } }));
    expect(checkEvidence({ root }).errors.join('\n')).toContain(state);
  });

  it('fails a matrix row left as deferred:F9 once F9 is closed', () => {
    setup(
      matrix({
        A02: { state: '`deferred:F9`', result: 'Requisito de F9: algo. Prueba prevista: otra' },
      }),
    );
    const errors = checkEvidence({ root }).errors.join('\n');
    expect(errors).toContain('A02');
    expect(errors).toContain('deferred:F9');
  });

  it('fails a matrix row that combines verified with deferred:F9', () => {
    setup(matrix({ A09: { state: '`verified + deferred:F9`', result: 'Requisito de F9: x' } }));
    expect(checkEvidence({ root }).errors.join('\n')).toContain('A09');
  });

  it('fails a threat model row left as deferred:F9 once F9 is closed', () => {
    setup(matrix(), threatModel(['| S | Pendiente | `deferred:F9` | Requisito de F9: algo |']));
    const errors = checkEvidence({ root }).errors.join('\n');
    expect(errors).toContain('docs/threat-model.md');
    expect(errors).toContain('deferred:F9');
  });

  it('fails a deferred:F9 mention anywhere in the threat model text', () => {
    setup(matrix(), `${threatModel()}\n- Diferido: \`deferred:F9\` en la sección 3.7.\n`);
    expect(checkEvidence({ root }).errors.join('\n')).toContain('deferred:F9');
  });

  it('fails when the matrix file is missing', () => {
    put('docs/threat-model.md', threatModel());
    expect(checkEvidence({ root }).errors.join('\n')).toContain('owasp-evidence.md');
  });
});

describe('the repository documents', () => {
  it('pass with the current matrix and threat model', () => {
    const result = checkEvidence({ root: REAL_ROOT });
    expect(result.errors).toEqual([]);
    expect(result.rows).toBe(20);
  });
});
