/**
 * Migraciones pendientes: simulacro en orden y, si todas dan OK, aplicación.
 *
 * Nace del 2026-10-22: con la base productiva inactiva se acumularon varias
 * migraciones escritas y probadas sólo localmente. Aplicarlas a mano una por
 * una al volver la base es donde se cuela un error. Este script:
 *
 *   1. Lee qué versiones ya figuran en supabase_migrations.schema_migrations.
 *   2. Para cada pendiente con matriz en MATRICES, en orden: BEGIN, las
 *      pendientes anteriores, la migración (sin su BEGIN/COMMIT), su matriz.
 *      La matriz termina en RAISE EXCEPTION 'OK …' y todo se revierte.
 *   3. Sin `--aplicar` termina ahí (simulacro, no escribe nada).
 *   4. Con `--aplicar` y TODAS en OK: aplica cada una en su transacción y la
 *      registra en schema_migrations. Si una falla, se detiene.
 *
 * Una migración pendiente sin matriz no se aplica: se lista y se frena.
 *
 * Uso:
 *   node scripts/migraciones-pendientes.mjs            # simulacro
 *   node scripts/migraciones-pendientes.mjs --aplicar  # aplica si todo dio OK
 *
 * Misma conexión y TLS que scripts/db.mjs (SUPABASE_DB_URL, SUPABASE_CA_CERT o
 * PGSSL_INSECURE=1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

/** Migración → su matriz de simulacro. */
export const MATRICES = {
  '20261021000100': 'scripts/comprobantes-de-compra-matrix.sql',
  '20261022000100': 'scripts/certificado-propio-matrix.sql',
  '20261022000200': 'scripts/certificados-staff-matrix.sql',
  '20261022000300': 'scripts/retenciones-sufridas-matrix.sql',
  '20261022000400': 'scripts/remitos-matrix.sql',
  '20261022000500': 'scripts/comision-solo-tienda-matrix.sql',
  '20261022000600': 'scripts/comprobante-completo-matrix.sql',
  '20261022000700': 'scripts/factura-credito-mipyme-matrix.sql',
  '20261022000800': 'scripts/percepciones-automaticas-matrix.sql',
  '20261022000900': 'scripts/caea-contingencia-matrix.sql',
  '20261022001000': 'scripts/iibb-coeficiente-matrix.sql',
  '20261022001100': 'scripts/factura-exportacion-matrix.sql',
};

const DIR = 'supabase/migrations';

/** El cuerpo de la migración sin su BEGIN/COMMIT de nivel superior. */
export function cuerpoDeMigracion(texto) {
  return texto.split('\n').filter(l => !/^\s*(BEGIN|COMMIT)\s*;\s*$/i.test(l)).join('\n');
}

export function migracionesLocales(dir = DIR) {
  return readdirSync(dir)
    .filter(f => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map(f => ({ version: f.slice(0, 14), nombre: f.slice(15, -4), archivo: `${dir}/${f}` }));
}

function conexion() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) { console.error('Falta SUPABASE_DB_URL.'); process.exit(2); }
  let ssl = { rejectUnauthorized: true };
  if (process.env.SUPABASE_CA_CERT) ssl = { ca: readFileSync(process.env.SUPABASE_CA_CERT, 'utf8'), rejectUnauthorized: true };
  else if (process.env.PGSSL_INSECURE === '1') ssl = { rejectUnauthorized: false };
  return new pg.Client({ connectionString: url, ssl });
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const client = conexion();
  try {
    await client.connect();
  } catch (e) {
    console.error(`La base no responde (${e.code ?? e.message}). ¿Ya se restauró el proyecto en Supabase?`);
    process.exitCode = 2;
    return;
  }
  try {
    const { rows } = await client.query('SELECT version FROM supabase_migrations.schema_migrations');
    const aplicadas = new Set(rows.map(r => r.version));
    // Sólo se miran las del rango con matriz o posteriores a la última aplicada.
    const ultima = [...aplicadas].sort().at(-1) ?? '';
    const pendientes = migracionesLocales().filter(m => !aplicadas.has(m.version) && (m.version > ultima || MATRICES[m.version]));
    if (pendientes.length === 0) { console.log('No hay migraciones pendientes.'); return; }

    const sinMatriz = pendientes.filter(m => !MATRICES[m.version]);
    if (sinMatriz.length) {
      console.error('Pendientes sin matriz (no se aplican):');
      for (const m of sinMatriz) console.error(`  ${m.version}_${m.nombre}`);
      process.exitCode = 1;
      return;
    }

    let todasOk = true;
    for (let i = 0; i < pendientes.length; i++) {
      const anteriores = pendientes.slice(0, i).map(m => cuerpoDeMigracion(readFileSync(m.archivo, 'utf8'))).join('\n');
      const actual = cuerpoDeMigracion(readFileSync(pendientes[i].archivo, 'utf8'));
      const matriz = readFileSync(MATRICES[pendientes[i].version], 'utf8').replace(/^\s*ROLLBACK\s*;\s*$/gim, '');
      let resultado;
      try {
        await client.query(`BEGIN;\n${anteriores}\n${actual}\n${matriz}`);
        resultado = 'FALLA: la matriz no terminó en OK';
      } catch (e) {
        resultado = String(e.message ?? e);
      } finally {
        await client.query('ROLLBACK').catch(() => {});
      }
      const ok = /^OK\b/.test(resultado);
      todasOk &&= ok;
      console.log(`${ok ? '✓' : '✗'} ${pendientes[i].version}_${pendientes[i].nombre}: ${resultado}`);
    }

    if (!aplicar) { console.log(todasOk ? '\nSimulacro OK. Para aplicar: --aplicar' : '\nHay fallas: no se aplica nada.'); return; }
    if (!todasOk) { console.error('\nHay fallas en el simulacro: no se aplica nada.'); process.exitCode = 1; return; }

    for (const m of pendientes) {
      const texto = readFileSync(m.archivo, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(cuerpoDeMigracion(texto));
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING',
          [m.version, m.nombre, [texto]],
        );
        await client.query('COMMIT');
        console.log(`aplicada ${m.version}_${m.nombre}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`✗ no se aplicó ${m.version}_${m.nombre}: ${e.message}. Las anteriores quedaron aplicadas; ésta y las siguientes no.`);
        process.exitCode = 1;
        return;
      }
    }
    console.log('\nListo. Falta desplegar las funciones afectadas (afip-credentials, afip-platform-cert, afip-authorize).');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/migraciones-pendientes.mjs')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
