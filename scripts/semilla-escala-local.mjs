// Semilla de escala para el E2E local: suma 5.500 productos con costo en
// dólares al negocio de prueba, como el catálogo de Famatina. La corre
// `e2e-local.yml` antes de `e2e/escala-catalogo.spec.ts`, después del resto
// de los specs (cambia precios y stock).
//
// Deja en e2e/.auth/escala.json el negocio y los productos, para que el spec
// precargue una toma completa en el borrador local de la pantalla (lo mismo
// que encuentra quien retoma un conteo a medias).
//
// Uso: SIMULACRO_DB_URL=… node scripts/semilla-escala-local.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { esLocal } from "./simulacro-local.mjs";
import { SLUG } from "./semilla-e2e-local.mjs";

export const CANTIDAD = 5500;
export const CATEGORIA = "zz-escala";
export const ARCHIVO = "e2e/.auth/escala.json";

async function main() {
  const db = process.env.SIMULACRO_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!esLocal(db)) { console.error("::error::La semilla corre sólo contra una base local."); process.exitCode = 1; return; }

  const c = new pg.Client({ connectionString: db });
  await c.connect();
  try {
    const { rows: [org] } = await c.query(`SELECT id, owner_user_id FROM public.organizations WHERE slug = $1`, [SLUG]);
    if (!org) { console.error(`::error::No está el negocio de prueba (${SLUG}): corré antes semilla-e2e-local.mjs.`); process.exitCode = 1; return; }
    const { rows } = await c.query(
      `INSERT INTO public.products (org_id, user_id, name, category, cost_usd, sale_price_ars, stock, sku)
       SELECT $1, $2, 'ZZ Escala ' || lpad(g::text, 4, '0'), $3, 10, 1, 10, 'ZZ-ESC-' || g
         FROM generate_series(1, $4::int) g
       RETURNING id`, [org.id, org.owner_user_id, CATEGORIA, CANTIDAD]);
    mkdirSync("e2e/.auth", { recursive: true });
    writeFileSync(ARCHIVO, JSON.stringify({ org_id: org.id, productos: rows.map(r => r.id) }));
    console.log(`${rows.length} productos de escala en ${SLUG}.`);
  } finally {
    await c.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`::error::${e.message}`); process.exitCode = 1; });
}
