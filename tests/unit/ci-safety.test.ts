// Regression tests: CI and test scripts can never write synthetic data to production.
// (Before this, a pull-request workflow fell back to the production API and registered test accounts there.)
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { PRODUCTION_ORIGINS, UnsafeTargetError, assertWritableApi, e2eWriteApi, readOnlyFetch } from '../support/targets';

const PROD_API = 'https://medguard-api-duti.onrender.com';
const PROD_HOSTS = PRODUCTION_ORIGINS.map((o) => new URL(o).hostname);
/** Commands that register accounts or create, change or delete records. */
const WRITE_CAPABLE = /verify-api\.mts|playwright test/;

describe('target guard for write-capable tests', () => {
  it('refuses when no target is configured: there is no fallback to a deployed API', () => {
    for (const missing of [undefined, '', '   ']) expect(() => assertWritableApi(missing, {})).toThrow(/No test API is configured/);
  });

  it('refuses production in every spelling, even when "approved"', () => {
    const approved = { MEDGUARD_APPROVED_TEST_API: PROD_API };
    for (const url of [PROD_API, `${PROD_API}/`, `${PROD_API}/api`, 'HTTPS://MEDGUARD-API-DUTI.ONRENDER.COM', 'http://medguard-api-duti.onrender.com', 'https://medguard-api-duti.onrender.com:443', 'https://medguard-sigma.vercel.app']) {
      expect(() => assertWritableApi(url, approved), url).toThrow(UnsafeTargetError);
      expect(() => assertWritableApi(url, approved), url).toThrow(/production/);
    }
  });

  it('allows loopback servers started by the test run', () => {
    expect(assertWritableApi('http://127.0.0.1:8790/', {})).toBe('http://127.0.0.1:8790');
    expect(assertWritableApi('http://localhost:8787', {})).toBe('http://localhost:8787');
    expect(assertWritableApi('http://[::1]:8787', {})).toBe('http://[::1]:8787');
  });

  it('refuses any other remote API unless that exact origin is approved', () => {
    expect(() => assertWritableApi('https://staging.example.org', {})).toThrow(/not a loopback/);
    expect(() => assertWritableApi('https://staging.example.org', { MEDGUARD_APPROVED_TEST_API: 'https://other.example.org' })).toThrow(/not a loopback/);
    expect(() => assertWritableApi('https://127.0.0.1.evil.example', {})).toThrow(/not a loopback/);
    expect(assertWritableApi('https://staging.example.org/', { MEDGUARD_APPROVED_TEST_API: 'https://staging.example.org' })).toBe('https://staging.example.org');
    expect(() => assertWritableApi('ftp://127.0.0.1', {})).toThrow(/http\(s\)/);
  });

  it('browser specs skip without a target, but fail (never skip silently) when CI requires one', () => {
    expect(e2eWriteApi(undefined, '', {})).toBe('');
    expect(e2eWriteApi('', '', {})).toBe('');
    expect(() => e2eWriteApi(undefined, '', { MEDGUARD_REQUIRE_API: '1' })).toThrow(/must not be skipped/);
    expect(e2eWriteApi(undefined, 'http://localhost:8787', {})).toBe('http://localhost:8787');
    expect(() => e2eWriteApi(PROD_API, 'http://localhost:8787', {})).toThrow(/production/);
  });

  it('read-only fetch refuses state-changing methods and bodies before any network call', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      await expect(readOnlyFetch(`${PROD_API}/api/auth/register`, { method })).rejects.toThrow(UnsafeTargetError);
    }
    await expect(readOnlyFetch(`${PROD_API}/api/cases`, { method: 'GET', body: '{}' })).rejects.toThrow(/body/);
  });
});

interface Step { name?: string; run?: string; env?: Record<string, string> }
interface Job { if?: string; env?: Record<string, string>; steps: Step[]; services?: Record<string, { image: string }> }
interface Workflow { on: Record<string, unknown>; env?: Record<string, string>; jobs: Record<string, Job> }
const workflows = readdirSync('.github/workflows').filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, wf: parse(readFileSync(`.github/workflows/${f}`, 'utf8')) as Workflow }));

/** Environment a step runs with, including inline `VAR=value command` assignments in its script. */
function effectiveEnv(wf: Workflow, job: Job, step: Step): Record<string, string> {
  const env: Record<string, string> = { ...wf.env, ...job.env, ...step.env };
  for (const m of (step.run ?? '').matchAll(/(?:^|\s)([A-Z_]+)=("[^"]*"|'[^']*'|\S*)(?=\s)/g)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return env;
}

describe('workflows cannot send write-capable tests to production', () => {
  it('found the workflows to check', () => {
    expect(workflows.map((w) => w.file).sort()).toEqual(expect.arrayContaining(['ci-deploy.yml', 'verify-live.yml']));
  });

  it('every write-capable step targets only loopback (or nothing), with no production host and no repository variable', () => {
    let writeSteps = 0;
    for (const { file, wf } of workflows) {
      for (const [name, job] of Object.entries(wf.jobs)) {
        for (const step of job.steps ?? []) {
          if (!WRITE_CAPABLE.test(step.run ?? '')) continue;
          writeSteps++;
          const where = `${file} › ${name} › ${step.name ?? step.run}`;
          const env = effectiveEnv(wf, job, step);
          for (const key of ['API_URL', 'AI_API_URL']) {
            const v = env[key] ?? '';
            expect(v === '' || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(v), `${where}: ${key}=${v}`).toBe(true);
          }
          const text = JSON.stringify(step) + JSON.stringify(job.env ?? {});
          for (const host of PROD_HOSTS.filter((h) => !h.endsWith('github.io'))) expect(text.includes(host), `${where} mentions ${host}`).toBe(false);
          expect(/\$\{\{\s*vars\./.test(text), `${where} uses a repository variable`).toBe(false);
        }
      }
    }
    expect(writeSteps).toBeGreaterThan(0);
  });

  it('the pull-request job of verify-live runs the write checks against its own PostgreSQL container, with no secrets or variables', () => {
    const { wf } = workflows.find((w) => w.file === 'verify-live.yml')!;
    expect(Object.keys(wf.on)).toContain('pull_request');
    const pr = Object.values(wf.jobs).filter((j) => j.if?.includes("== 'pull_request'"));
    expect(pr).toHaveLength(1);
    const job = pr[0];
    expect(job.services?.postgres?.image).toMatch(/postgres:16$/);
    expect(job.env?.API_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(job.env?.MEDGUARD_REQUIRE_API).toBe('1');
    expect(JSON.stringify(job)).not.toMatch(/\$\{\{\s*(vars|secrets)\./);
    expect(JSON.stringify(job)).toMatch(/DATABASE_URL=\\?"postgres:\/\/[^@]+@127\.0\.0\.1:5432\//);
    const runs = job.steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toMatch(/verify-api\.mts write/);
    expect(runs).toMatch(/verify-api\.mts read/);
    expect(runs).toMatch(/playwright test tests\/e2e\/shared\.spec\.ts/);
  });

  it('jobs that may target production run only read-only checks', () => {
    for (const { file, wf } of workflows) {
      for (const [name, job] of Object.entries(wf.jobs)) {
        const text = JSON.stringify(job);
        const touchesProduction = PROD_HOSTS.some((h) => !h.endsWith('github.io') && text.includes(h)) || /vars\.MEDGUARD_API_URL/.test(text);
        if (!touchesProduction) continue;
        for (const step of job.steps) {
          const run = step.run ?? '';
          expect(/verify-api\.mts/.test(run), `${file} › ${name} runs the write-capable verifier`).toBe(false);
          if (/playwright test/.test(run)) {
            const env = effectiveEnv(wf, job, step);
            expect(env.API_URL ?? '', `${file} › ${name}: browser tests must not receive an API`).toBe('');
            expect(env.AI_API_URL ?? '', `${file} › ${name}: browser tests must not receive an AI API`).toBe('');
          }
        }
      }
    }
  });

  it('the on-demand production job runs the read-only smoke script', () => {
    const { wf } = workflows.find((w) => w.file === 'verify-live.yml')!;
    const job = Object.values(wf.jobs).find((j) => j.if?.includes("== 'workflow_dispatch'"))!;
    expect(job.steps.map((s) => s.run ?? '').join('\n')).toMatch(/smoke-readonly\.mts/);
  });
});

describe('write-capable scripts fail closed when pointed at production', () => {
  // Any request that slipped past the guard would fail differently (network/proxy), not with exit 3 + REFUSED.
  const runVerifier = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'tests/live/verify-api.mts', ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });

  it('verify-api.mts refuses production for both phases, and refuses a missing URL', () => {
    for (const args of [['write', PROD_API, 'https://medguard-sigma.vercel.app'], ['read', PROD_API], ['write', `${PROD_API}/`], ['write', '']]) {
      const r = runVerifier(args, { MEDGUARD_APPROVED_TEST_API: PROD_API });
      expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(3);
      expect(r.stderr).toMatch(/REFUSED/);
      expect(r.stdout).not.toMatch(/PASS|FAIL/); // no check (and so no request) ran
    }
  }, 120_000);

  it('the browser specs that write refuse to load against production', () => {
    const r = spawnSync('npx', ['playwright', 'test', 'tests/e2e/shared.spec.ts', 'tests/e2e/ai.spec.ts', '--list'], {
      encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, BASE_URL: 'https://medguard-sigma.vercel.app/', API_URL: PROD_API, AI_API_URL: PROD_API },
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Refusing to write test data to production/);
  }, 120_000);

  it('a CI job that requires the API cannot pass by skipping the specs when it is missing', () => {
    const r = spawnSync('npx', ['playwright', 'test', 'tests/e2e/shared.spec.ts', '--list'], {
      encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, BASE_URL: 'https://medguard-sigma.vercel.app/', API_URL: '', MEDGUARD_REQUIRE_API: '1' },
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/must not be skipped/);
  }, 120_000);

  it('the read-only smoke script sends requests only through readOnlyFetch', () => {
    const src = readFileSync('tests/live/smoke-readonly.mts', 'utf8');
    expect(src).toMatch(/import \{ readOnlyFetch \} from '\.\.\/support\/targets'/);
    expect(src.replace(/readOnlyFetch\(/g, '')).not.toMatch(/\bfetch\(/);
  });

  it('every spec that reads an API URL from the environment goes through the guard', () => {
    for (const f of readdirSync('tests/e2e').filter((x) => x.endsWith('.spec.ts'))) {
      const src = readFileSync(`tests/e2e/${f}`, 'utf8');
      if (!/process\.env\.(AI_)?API_URL/.test(src)) continue;
      expect(src, f).toMatch(/e2eWriteApi\(process\.env\.(AI_)?API_URL/);
      expect(src, f).not.toMatch(/process\.env\.(AI_)?API_URL\s*\?\?/);
    }
  });
});
