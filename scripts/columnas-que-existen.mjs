// Barrido: cada .from("tabla") del front y de las funciones con sus
// .select/.eq/.in/.order contra las columnas reales de la base. Una columna
// que no existe hace fallar la consulta —muchas veces en silencio—; así se
// encontraron la alerta de deuda vencida y la lista de contratos de Creators
// (2026-10-11). Uso: node scripts/columnas-que-existen.mjs "$(pwd)"
// (necesita SUPABASE_DB_URL, sólo lee information_schema).
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
const raiz = process.argv[2];
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`select table_name, column_name from information_schema.columns where table_schema='public'`);
const cols = new Map();
for (const x of r.rows) { if (!cols.has(x.table_name)) cols.set(x.table_name, new Set()); cols.get(x.table_name).add(x.column_name); }
const rf = await c.query(`select p.proname, array_agg(coalesce(a, '')) args
  from pg_proc p left join lateral unnest(p.proargnames) a on true
  where p.pronamespace = 'public'::regnamespace group by p.proname`);
const funcs = new Map(rf.rows.map(x => [x.proname, new Set(x.args)]));
await c.end();
function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) { if (!/node_modules|[\\/]test|integrations/.test(p)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(raiz, 'supabase', 'functions')), ...walk(path.join(raiz, 'src'))];
const hallazgos = new Set();
const reFrom = /\.from\(\s*["'`]([a-z_0-9]+)["'`]\s*(?:as never)?\s*\)([\s\S]{0,600}?)(?:;|\n\s*\n)/g;
const reFiltro = /\.(?:eq|neq|gt|gte|lt|lte|in|is|order|not|like|ilike|contains)\(\s*["'`]([a-z_0-9]+)["'`]/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(reFrom)) {
    const tabla = m[1];
    const chain = m[2].split(/\.from\(|\)\s*,\s*\n|\]\)|await /)[0];
    const set = cols.get(tabla);
    if (!set) continue;
    const nombres = [];
    for (const s of chain.matchAll(reFiltro)) nombres.push(s[1]);
    const sel = chain.match(/\.select\(\s*["'`]([^"'`]*)["'`]/);
    if (sel && !sel[1].includes('(') && sel[1].trim() !== '*') {
      for (const p of sel[1].split(',')) {
        const n = p.trim().split(':').pop().trim().split(' ')[0];
        if (/^[a-z_0-9]+$/.test(n)) nombres.push(n);
      }
    }
    for (const n of nombres) if (!set.has(n)) hallazgos.add(path.relative(raiz, f).split(path.sep).join('/') + ' :: ' + tabla + '.' + n);
  }
}
// Funciones: .rpc("nombre", { p_… }) contra pg_proc. Los respaldos de
// despliegue (sólo corren si falta la función nueva) también aparecen.
// Respaldos a propósito: sólo corren si falta la función nueva (regla del
// repo: el cliente no depende de migraciones sin aplicar). Ver
// storeOrderAccessControl.test.ts.
const RESPALDOS_DE_DESPLIEGUE = new Set(['get_store_order']);
const reRpc = /\.rpc\(\s*["'`]([a-z_0-9]+)["'`]\s*(?:as never)?\s*(?:,\s*\{([^}]*)\})?/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(reRpc)) {
    const rel = path.relative(raiz, f).split(path.sep).join('/');
    if (!funcs.has(m[1])) { if (RESPALDOS_DE_DESPLIEGUE.has(m[1])) continue; hallazgos.add(rel + ' :: ' + m[1] + '() no existe'); continue; }
    for (const k of (m[2] ?? '').matchAll(/(?:^|[,\s{])(p_[a-z_0-9]+)\s*:/g)) {
      if (!funcs.get(m[1]).has(k[1])) hallazgos.add(rel + ' :: ' + m[1] + '(' + k[1] + ') no es parámetro');
    }
  }
}
console.log([...hallazgos].sort().join('\n'));
console.log('total', hallazgos.size);
