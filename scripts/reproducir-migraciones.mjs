/**
 * Reproduce TODAS las migraciones, en orden, sobre una base local vacía
 * (2026-10-23), mostrando el error completo de Postgres si una falla.
 *
 * `supabase start` también las aplica, pero cuando una falla sólo informa
 * «Failed to execute statement» sin el mensaje de Postgres. Este script las
 * corre una por una con `pg` y, si una falla, dice archivo, mensaje, detalle,
 * pista y el SQL alrededor de la posición del error. Lo usa
 * `.github/workflows/simulacro-migraciones.yml` antes de las matrices.
 *
 * Uso: SIMULACRO_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/reproducir-migraciones.mjs
 * Nunca contra producción: se niega si la URL no es local.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { esLocal } from "./simulacro-local.mjs";

const DIR = "supabase/migrations";

/** El SQL alrededor de la posición (1-based) que informa Postgres. */
export function contexto(sql, posicion, margen = 240) {
  const i = Math.max(0, Number(posicion || 0) - 1);
  const linea = sql.slice(0, i).split("\n").length;
  return { linea, texto: sql.slice(Math.max(0, i - margen), i + margen) };
}

async function main() {
  const url = process.env.SIMULACRO_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!esLocal(url)) { console.error("::error::La reproducción corre sólo contra una base local."); process.exitCode = 1; return; }
  const archivos = readdirSync(DIR).filter(f => /^\d{14}_.+\.sql$/.test(f)).sort();
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  // El proyecto productivo es anterior al cambio de Supabase que dejó de dar
  // permisos por defecto a anon y authenticated en `public`: sus tablas los
  // heredan de ahí (20261013000900 se los saca a anon). Una base nueva no los
  // trae, así que se dejan como en producción antes de la primera migración.
  await db.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
  // Igual que el CLI: la historia queda en supabase_migrations.schema_migrations.
  await db.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)");
  try {
    for (const [n, f] of archivos.entries()) {
      const sql = readFileSync(join(DIR, f), "utf8");
      try {
        await db.query(sql);
        await db.query("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [f.slice(0, 14), f.slice(15, -4)]);
      } catch (e) {
        await db.query("ROLLBACK").catch(() => {});
        const c = contexto(sql, e.position);
        console.log(`\nFALLA en ${f} (${n + 1} de ${archivos.length}), línea ~${c.linea}`);
        console.log(`  ${e.severity ?? "ERROR"} ${e.code ?? ""}: ${e.message}`);
        if (e.detail) console.log(`  DETALLE: ${e.detail}`);
        if (e.hint) console.log(`  PISTA: ${e.hint}`);
        if (e.where) console.log(`  DÓNDE: ${e.where}`);
        console.log("  ---\n" + c.texto.split("\n").map(l => "  | " + l).join("\n"));
        console.log(`::error file=${DIR}/${f},line=${c.linea}::${e.message}`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`${archivos.length} migraciones aplicadas desde cero.`);
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
