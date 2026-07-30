#!/usr/bin/env node
/**
 * Runner de SQL contra la base de Supabase.
 *
 * Existe porque `supabase db push` no sirve en este repo: hay cuatro grupos de
 * migraciones que comparten prefijo de versión (20260506, 20260507,
 * 20260519000001, 20260523000006) y el CLI usa ese prefijo como clave. Las
 * migraciones se aplican pegando SQL, y sin poder ejecutarlo se escribieron tres
 * scripts con errores que sólo aparecen al correrlos.
 *
 * Uso:
 *   node scripts/db.mjs --file supabase/00_diagnostico.sql
 *   node scripts/db.mjs --sql "select count(*) from products"
 *   node scripts/db.mjs --file supabase/01_aplicar_pendientes.sql --allow-destructive
 *
 * La credencial se lee de la variable de entorno SUPABASE_DB_URL y NUNCA se
 * imprime: los errores de conexión se reportan sin el string. Si algún día hay
 * que debuggear la URL, se mira en el entorno, no en la salida de esto.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const ENV_VAR = 'SUPABASE_DB_URL';

// ── Guardas de seguridad ────────────────────────────────────────────────────

/**
 * Sentencias que pueden destruir datos. No se corren sin `--allow-destructive`.
 *
 * `DROP FUNCTION`, `DROP POLICY` y `DROP VIEW` quedan afuera a propósito: son
 * parte normal de un `CREATE OR REPLACE` idempotente y no borran datos. Lo que
 * se vigila es lo que se lleva filas o columnas puestas.
 */
const DESTRUCTIVE = [
  { re: /\bDROP\s+TABLE\b/i,            que: 'DROP TABLE' },
  { re: /\bDROP\s+SCHEMA\b/i,           que: 'DROP SCHEMA' },
  { re: /\bDROP\s+DATABASE\b/i,         que: 'DROP DATABASE' },
  { re: /\bTRUNCATE\b/i,                que: 'TRUNCATE' },
  { re: /\bALTER\s+TABLE\b[\s\S]{0,200}?\bDROP\s+COLUMN\b/i, que: 'DROP COLUMN' },
  // DELETE sin WHERE: se lleva la tabla entera
  { re: /\bDELETE\s+FROM\s+[^;]*?;/i,   que: 'DELETE', necesitaWhere: true },
];

/** Saca comentarios para no marcar una palabra que sólo aparece explicada. */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
}

function findDestructive(sql) {
  const limpio = stripSqlComments(sql);
  const hallado = [];
  for (const d of DESTRUCTIVE) {
    const m = limpio.match(d.re);
    if (!m) continue;
    if (d.necesitaWhere && /\bWHERE\b/i.test(m[0])) continue;
    hallado.push(d.que);
  }
  return [...new Set(hallado)];
}

// ── Argumentos ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { file: null, sql: null, allowDestructive: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--sql') args.sql = argv[++i];
    else if (argv[i] === '--allow-destructive') args.allowDestructive = true;
    else {
      console.error(`Argumento desconocido: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

// ── Salida ──────────────────────────────────────────────────────────────────

function printResult(res, index, total) {
  const etiqueta = total > 1 ? `[${index + 1}/${total}] ` : '';

  if (res.command && !res.rows?.length) {
    console.log(`${etiqueta}${res.command}${res.rowCount != null ? ` — ${res.rowCount} fila(s)` : ''}`);
    return;
  }
  if (!res.rows?.length) {
    console.log(`${etiqueta}sin filas`);
    return;
  }

  const cols = Object.keys(res.rows[0]);
  const ancho = {};
  for (const c of cols) {
    ancho[c] = Math.max(
      c.length,
      ...res.rows.map(r => String(r[c] ?? '—').length),
    );
    ancho[c] = Math.min(ancho[c], 60);
  }
  const linea = (celdas) => celdas.map((v, i) => String(v).padEnd(ancho[cols[i]])).join('  ');

  console.log(`${etiqueta}${res.rows.length} fila(s):`);
  console.log('  ' + linea(cols));
  console.log('  ' + cols.map(c => '─'.repeat(ancho[c])).join('  '));
  for (const r of res.rows) {
    console.log('  ' + linea(cols.map(c => {
      const v = r[c] ?? '—';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.length > 60 ? s.slice(0, 57) + '...' : s;
    })));
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env[ENV_VAR];
  if (!url) {
    console.error(
      `Falta la variable de entorno ${ENV_VAR}.\n\n` +
      `Ponela como variable de USUARIO (no la pegues en un archivo del repo):\n` +
      `  [Environment]::SetEnvironmentVariable('${ENV_VAR}','postgresql://...','User')\n\n` +
      `La sacás de Supabase → Project Settings → Database → Connection string,\n` +
      `usando la de "Session pooler" (soporta DDL).`,
    );
    process.exit(2);
  }

  if (!args.file && !args.sql) {
    console.error('Falta --file <ruta.sql> o --sql "<consulta>"');
    process.exit(2);
  }

  const sql = args.file ? readFileSync(args.file, 'utf8') : args.sql;

  const peligros = findDestructive(sql);
  if (peligros.length && !args.allowDestructive) {
    console.error(
      `Este SQL contiene ${peligros.join(', ')} y puede borrar datos.\n` +
      `Si es intencional, volvé a correrlo con --allow-destructive.`,
    );
    process.exit(3);
  }
  if (peligros.length) {
    console.log(`⚠️  Corriendo con ${peligros.join(', ')} (--allow-destructive)\n`);
  }

  // TLS, de más seguro a menos:
  //
  //   1. SUPABASE_CA_CERT apuntando a la CA de Supabase → verificación real.
  //      Se descarga del dashboard (Database → SSL Configuration).
  //   2. Las CA del sistema. No alcanza para el pooler de Supabase, que está
  //      firmado con su propia CA: da "self-signed certificate in chain".
  //   3. PGSSL_INSECURE=1 → cifra pero NO verifica la identidad del servidor.
  //      Sigue siendo vulnerable a un intermediario que capture la contraseña.
  //      Es explícito a propósito, nunca un default silencioso.
  let ssl;
  const caPath = process.env.SUPABASE_CA_CERT;
  if (caPath) {
    try {
      ssl = { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
    } catch (e) {
      console.error(`No pude leer el certificado en ${caPath}: ${e.message}`);
      process.exit(2);
    }
  } else if (process.env.PGSSL_INSECURE === '1') {
    console.warn(
      '⚠️  Conectando sin verificar el certificado del servidor. ' +
      'Para verificarlo de verdad, poné SUPABASE_CA_CERT apuntando a prod-ca-2021.crt.',
    );
    ssl = { rejectUnauthorized: false };
  } else {
    ssl = { rejectUnauthorized: true };
  }

  const client = new pg.Client({
    connectionString: url,
    ssl,
    // Un DDL grande puede tardar; sin esto se corta a los 30s por default.
    statement_timeout: 180_000,
  });

  try {
    await client.connect();
  } catch (e) {
    // Sin el connection string en el mensaje: puede llevar la contraseña.
    console.error(`No se pudo conectar: ${e.message}`);
    if (/self signed|certificate/i.test(e.message)) {
      console.error('Parece un problema de certificado. Probá con PGSSL_INSECURE=1 si confiás en la red.');
    }
    process.exit(1);
  }

  try {
    const res = await client.query(sql);
    const results = Array.isArray(res) ? res : [res];
    results.forEach((r, i) => {
      printResult(r, i, results.length);
      if (i < results.length - 1) console.log('');
    });
    console.log('\n✓ Listo');
  } catch (e) {
    console.error(`\n✗ Error SQL: ${e.message}`);
    if (e.position) console.error(`  posición: ${e.position}`);
    if (e.hint) console.error(`  pista: ${e.hint}`);
    if (e.where) console.error(`  contexto: ${e.where}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
