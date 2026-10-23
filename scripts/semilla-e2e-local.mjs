/**
 * Semilla para el E2E contra un Supabase local (2026-10-23).
 *
 * Con la base reconstruida por `reproducir-migraciones.mjs`, crea lo mínimo
 * para que el panel funcione con datos: un usuario (por la API de Auth, como
 * uno real), su negocio con el alta terminada, productos, un cliente y la
 * identidad fiscal en homologación. Escribe en $GITHUB_ENV las variables que
 * usa Playwright (E2E_USER, E2E_PASSWORD, E2E_STORE_SLUG); la contraseña es
 * aleatoria y nunca se imprime.
 *
 * Uso: SIMULACRO_DB_URL=… SUPABASE_LOCAL_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_KEY=… node scripts/semilla-e2e-local.mjs
 * Nunca contra producción: se niega si las URL no son locales.
 */
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { esLocal } from "./simulacro-local.mjs";

export const EMAIL = "e2e@nerqia.test";
export const SLUG = "zz-e2e";

/** Catálogo de prueba: nombres, precios y stock fijos para que los specs los busquen. */
export const PRODUCTOS = [
  { name: "ZZ Tornillo 8x40", price: 120, cost: 60, stock: 500, sku: "ZZ-TOR-840" },
  { name: "ZZ Martillo carpintero", price: 18500, cost: 9200, stock: 12, sku: "ZZ-MAR-001" },
  { name: "ZZ Cable 2,5 mm", price: 950, cost: 480, stock: 300, sku: "ZZ-CAB-25" },
  { name: "ZZ Pintura látex 4 L", price: 32000, cost: 19000, stock: 0, sku: "ZZ-PIN-4L" },
];

async function main() {
  const db = process.env.SIMULACRO_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const api = process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321";
  const service = process.env.SUPABASE_SERVICE_KEY;
  if (!esLocal(db) || !esLocal(api)) { console.error("::error::La semilla corre sólo contra una base local."); process.exitCode = 1; return; }
  if (!service) { console.error("::error::Falta SUPABASE_SERVICE_KEY (la de `supabase status`)."); process.exitCode = 1; return; }

  const password = randomBytes(18).toString("base64url") + "Aa1";
  const res = await fetch(`${api}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password, email_confirm: true }),
  });
  const usuario = await res.json();
  if (!res.ok || !usuario.id) { console.error(`::error::No se creó el usuario de prueba: HTTP ${res.status} ${JSON.stringify(usuario).slice(0, 200)}`); process.exitCode = 1; return; }

  const c = new pg.Client({ connectionString: db });
  await c.connect();
  try {
    await c.query("BEGIN");
    const { rows: [org] } = await c.query(
      `INSERT INTO public.organizations (name, slug, owner_user_id, onboarding_completed, onboarding_goal)
       VALUES ('ZZ Ferretería E2E', $1, $2, true, 'pos') RETURNING id`, [SLUG, usuario.id]);
    await c.query(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`, [org.id, usuario.id]);
    for (const p of PRODUCTOS) {
      await c.query(
        `INSERT INTO public.products (org_id, user_id, name, sale_price_ars, cost_ars, stock, sku)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [org.id, usuario.id, p.name, p.price, p.cost, p.stock, p.sku]);
    }
    await c.query(
      `INSERT INTO public.customers (org_id, user_id, name, email, tax_id, tax_id_type, vat_condition, legal_name)
       VALUES ($1, $2, 'ZZ Obra Norte', 'obra@nerqia.test', '30712345671', 'CUIT', 'responsable_inscripto', 'ZZ OBRA NORTE SA')`, [org.id, usuario.id]);
    await c.query(
      `INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
       VALUES ($1, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ FERRETERIA SRL', 'Av. ZZ 123, CABA')
       ON CONFLICT (org_id) DO NOTHING`, [org.id]);
    await c.query("COMMIT");
    // PostgREST tiene que ver el esquema completo, no el de antes de las migraciones.
    await c.query("NOTIFY pgrst, 'reload schema'");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`::error::La semilla falló: ${e.message}${e.detail ? ` (${e.detail})` : ""}`);
    process.exitCode = 1;
    return;
  } finally {
    await c.end();
  }

  const salida = process.env.GITHUB_ENV;
  if (salida) {
    appendFileSync(salida, `E2E_USER=${EMAIL}\nE2E_PASSWORD=${password}\nE2E_STORE_SLUG=${SLUG}\n`);
    console.log(`::add-mask::${password}`);
  }
  console.log(`Semilla lista: ${EMAIL}, negocio ${SLUG}, ${PRODUCTOS.length} productos.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
