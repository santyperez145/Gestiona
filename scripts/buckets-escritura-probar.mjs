// Auditoría de storage: con un usuario real de un negocio, intenta subir a
// cada bucket en su carpeta, en la de otro negocio, en una ruta suelta y en
// la carpeta de su usuario. Todo en transacciones que se revierten. Lo que
// diga «PUEDE» en «ajena» o «suelta» es un agujero.
// Así se encontraron marketing-images y product-images abiertos (2026-10-13).
//   node scripts/buckets-escritura-probar.mjs [nombre del negocio]
import pg from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Falta SUPABASE_DB_URL'); process.exit(1); }
const negocio = process.argv[2] ?? 'famatina';
const c = new pg.Client({ connectionString: url });
await c.connect();

const { rows: [u] } = await c.query(
  'select m.user_id, o.id org from organizations o join memberships m on m.org_id = o.id where o.name ilike $1 limit 1',
  [`%${negocio}%`],
);
if (!u) { console.error('No encontré ese negocio'); process.exit(1); }
const { rows: [otra] } = await c.query(
  'select id from organizations where id <> $1 and not is_org_member(id, $2) limit 1', [u.org, u.user_id],
);
const { rows: buckets } = await c.query('select id from storage.buckets order by 1');

let agujeros = 0;
for (const { id: bucket } of buckets) {
  const casos = [['propia', `${u.org}/zz/x.png`], ['ajena', `${otra.id}/zz/x.png`], ['suelta', 'zz/x.png'], ['usuario', `${u.user_id}/x.png`]];
  const fila = [];
  for (const [que, ruta] of casos) {
    await c.query('begin');
    try {
      await c.query('select set_config($$request.jwt.claims$$, $1, true)', [JSON.stringify({ sub: u.user_id, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      await c.query('insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)', [bucket, ruta, u.user_id]);
      fila.push(`${que}: PUEDE`);
      if (que === 'ajena' || que === 'suelta') agujeros += 1;
    } catch {
      fila.push(`${que}: no`);
    }
    await c.query('rollback');
  }
  console.log(bucket.padEnd(22), fila.join('  '));
}
await c.end();
console.log(agujeros ? `\n${agujeros} agujero(s)` : '\nSin agujeros');
process.exit(agujeros ? 1 : 0);
