// Mide cuánto tiempo la API devuelve error mientras PostgREST recarga el
// esquema, que es lo que pasa después de cada migración (event trigger
// pgrst_ddl_watch). Pide la tienda pública cada 200 ms durante 20 s y a los
// 2 s dispara `NOTIFY pgrst, 'reload schema'`.
// La URL y la clave pública (anon, la misma que va en el sitio) salen del vault.
//   node scripts/recarga-de-esquema-medir.mjs [slug]
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Falta SUPABASE_DB_URL'); process.exit(1); }
const slug = process.argv[2] ?? 'exentryimports';
const c = new pg.Client({ connectionString: url });
await c.connect();
const { rows } = await c.query(
  "select name, decrypted_secret v from vault.decrypted_secrets where name in ('SUPABASE_URL', 'SUPABASE_ANON_KEY')",
);
const base = rows.find(r => r.name === 'SUPABASE_URL')?.v;
const anon = rows.find(r => r.name === 'SUPABASE_ANON_KEY')?.v;
if (!base || !anon) { console.error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en el vault'); process.exit(1); }

const resultados = [];
const inicio = Date.now();
let recargado = false;
while (Date.now() - inicio < 20_000) {
  if (!recargado && Date.now() - inicio > 2_000) {
    await c.query("NOTIFY pgrst, 'reload schema'");
    recargado = Date.now() - inicio;
  }
  const t = Date.now();
  let status;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/get_store_by_slug`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
      signal: AbortSignal.timeout(10_000),
    });
    status = r.status;
    await r.text();
  } catch (e) {
    status = 'error de red';
  }
  resultados.push({ ms: t - inicio, status, dur: Date.now() - t });
  await new Promise(r => setTimeout(r, 200));
}
await c.end();
const malos = resultados.filter(r => r.status !== 200);
console.log(`recarga disparada a los ${recargado} ms; ${resultados.length} pedidos, ${malos.length} con error`);
if (malos.length) console.log(`errores entre ${malos[0].ms} ms y ${malos.at(-1).ms} ms:`, [...new Set(malos.map(m => m.status))].join(', '));
console.log('más lentos:', resultados.sort((a, b) => b.dur - a.dur).slice(0, 3).map(r => `${r.dur} ms (a los ${r.ms})`).join(' · '));
