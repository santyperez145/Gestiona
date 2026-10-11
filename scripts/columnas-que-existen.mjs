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
console.log([...hallazgos].sort().join('\n'));
console.log('total', hallazgos.size);
