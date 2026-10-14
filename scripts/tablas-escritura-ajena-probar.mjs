// Auditoría de RLS por escritura: con un usuario real de un negocio, intenta
// modificar (UPDATE org_id = org_id) y borrar filas de OTROS negocios en cada
// tabla con `org_id`. Todo en transacciones que se revierten: nada queda
// cambiado. Cualquier fila afectada es un agujero.
//   node scripts/tablas-escritura-ajena-probar.mjs [nombre del negocio]
// Tarda unos 12 minutos (DELETE recorre las cascadas). Al 2026-10-13: 345
// tablas, 0 hallazgos.
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
  where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
  order by 1`);

const agujeros = [];
for (const { table_name: t } of tablas) {
  const tabla = t.replace(/[^a-z0-9_]/g, '');
  for (const [que, sql] of [
    ['UPDATE', `update public.${tabla} set org_id = org_id where org_id is not null and not public.is_org_member(org_id, auth.uid())`],
    ['DELETE', `delete from public.${tabla} where org_id is not null and not public.is_org_member(org_id, auth.uid())`],
  ]) {
    await c.query('begin');
    try {
      await c.query('select set_config($$request.jwt.claims$$, $1, true)', [JSON.stringify({ sub: u.user_id, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      await c.query('set local statement_timeout = 8000');
      const r = await c.query(sql);
      if (r.rowCount > 0) agujeros.push(`${tabla.padEnd(40)} ${que}: ${r.rowCount} fila(s) ajenas`);
    } catch (e) {
      if (!/permission denied|violates row-level/i.test(e.message)) agujeros.push(`${tabla.padEnd(40)} ${que}: error ${e.message.slice(0, 70)}`);
    }
    await c.query('rollback');
  }
}
await c.end();
console.log(agujeros.join('\n'));
console.log(`\n${tablas.length} tablas revisadas, ${agujeros.length} hallazgo(s)`);
