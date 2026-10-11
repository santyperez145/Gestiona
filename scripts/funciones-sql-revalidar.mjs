// Revalida todas las funciones LANGUAGE sql del esquema public: recrea cada
// una con su propia definición dentro de una transacción que se revierte.
// Postgres vuelve a chequear el cuerpo al crearla (check_function_bodies), así
// que una columna que ya no existe o un tipo que cambió aparecen acá antes
// que en producción. Complementa scripts/funciones-plpgsql-check.sql, que
// cubre PL/pgSQL. No cambia nada (ROLLBACK).
//   node scripts/funciones-sql-revalidar.mjs   (necesita SUPABASE_DB_URL)
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`select p.oid, p.proname, pg_get_functiondef(p.oid) d
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.pronamespace = 'public'::regnamespace and l.lanname = 'sql' and p.prokind = 'f'`);
const errores = [];
await c.query('BEGIN');
await c.query("SET LOCAL check_function_bodies = on");
for (const f of r.rows) {
  await c.query('SAVEPOINT f');
  try { await c.query(f.d); } catch (e) { errores.push(`${f.proname}: ${e.message}`); }
  await c.query('ROLLBACK TO SAVEPOINT f');
}
await c.query('ROLLBACK');
await c.end();
console.log(`funciones sql revisadas: ${r.rows.length}`);
console.log(errores.length ? errores.join('\n') : 'sin errores');
