export const VERIFICATION_STAGES = {
  build: ['check:functions', 'check:migrations', 'check:conteos', 'check:enlaces', 'lint', 'typecheck', 'build'],
  test: ['test'],
  security: ['check:dependencies'],
  e2e: ['test:e2e:ci'],
};

export const E2E_REQUIRED_ENV = [
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'E2E_STORE_SLUG', 'E2E_USER', 'E2E_PASSWORD',
];

export function verificationPlan(args = []) {
  let stage = 'all';
  let withE2E = false;
  let explicitStage = false;
  for (const arg of args) {
    if (arg === '--with-e2e' && !withE2E) withE2E = true;
    else if (arg.startsWith('--stage=') && !explicitStage) {
      stage = arg.slice('--stage='.length);
      explicitStage = true;
    } else throw new Error(`Opcion de verificacion no soportada: ${arg}`);
  }
  if (stage !== 'all' && !Object.hasOwn(VERIFICATION_STAGES, stage)) {
    throw new Error(`Etapa de verificacion no soportada: ${stage}`);
  }
  if (withE2E && stage !== 'all') throw new Error('--with-e2e requiere la puerta completa');
  const stages = stage === 'all' ? ['build', 'test', 'security', ...(withE2E ? ['e2e'] : [])] : [stage];
  const steps = stages.flatMap(name => VERIFICATION_STAGES[name].map(script => ({
    command: 'npm', args: ['run', script, ...(script === 'test' ? ['--', '--maxWorkers=2'] : [])],
  })));
  if (stage === 'all') steps.push({ command: 'git', args: ['diff', '--check'] });
  return steps;
}

export function missingVerificationEnvironment(steps, env) {
  if (!steps.some(step => step.args.includes('test:e2e:ci'))) return [];
  return E2E_REQUIRED_ENV.filter(name => !env[name]?.trim());
}

export function executeVerification(steps, run) {
  for (const step of steps) {
    const status = run(step);
    if (status !== 0) return Number.isInteger(status) && status > 0 ? status : 1;
  }
  return 0;
}
