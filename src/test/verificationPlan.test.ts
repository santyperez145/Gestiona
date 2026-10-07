import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { E2E_REQUIRED_ENV, VERIFICATION_STAGES, executeVerification, missingVerificationEnvironment, verificationPlan } from '../../scripts/verification-plan.mjs';

describe('shared release verification', () => {
  it('technical gate includes Edge, docs, browser types, tests, build, dependencies and diff', () => {
    expect(verificationPlan().map(step => [step.command, ...step.args].join(' '))).toEqual([
      'npm run check:functions', 'npm run check:migrations', 'npm run check:conteos', 'npm run check:enlaces',
      'npm run lint', 'npm run typecheck', 'npm run build', 'npm run test -- --maxWorkers=2',
      'npm run check:dependencies', 'git diff --check',
    ]);
  });

  it.each(Object.keys(VERIFICATION_STAGES))('CI stage %s runs the same selected scripts', stage => {
    expect(verificationPlan([`--stage=${stage}`]).map(step => step.args[1])).toEqual(VERIFICATION_STAGES[stage]);
  });

  it('full CI gate requires authenticated E2E instead of silently skipping it', () => {
    const steps = verificationPlan(['--with-e2e']);
    expect(steps.some(step => step.args.includes('test:e2e:ci'))).toBe(true);
    expect(missingVerificationEnvironment(steps, {})).toEqual(E2E_REQUIRED_ENV);
    expect(missingVerificationEnvironment(verificationPlan(), {})).toEqual([]);
    const configured = Object.fromEntries(E2E_REQUIRED_ENV.map(name => [name, 'synthetic-env-check-only']));
    expect(missingVerificationEnvironment(steps, configured)).toEqual([]);
    expect(missingVerificationEnvironment(steps, { ...configured, E2E_PASSWORD: '  ' })).toEqual(['E2E_PASSWORD']);
  });

  it.each([['--stage=unknown'], ['--anything'], ['--with-e2e', '--stage=build'], ['--stage=test', '--stage=security'], ['--with-e2e', '--with-e2e']])('rejects invalid arguments %j', (...args) => {
    expect(() => verificationPlan(args)).toThrow();
  });

  it('stops at the first failure and preserves its status', () => {
    const run = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(7).mockReturnValue(0);
    expect(executeVerification(verificationPlan(), run)).toBe(7);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('signal or startup failure cannot return green', () => {
    expect(executeVerification(verificationPlan(), () => null)).toBe(1);
    expect(executeVerification(verificationPlan(), () => 0)).toBe(0);
  });

  it('GitHub Actions consumes all shared stages without weakening security', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    for (const stage of Object.keys(VERIFICATION_STAGES)) expect(workflow).toContain(`npm run verify -- --stage=${stage}`);
    expect(workflow).not.toContain('audit-level=critical');
    expect(workflow).not.toContain('continue-on-error: true');
    const runner = readFileSync('scripts/verify.mjs', 'utf8');
    expect(runner).toContain("env.E2E_REQUIRE_AUTH = 'true'");
    expect(runner).toContain('process.execPath');
  });
});
