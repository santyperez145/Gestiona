// Auditoría de RLS: con un usuario real de un negocio, cuenta cuántas filas
// de OTROS negocios puede leer en cada tabla con `org_id`. Sólo lectura, en
// una transacción que se revierte. Cualquier número > 0 es una fuga, salvo
// las tablas públicas a propósito (catálogo publicado de la tienda, etc.),
// que se listan aparte para revisarlas a mano.
//   node scripts/tablas-lectura-ajena-probar.mjs [nombre del negocio]
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Falta SUPABASE_DB_URL'); process.exit(1); }
const negocio = process.argv[2] ?? 'famatina';
const c = new pg.Client({ connectionString: url });
await c.connect();

const { rows: [u] } = await c.query(
  'select m.user_id from organizations o join memberships m on m.org_id = o.id where o.name ilike $1 limit 1',
  [`%${negocio}%`],
);
if (!u) { console.error('No encontré ese negocio'); process.exit(1); }
const { rows: tablas } = await c.query(`
  select c.table_name from information_schema.columns c
  join information_schema.tables t using (table_schema, table_name)
  where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type in ('BASE TABLE', 'VIEW')
  order by 1`);

const fugas = [];
await c.query('begin');
await c.query('select set_config($$request.jwt.claims$$, $1, true)', [JSON.stringify({ sub: u.user_id, role: 'authenticated' })]);
await c.query('set local role authenticated');
await c.query('set local statement_timeout = 8000');
for (const { table_name: t } of tablas) {
  await c.query('savepoint s');
  try {
    const { rows: [r] } = await c.query(
      `select count(*)::int n, count(distinct org_id)::int orgs from public.${JSON.stringify(t).slice(1, -1).replace(/[^a-z0-9_]/g, '')}
        where org_id is not null and not public.is_org_member(org_id, auth.uid())`,
    );
    if (r.n > 0) fugas.push({ tabla: t, filas: r.n, negocios: r.orgs });
  } catch (e) {
    if (!/permission denied/i.test(e.message)) fugas.push({ tabla: t, error: e.message.slice(0, 80) });
  }
  await c.query('rollback to savepoint s');
}
await c.query('rollback');
await c.end();
for (const f of fugas) console.log(f.tabla.padEnd(40), f.error ?? `${f.filas} filas de ${f.negocios} negocio(s) ajeno(s)`);
console.log(`\n${tablas.length} tablas/vistas revisadas, ${fugas.length} con lectura ajena`);
