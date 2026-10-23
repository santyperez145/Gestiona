/**
 * Simulacro de las matrices contra un Postgres de Supabase local (2026-10-23).
 *
 * Las matrices de `scripts/migraciones-pendientes.mjs` sólo corrían contra la
 * base productiva, y con la base apagada se acumularon migraciones que nunca
 * tocaron un Postgres real. Este script corre sobre la base que levanta
 * `supabase start` en CI (`.github/workflows/simulacro-migraciones.yml`),
 * que aplica TODAS las migraciones desde cero:
 *   1. Si `auth.users` tiene menos de dos usuarios, crea dos de prueba (las
 *      matrices los usan como dueño y vendedor).
 *   2. Corre cada matriz en su transacción. Una matriz termina en
 *      RAISE EXCEPTION 'OK …' cuando todo dio bien; cualquier otro final es
 *      una falla. Nada queda escrito: todo se revierte.
 *
 * Uso: SIMULACRO_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/simulacro-local.mjs [versión…]
 * Nunca contra producción: se niega si la URL no es local.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { MATRICES } from "./migraciones-pendientes.mjs";

export function esLocal(url) {
  try { return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(url).hostname); } catch { return false; }
}

/** Lo que dejó la matriz: OK, falla o un final que no es de matriz. */
export function leerFinal(error) {
  const mensaje = error?.message ?? "";
  if (/^OK\b/.test(mensaje)) return { ok: true, detalle: mensaje };
  if (!error) return { ok: false, detalle: "terminó sin RAISE 'OK': la matriz no llegó al final" };
  return { ok: false, detalle: mensaje };
}

/** Saca el ROLLBACK final: la transacción la maneja el script. */
export const cuerpoDeMatriz = sql => sql.replace(/\n\s*ROLLBACK;\s*$/i, "\n");

async function main() {
  const url = process.env.SIMULACRO_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!esLocal(url)) { console.error("::error::El simulacro corre sólo contra una base local."); process.exitCode = 1; return; }
  const pedidas = process.argv.slice(2);
  const versiones = Object.keys(MATRICES).filter(v => !pedidas.length || pedidas.includes(v)).sort();
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM auth.users");
    for (let i = rows[0].n; i < 2; i++) {
      await db.query(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
        VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '', now(), now() + ($2 || ' seconds')::interval, now(), '{}', '{}')`,
        [`simulacro${i}@nerqia.test`, String(i)]);
    }
    const resultados = [];
    for (const v of versiones) {
      const sql = cuerpoDeMatriz(readFileSync(resolve(MATRICES[v]), "utf8"));
      let error = null;
      await db.query("BEGIN");
      try { await db.query(sql); } catch (e) { error = e; }
      await db.query("ROLLBACK");
      const r = { version: v, matriz: MATRICES[v], ...leerFinal(error) };
      resultados.push(r);
      console.log(`${r.ok ? "OK   " : "FALLA"} ${v} ${r.matriz}: ${r.detalle}`);
      if (!r.ok) console.log(`::error title=Matriz ${v}::${r.detalle.replace(/\n/g, " ")}`);
    }
    const fallas = resultados.filter(r => !r.ok);
    console.log(`\n${resultados.length - fallas.length} de ${resultados.length} matrices en OK.`);
    process.exitCode = fallas.length ? 1 : 0;
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
