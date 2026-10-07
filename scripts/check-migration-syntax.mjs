import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'libpg-query';

/** PostgreSQL 17 grammar only: never opens a connection or executes SQL.
 * This is NOT a schema-order, PL/pgSQL-body, privilege or data-migration gate.
 * Supabase Preview replay and reversible database drills remain mandatory.
 */
export async function migrationSyntaxFailures(files) {
  const failures = [];
  for (const file of files) {
    if (!file.sql.trim()) continue; // Historical no-op versions retain their identity.
    try { await parse(file.sql); }
    catch (cause) { failures.push({ name: file.name, message: cause.message }); }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
  const files = readdirSync(folder).filter(name => name.endsWith('.sql')).sort()
    .map(name => ({ name, sql: readFileSync(resolve(folder, name), 'utf8') }));
  const failures = await migrationSyntaxFailures(files);
  for (const failure of failures) console.error(`[migration syntax] ${failure.name}: ${failure.message}`);
  console.log(`PostgreSQL 17 grammar: ${files.length} migrations, ${failures.length} failures. No SQL executed.`);
  process.exitCode = failures.length ? 1 : 0;
}
