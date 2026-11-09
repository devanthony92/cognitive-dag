import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F8 (decision 2B) removed the eight product flags. Their names may live on only in the ADRs and
 * the specs, which are history. The worker's kill switch `TRIGGERS_ENABLED` is not one of them.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const FLAGS = [
  'ping',
  'identity',
  'dag-editor',
  'execution',
  'resilience',
  'llm-nodes',
  'nl-compiler',
  'triggers',
];
const HISTORY = [/^docs\/adr\//, /^specs\//];
const KILL_SWITCH = /TRIGGERS_ENABLED/g;
const SELF = 'scripts/test/unit/no-product-flags.test.ts';

/** `dag-editor-enabled`, `dagEditorEnabled`, `DagEditorEnabled` and `DAG_EDITOR_ENABLED`. */
function patternFor(flag: string): RegExp {
  const words = flag.split('-');
  const camel = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join('');
  const alternatives = [
    `${flag}-enabled`,
    `${words.join('_').toUpperCase()}_ENABLED`,
    `${camel}Enabled`,
  ];
  return new RegExp(alternatives.join('|'), 'i');
}

function liveFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return out.split('\0').filter((file) => file !== '' && file !== 'pnpm-lock.yaml');
}

describe('product flags are gone', () => {
  const patterns = FLAGS.map((flag) => ({ flag, regex: patternFor(flag) }));

  it('no live file mentions any of the eight flags', () => {
    const offenders: string[] = [];
    for (const file of liveFiles()) {
      if (file === SELF || HISTORY.some((history) => history.test(file))) continue;
      let text: string;
      try {
        text = readFileSync(resolve(ROOT, file), 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\0')) continue;
      const scrubbed = text.replace(KILL_SWITCH, '');
      for (const { flag, regex } of patterns) {
        if (regex.test(file) || regex.test(scrubbed)) offenders.push(`${file}: ${flag}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('matches every spelling of a flag but not the worker kill switch', () => {
    const dag = patternFor('dag-editor');
    for (const sample of ['dag-editor-enabled', 'dagEditorEnabled', 'DAG_EDITOR_ENABLED']) {
      expect(dag.test(sample)).toBe(true);
    }
    const triggers = patternFor('triggers');
    expect(triggers.test('triggersEnabled')).toBe(true);
    expect(triggers.test('TRIGGERS_ENABLED'.replace(KILL_SWITCH, ''))).toBe(false);
  });
});
