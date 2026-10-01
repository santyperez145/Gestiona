import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeVerification, missingVerificationEnvironment, verificationPlan } from './verification-plan.mjs';

try {
  const steps = verificationPlan(process.argv.slice(2));
  const missing = missingVerificationEnvironment(steps, process.env);
  if (missing.length) throw new Error(`E2E sin configurar: faltan ${missing.join(', ')}`);
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Ejecuta esta puerta con npm run verify');
  const env = { ...process.env };
  if (!/--max[-_]old[-_]space[-_]size/.test(env.NODE_OPTIONS ?? '')) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --max-old-space-size=6144`.trim();
  }
  if (steps.some(step => step.args.includes('test:e2e:ci'))) env.E2E_REQUIRE_AUTH = 'true';
  const status = executeVerification(steps, step => {
    console.log(`\n[verify] ${step.command} ${step.args.join(' ')}`);
    // Running npm's CLI with Node avoids Windows .cmd shell quoting.
    const result = spawnSync(step.command === 'npm' ? process.execPath : step.command,
      step.command === 'npm' ? [npmCli, ...step.args] : step.args, {
        cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: 'inherit',
      });
    if (result.error) console.error(`[verify] no se pudo iniciar el control: ${result.error.message}`);
    return result.status ?? 1;
  });
  console.log(status === 0 ? '\n[verify] Todos los controles seleccionados pasaron.' : '\n[verify] Puerta fallida; no publicar.');
  process.exitCode = status;
} catch (cause) {
  console.error(`[verify] ${cause.message}`);
  process.exitCode = 2;
}
