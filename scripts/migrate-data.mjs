/**
 * migrate-data.mjs
 * Lee todos los datos del proyecto Lovable y los inserta en el proyecto real.
 *
 * USO:
 *   node scripts/migrate-data.mjs
 *
 * REQUISITOS:
 *   npm install @supabase/supabase-js
 *
 * CONFIGURAR las 4 variables de entorno antes de correr:
 *   SOURCE_URL        → URL del proyecto Lovable  (ej: https://abc.supabase.co)
 *   SOURCE_KEY        → service_role key del proyecto Lovable
 *   DEST_URL          → URL del proyecto real     (ej: https://wcfohngxrtopgggumjmw.supabase.co)
 *   DEST_KEY          → service_role key del proyecto real
 *
 * Podés setearlas en la misma línea:
 *   SOURCE_URL=... SOURCE_KEY=... DEST_URL=... DEST_KEY=... node scripts/migrate-data.mjs
 */

import { createClient } from "@supabase/supabase-js";

// ── Configuración ────────────────────────────────────────────────────────────
const SOURCE_URL = process.env.SOURCE_URL;
const SOURCE_KEY = process.env.SOURCE_KEY; // service_role del proyecto Lovable
const DEST_URL   = process.env.DEST_URL   ?? "https://wcfohngxrtopgggumjmw.supabase.co";
const DEST_KEY   = process.env.DEST_KEY;   // service_role del proyecto real

if (!SOURCE_URL || !SOURCE_KEY || !DEST_URL || !DEST_KEY) {
  console.error(`
❌  Faltan variables de entorno. Configurá las 4 antes de correr:

  SOURCE_URL=https://<lovable-ref>.supabase.co \\
  SOURCE_KEY=<service_role_lovable> \\
  DEST_URL=https://wcfohngxrtopgggumjmw.supabase.co \\
  DEST_KEY=<service_role_real> \\
  node scripts/migrate-data.mjs
`);
  process.exit(1);
}

const src  = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false } });
const dest = createClient(DEST_URL,   DEST_KEY,   { auth: { persistSession: false } });

// ── Tablas a migrar (en orden respetando FK) ─────────────────────────────────
// Si una tabla no existe en origen/destino se saltea sin error.
const TABLES = [
  "organizations",
  "memberships",
  "profiles",
  "plans",
  "subscriptions",
  "settings",
  "products",
  "product_variants",
  "suppliers",
  "purchases",
  "sales",
  "debts",
  "expenses",
  "quotes",
  "quote_sequences",
  "customers",
  "customer_notes",
  "notifications",
  "audit_logs",
  "marketing_posts",
  "influencer_exchanges",
  "loyalty_points",
  "marketing_templates",
  "payment_links",
  "presupuestos",
  "bank_transactions",
  "cheques",
  "cuotas",
  "tasks",
  "deals",
  "referrals",
  "seller_payouts",
  "stock_history",
  "price_history",
  "cash_sessions",
  "cash_entries",
  "financial_movements",
  "customer_payments",
  "tiendanube_connections",
  "webhook_deliveries",
  "automation_flows",
];

const BATCH = 500; // filas por insert

// ── Helper: leer tabla completa con paginación ────────────────────────────────
async function readAll(table) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await src
      .from(table)
      .select("*")
      .range(from, from + BATCH - 1);
    if (error) {
      if (error.code === "42P01") return null; // tabla no existe en origen
      throw new Error(`[${table}] read error: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return rows;
}

// ── Helper: insertar en lotes ─────────────────────────────────────────────────
async function insertAll(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await dest
      .from(table)
      .upsert(chunk, { onConflict: "id", ignoreDuplicates: false });
    if (error) {
      if (error.code === "42P01") {
        console.warn(`  ⚠️  tabla '${table}' no existe en destino — saltando`);
        return 0;
      }
      throw new Error(`[${table}] insert error: ${error.message}`);
    }
  }
  return rows.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function migrate() {
  console.log("🚀  Iniciando migración de datos...\n");
  console.log(`  Origen:  ${SOURCE_URL}`);
  console.log(`  Destino: ${DEST_URL}\n`);

  const results = [];

  for (const table of TABLES) {
    process.stdout.write(`  📋  ${table.padEnd(35)}`);
    try {
      const rows = await readAll(table);
      if (rows === null) {
        console.log("— no existe en origen");
        continue;
      }
      if (rows.length === 0) {
        console.log("0 filas");
        continue;
      }
      const inserted = await insertAll(table, rows);
      console.log(`✅  ${inserted} filas`);
      results.push({ table, rows: inserted });
    } catch (err) {
      console.log(`❌  ${err.message}`);
      results.push({ table, error: err.message });
    }
  }

  console.log("\n─────────────────────────────────────────");
  const ok  = results.filter(r => !r.error);
  const err = results.filter(r =>  r.error);
  console.log(`✅  ${ok.length} tablas migradas — ${ok.reduce((s,r)=>s+r.rows,0)} filas totales`);
  if (err.length) {
    console.log(`❌  ${err.length} errores:`);
    err.forEach(r => console.log(`    ${r.table}: ${r.error}`));
  }
  console.log("\n⚠️  Nota: los usuarios (auth.users) NO se migran con este script.");
  console.log("   Para migrarlos necesitás contactar a Supabase Support o usar la Admin API.\n");
}

migrate().catch(e => { console.error(e); process.exit(1); });
