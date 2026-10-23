/**
 * Auditoría de permisos sobre la base local reconstruida (2026-10-23).
 *
 * La base que arma `reproducir-migraciones.mjs` replica el esquema y los
 * privilegios por defecto de producción. Sobre ella se buscan:
 *   1. Vistas que se pueden escribir (auto-actualizables), que corren con los
 *      permisos de su dueño (sin `security_invoker`) y en las que anon o
 *      authenticated tienen INSERT, UPDATE o DELETE: escribirían saltando RLS.
 *   2. Tablas sin RLS en `public` con algún privilegio para anon o
 *      authenticated.
 *   3. Tablas en las que anon o authenticated tienen TRUNCATE (no lo frena RLS).
 * Sale con 1 si encuentra algo, salvo que se lo pida sólo como informe.
 *
 * Uso: SIMULACRO_DB_URL=… node scripts/auditoria-local.mjs [--informe]
 */
import { pathToFileURL } from "node:url";
import pg from "pg";
import { esLocal } from "./simulacro-local.mjs";

export const CONSULTAS = {
  vistasEscribibles: `
    SELECT c.relname AS objeto, string_agg(DISTINCT g.grantee || ':' || g.privilege_type, ', ') AS permisos
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN information_schema.views v ON v.table_schema = 'public' AND v.table_name = c.relname
      JOIN information_schema.role_table_grants g ON g.table_schema = 'public' AND g.table_name = c.relname
     WHERE c.relkind = 'v'
       AND NOT coalesce((SELECT bool_or(o = 'security_invoker=true' OR o = 'security_invoker=on') FROM unnest(c.reloptions) o), false)
       AND (v.is_updatable = 'YES' OR v.is_insertable_into = 'YES')
       AND g.grantee IN ('anon', 'authenticated')
       AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
     GROUP BY c.relname ORDER BY 1`,
  tablasSinRls: `
    SELECT c.relname AS objeto, string_agg(DISTINCT g.grantee || ':' || g.privilege_type, ', ') AS permisos
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN information_schema.role_table_grants g ON g.table_schema = 'public' AND g.table_name = c.relname
     WHERE c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
       AND g.grantee IN ('anon', 'authenticated')
     GROUP BY c.relname ORDER BY 1`,
  truncate: `
    SELECT c.relname AS objeto, string_agg(DISTINCT g.grantee, ', ') AS permisos
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN information_schema.role_table_grants g ON g.table_schema = 'public' AND g.table_name = c.relname
     WHERE c.relkind IN ('r', 'p') AND g.grantee IN ('anon', 'authenticated') AND g.privilege_type = 'TRUNCATE'
     GROUP BY c.relname ORDER BY 1`,
};

const TITULOS = {
  vistasEscribibles: "Vistas definer que anon/authenticated pueden escribir",
  tablasSinRls: "Tablas sin RLS con permisos para anon/authenticated",
  truncate: "Tablas con TRUNCATE para anon/authenticated",
};

async function main() {
  const url = process.env.SIMULACRO_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!esLocal(url)) { console.error("::error::La auditoría corre sólo contra una base local."); process.exitCode = 1; return; }
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  let total = 0;
  try {
    for (const [clave, sql] of Object.entries(CONSULTAS)) {
      const { rows } = await db.query(sql);
      total += rows.length;
      console.log(`\n${TITULOS[clave]}: ${rows.length}`);
      for (const r of rows) console.log(`  - ${r.objeto} (${r.permisos})`);
    }
  } finally {
    await db.end();
  }
  if (total && !process.argv.includes("--informe")) {
    console.log(`::error title=Auditoría de permisos::${total} hallazgos`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
