import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F8 (decision 6A, FR-013): ZAP baseline is a manual, passive script that only ever touches the
 * local API and web. These tests keep it from pointing at a third party or at Gemini.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const SCRIPT = 'scripts/security/zap-baseline.sh';
const HOOK = '.zap/seed-hook.py';
const RULES = '.zap/rules.tsv';
const read = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

function run(env: Record<string, string>) {
  return spawnSync('bash', [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ZAP_DRY_RUN: '1', ...env },
  });
}

describe('zap-baseline.sh target check', () => {
  it('accepts the loopback defaults and prints the plan without running ZAP', () => {
    const result = run({});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('--network host');
    expect(result.stdout).toContain('http://127.0.0.1:3000');
  });

  it.each([
    ['ZAP_API_URL', 'https://example.com'],
    ['ZAP_API_URL', 'http://192.168.1.10:3000'],
    ['ZAP_API_URL', 'http://localhost.evil.example'],
    ['ZAP_API_URL', 'http://127.0.0.1.evil.example:3000'],
    ['ZAP_API_URL', 'http://localhost@evil.example:3000'],
    ['ZAP_API_URL', 'http://0.0.0.0:3000'],
    ['ZAP_API_URL', 'https://generativelanguage.googleapis.com'],
    ['ZAP_WEB_URL', 'http://staging.example.com'],
    ['ZAP_WEB_URL', 'ftp://localhost:4173'],
  ])('refuses %s=%s', (variable, value) => {
    const result = run({ [variable]: value });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/loopback/i);
    expect(result.stdout).not.toContain('docker run');
  });
});

describe('zap-baseline.sh content', () => {
  const files = [SCRIPT, HOOK, RULES];

  it('pins the official image by digest and uses the host network', () => {
    const script = read(SCRIPT);
    expect(script).toMatch(/zaproxy\/zap-stable@sha256:[0-9a-f]{64}/);
    expect(script).toContain('--network host');
    expect(script).not.toMatch(/zap-stable:(latest|stable)/);
  });

  it('names no destination beyond loopback', () => {
    for (const file of files) {
      const urls = read(file).match(/https?:\/\/[^\s'")\\]+/g) ?? [];
      for (const url of urls) {
        const allowed = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|\$\{?[A-Z_]+)/;
        const docs = /^https:\/\/www\.zaproxy\.org\//;
        expect(allowed.test(url) || docs.test(url), `${file}: ${url}`).toBe(true);
      }
    }
  });

  it('never mentions Gemini, a Google API or an LLM key', () => {
    for (const file of files) {
      expect(read(file), file).not.toMatch(
        /gemini|googleapis|generativelanguage|GEMINI_API_KEY|LLM_API_KEY/i,
      );
    }
  });

  it('is passive: no active scan, no session and no CI workflow', () => {
    const script = read(SCRIPT);
    expect(script).not.toMatch(/zap-full-scan|zap-api-scan|activeScan|ascan/);
    expect(script).toContain('zap-baseline.py');
    expect(() => readFileSync(resolve(ROOT, '.github/workflows/zap.yml'))).toThrow();
  });
});

describe('committed ZAP report', () => {
  interface Alert {
    pluginid: string;
    name: string;
    riskcode: string;
  }
  const report = JSON.parse(read('docs/security/zap/zap-report.json')) as {
    site: { '@name': string; alerts: Alert[] }[];
  };
  const alerts = report.site.flatMap((site) => site.alerts);

  it('only scanned loopback origins', () => {
    for (const site of report.site) {
      expect(site['@name'], site['@name']).toMatch(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/);
    }
  });

  it('has a rule and a decision for every medium or high alert', () => {
    const rules = read(RULES);
    const decisions = read('docs/security/zap.md');
    const serious = alerts.filter((alert) => Number(alert.riskcode) >= 2);
    for (const alert of serious) {
      expect(rules, alert.name).toMatch(new RegExp(`^${alert.pluginid}\t`, 'm'));
      expect(decisions, alert.name).toContain(`| ${alert.pluginid} `);
    }
  });

  it('carries no cookie value, credential or .env secret', () => {
    const raw = read('docs/security/zap/zap-report.json');
    expect(raw).not.toMatch(/set-cookie:\s*\S+=/i);
    expect(raw).not.toMatch(/__Host-session=\S/);
    expect(raw).not.toMatch(/(authorization|bearer)\s*[:=]\s*\S{12,}/i);
  });
});
