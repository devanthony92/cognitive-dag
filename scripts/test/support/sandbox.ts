import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Support for the F9 script tests (T039 to T041). A script runs under `bash` inside a temporary
 * directory that stands for the filesystem root, with stub commands first on PATH: nothing touches
 * the real host, the registry, the Vault or the network. Every stub appends its name and arguments
 * to one log, so a test can assert what was called and in which order. Secrets used by the tests are
 * random values made at run time and exist only inside the temporary directory.
 */
export const ROOT = resolve(import.meta.dirname, '../../..');

/** Forward slashes keep Git Bash on Windows happy; they are valid everywhere else. */
export const posix = (path: string): string => path.replaceAll('\\', '/');

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Standard output and error together, the way an operator or a CI log would see them. */
  output: string;
}

export interface Sandbox {
  /** Stands for `/`: scripts get their directories from environment variables that point here. */
  root: string;
  bin: string;
  log: string;
  path: (...parts: string[]) => string;
  /** Adds a stub command; `body` runs after the call has been logged. */
  stub: (name: string, body?: string) => void;
  /** Runs a script of the repository with the stubs first on PATH. */
  run: (script: string, args?: string[], env?: Record<string, string>, input?: string) => RunResult;
  calls: () => string[];
  clearCalls: () => void;
  cleanup: () => void;
}

export function createSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'cdag-sandbox-'));
  const bin = join(root, 'stub-bin');
  const log = join(root, 'calls.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(log, '');
  const sandbox: Sandbox = {
    root,
    bin,
    log,
    path: (...parts) => join(root, ...parts),
    stub(name, body = '') {
      const file = join(bin, name);
      writeFileSync(
        file,
        `#!/usr/bin/env bash
printf '%s' "$(basename "$0")" >>"$STUB_LOG"
printf ' %s' "$@" >>"$STUB_LOG"
printf '\n' >>"$STUB_LOG"
${body}
`,
        { mode: 0o755 },
      );
      chmodSync(file, 0o755);
    },
    run(script, args = [], env = {}, input) {
      const result = spawnSync(
        'bash',
        [
          '-c',
          'PATH="$STUB_BIN:$PATH" exec bash "$@"',
          'bash',
          posix(resolve(ROOT, script)),
          ...args,
        ],
        {
          env: {
            ...process.env,
            MSYS_NO_PATHCONV: '1',
            STUB_BIN: posix(bin),
            STUB_LOG: posix(log),
            ...env,
          },
          encoding: 'utf8',
          input,
          timeout: 120_000,
        },
      );
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        output: `${result.stdout}${result.stderr}`,
      };
    },
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    clearCalls: () => writeFileSync(log, ''),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  return sandbox;
}

/** Whether a command exists on the host (for tests that need the real tool). */
export function hasCommand(name: string): boolean {
  return spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).status === 0;
}
