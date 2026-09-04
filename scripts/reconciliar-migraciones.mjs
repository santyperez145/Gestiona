#!/usr/bin/env node
/**
 * Reconcilia el libro de migraciones con lo que la base tiene de verdad.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Las migraciones de este repo se aplican con `db query --file`, que ejecuta el
 * SQL y **no toca** `supabase_migrations.schema_migrations`. Así que el libro
 * quedó muy atrás: al escribir esto, 281 archivos y 113 registradas.
 *
 * Eso no sería grave si no fuera porque el CLI usa el libro para decidir qué
 * correr. Con 168 sin registrar, `supabase db push` las correría **todas** —y
 * entre ellas está `20260723000003_drop_orphaned_feature_tables.sql`, que
 * dropea unas 75 tablas—. Por eso `db push` hoy es un comando que destruye la
 * base, y por eso está prohibido en CONTRIBUTING.md.
 *
 * Reconciliar = averiguar cuáles de esas 168 ya están aplicadas y anotarlas,
 * para que `db push` deje de verlas como pendientes.
 *
 * ── Cómo decide si una migración está aplicada ─────────────────────────────
 *
 * No hay registro de eso en ningún lado, así que se deduce mirando la base: se
 * extraen del archivo los objetos que crea (tablas, columnas, índices,
 * funciones, vistas, políticas, triggers, tipos) y se pregunta cuáles existen.
 *
 *   todos existen      → APLICADA
 *   ninguno existe     → NO APLICADA
 *   algunos            → PARCIAL      (a mano: puede ser una migración vieja
 *                                      que otra posterior deshizo)
 *   no se detectan     → INDETERMINADA (SQL dinámico dentro de DO/EXECUTE, que
 *                                      este análisis estático no puede leer)
 *
 * ── Lo que NO hace, a propósito ────────────────────────────────────────────
 *
 * **Nunca anota una migración destructiva**, aunque parezca aplicada. Un
 * archivo que dropea tablas se ve "aplicado" justamente cuando las tablas NO
 * están, que es la lectura inversa de todos los demás casos: si nunca corrió y
 * las tablas no existen por otro motivo, anotarla mentiría. Esas salen listadas
 * para revisar a mano.
 *
 * **Nunca aplica nada.** Sólo lee la base y, con `--registrar`, escribe filas
 * en el libro. No corre el SQL de ninguna migración.
 *
 * Uso:
 *   node scripts/reconciliar-migraciones.mjs              # informe, no escribe
 *   node scripts/reconciliar-migraciones.mjs --detalle    # + objetos faltantes
 *   node scripts/reconciliar-migraciones.mjs --registrar  # anota las APLICADAS
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DIR = 'supabase/migrations';
const ENV_VAR = 'SUPABASE_DB_URL';

// ── Lectura del SQL ─────────────────────────────────────────────────────────

/** Los comentarios explican lo que la migración hace; no son lo que hace. */
function sinComentarios(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/**
 * `public."Mi Tabla"` → `mi tabla`. Se descarta el esquema, sea cual sea: hay
 * migraciones que tocan `storage.objects`, y el inventario indexa por nombre
 * pelado. Dejar el prefijo puesto marcaba como NO APLICADA una migración que sí
 * había corrido, sólo porque el archivo decía `storage.objects` y el catálogo
 * `objects`.
 */
function ident(raw) {
  const s = raw.trim().replace(/^"(.*)"$/, '$1');
  const ultimo = s.split('.').pop() ?? s;
  return ultimo.replace(/^"(.*)"$/, '$1').toLowerCase();
}

/**
 * Objetos que el archivo crea, con el tipo que hay que ir a buscar.
 *
 * Se ignora todo lo que esté dentro de un bloque DO: ahí el SQL se arma con
 * `format()` en tiempo de ejecución y los nombres no están escritos en el
 * archivo. Buscar `%I` en el catálogo no encontraría nada y marcaría como NO
 * APLICADA una migración que sí corrió.
 */
function objetosQueCrea(sqlOriginal) {
  const sql = sinComentarios(sqlOriginal).replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ');
  const objs = [];
  const add = (tipo, nombre, extra) => {
    const n = ident(nombre);
    if (n && !n.includes('%')) objs.push({ tipo, nombre: n, extra: extra ? ident(extra) : null });
  };

  const re = (patron, fn) => {
    for (const m of sql.matchAll(patron)) fn(m);
  };

  re(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi, m => add('tabla', m[1]));
  re(/\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi, m => add('vista', m[1]));
  re(/\bCREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi, m => add('vista', m[1]));
  re(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi, m => add('indice', m[1]));
  re(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w".]+)\s*\(/gi, m => add('funcion', m[1]));
  re(/\bCREATE\s+TRIGGER\s+([\w".]+)/gi, m => add('trigger', m[1]));
  re(/\bCREATE\s+POLICY\s+("[^"]+"|[\w]+)\s+ON\s+([\w".]+)/gi, m => add('policy', m[1], m[2]));
  re(/\bCREATE\s+TYPE\s+([\w".]+)/gi, m => add('tipo', m[1]));
  re(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w".]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi,
     m => add('columna', m[2], m[1]));

  // Dedup: el mismo objeto puede aparecer dos veces (DROP + CREATE).
  const vistos = new Set();
  return objs.filter(o => {
    const k = `${o.tipo}:${o.extra ?? ''}:${o.nombre}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/**
 * ¿Este archivo borra cosas? Mismo criterio que la guarda de `scripts/db.mjs`:
 * lo que se lleva filas o columnas puestas. `DROP POLICY`/`FUNCTION`/`VIEW` no
 * cuentan — son parte normal de un `CREATE OR REPLACE` idempotente.
 */
function esDestructiva(sql) {
  const s = sinComentarios(sql);
  return /\bDROP\s+TABLE\b/i.test(s)
      || /\bDROP\s+SCHEMA\b/i.test(s)
      || /\bTRUNCATE\b/i.test(s)
      || /\bALTER\s+TABLE\b[\s\S]{0,200}?\bDROP\s+COLUMN\b/i.test(s);
}

// ── Inventario de la base ───────────────────────────────────────────────────

async function inventario(client) {
  const q = async (sql) => (await client.query(sql)).rows;

  const relaciones = await q(`
    SELECT c.relname AS n, c.relkind AS k
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'`);

  const columnas = await q(`
    SELECT table_name AS t, column_name AS c
    FROM information_schema.columns WHERE table_schema = 'public'`);

  const funciones = await q(`
    SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'`);

  const triggers = await q(`SELECT tgname AS n FROM pg_trigger WHERE NOT tgisinternal`);

  const policies = await q(`
    SELECT pol.polname AS n, c.relname AS t
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid`);

  const tipos = await q(`
    SELECT t.typname AS n FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = 'public'`);

  const porTipo = (kinds) => new Set(
    relaciones.filter(r => kinds.includes(r.k)).map(r => r.n.toLowerCase()));

  return {
    tabla:   porTipo(['r', 'p', 'f']),
    vista:   porTipo(['v', 'm']),
    indice:  porTipo(['i', 'I']),
    funcion: new Set(funciones.map(r => r.n.toLowerCase())),
    trigger: new Set(triggers.map(r => r.n.toLowerCase())),
    tipo:    new Set(tipos.map(r => r.n.toLowerCase())),
    columna: new Set(columnas.map(r => `${r.t.toLowerCase()}.${r.c.toLowerCase()}`)),
    policy:  new Set(policies.map(r => `${r.t.toLowerCase()}.${r.n.toLowerCase()}`)),
  };
}

function existe(inv, o) {
  if (o.tipo === 'columna') return inv.columna.has(`${o.extra}.${o.nombre}`);
  if (o.tipo === 'policy')  return inv.policy.has(`${o.extra}.${o.nombre}`);
  return inv[o.tipo]?.has(o.nombre) ?? false;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const registrar = argv.includes('--registrar');
  const detalle = argv.includes('--detalle');

  const url = process.env[ENV_VAR];
  if (!url) {
    console.error(`Falta ${ENV_VAR}. Ver "Acceso directo a la base" en CONTRIBUTING.md.`);
    process.exit(2);
  }

  const caPath = process.env.SUPABASE_CA_CERT;
  const ssl = caPath
    ? { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
    : { rejectUnauthorized: process.env.PGSSL_INSECURE !== '1' };

  const client = new pg.Client({ connectionString: url, ssl, statement_timeout: 180_000 });
  try {
    await client.connect();
  } catch (e) {
    console.error(`No se pudo conectar: ${e.message}`);   // sin la URL: lleva la contraseña
    process.exit(1);
  }

  try {
    const registradas = new Set(
      (await client.query('SELECT version FROM supabase_migrations.schema_migrations')).rows
        .map(r => r.version));

    const archivos = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
    const inv = await inventario(client);

    const grupos = { APLICADA: [], 'NO APLICADA': [], PARCIAL: [], INDETERMINADA: [], DESTRUCTIVA: [] };

    for (const f of archivos) {
      const version = f.split('_')[0];
      if (registradas.has(version)) continue;

      const sql = readFileSync(path.join(DIR, f), 'utf8');
      const objs = objetosQueCrea(sql);
      const faltan = objs.filter(o => !existe(inv, o));
      const fila = { version, f, total: objs.length, faltan };

      if (esDestructiva(sql))        grupos.DESTRUCTIVA.push(fila);
      else if (objs.length === 0)    grupos.INDETERMINADA.push(fila);
      else if (faltan.length === 0)  grupos.APLICADA.push(fila);
      else if (faltan.length === objs.length) grupos['NO APLICADA'].push(fila);
      else                           grupos.PARCIAL.push(fila);
    }

    const sinRegistrar = Object.values(grupos).reduce((s, g) => s + g.length, 0);
    console.log(`Archivos: ${archivos.length} · registradas: ${registradas.size} · sin registrar: ${sinRegistrar}\n`);

    for (const [nombre, filas] of Object.entries(grupos)) {
      if (!filas.length) continue;
      console.log(`── ${nombre} (${filas.length}) ${'─'.repeat(Math.max(0, 50 - nombre.length))}`);
      for (const r of filas) {
        const resumen = r.total === 0 ? 'sin objetos detectables'
          : `${r.total - r.faltan.length}/${r.total} objetos`;
        console.log(`  ${r.f}  —  ${resumen}`);
        if (detalle && r.faltan.length) {
          for (const o of r.faltan.slice(0, 8)) {
            console.log(`      falta ${o.tipo} ${o.extra ? o.extra + '.' : ''}${o.nombre}`);
          }
          if (r.faltan.length > 8) console.log(`      … y ${r.faltan.length - 8} más`);
        }
      }
      console.log('');
    }

    if (!registrar) {
      console.log(`Informe solamente — no se escribió nada.`);
      console.log(`Para anotar las ${grupos.APLICADA.length} APLICADAS: --registrar`);
      console.log(`Las ${grupos.DESTRUCTIVA.length} DESTRUCTIVAS no se anotan nunca automáticamente: se revisan a mano.`);
      return;
    }

    let n = 0;
    for (const r of grupos.APLICADA) {
      const nombre = r.f.replace(/^\d+_/, '').replace(/\.sql$/, '');
      const res = await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`, [r.version, nombre]);
      n += res.rowCount;
    }
    console.log(`✓ Anotadas ${n} migraciones en el libro.`);
    console.log(`Quedan sin registrar: ${sinRegistrar - n} (las que no se pudo confirmar).`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
