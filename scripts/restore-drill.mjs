#!/usr/bin/env node
/**
 * Restore drill de los snapshots gestionados por organización.
 *
 * Descarga el snapshot v3 más reciente que ya pasó la verificación de hash,
 * vuelve a comprobar su integridad y lo carga en tablas clonadas dentro de un
 * esquema aislado. La prueba corre en una transacción, borra el esquema antes
 * de confirmar y nunca escribe sobre `public`.
 *
 * Requisitos: sesión activa del Supabase CLI y proyecto linkeado.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const BACKUP_BUCKET = "backups";

/**
 * RPO comprometido, en horas.
 *
 * ⚠️ Un backup que existe no dice cuánto se pierde si hoy se cae la base. Eso
 * lo dice la **antigüedad del último snapshot**, y hasta el 2026-08-25 nadie lo
 * medía: los backups eran semanales, así que el RPO real era de hasta **7 días**
 * — un desastre el sábado costaba seis días de ventas. Nadie eligió ese número;
 * era la consecuencia de la frecuencia del cron.
 *
 * Con el cron diario (`20260825000030`) el compromiso es 24 h más el margen de
 * una corrida fallida. Si el drill encuentra un snapshot más viejo que esto,
 * **falla**: es lo que convierte el RPO en una garantía y no en una aspiración.
 */
const RPO_HORAS = 36;
const CURRENT_SNAPSHOT_VERSION = 3;
const SECRET_SETTINGS_COLUMNS = new Set([
  "mp_access_token", "api_key", "mp_webhook_secret", "webhook_secret",
  "smtp_pass", "evolution_api_key", "ml_access_token", "ml_refresh_token",
]);
const EXCLUDED_CREDENTIAL_STORES = new Set([
  "afip_credentials", "payment_connections", "meli_connections", "api_keys",
  "org_api_keys", "evolution_connections", "oauth_states", "portal_sessions",
  "push_subscriptions", "webhook_configs",
]);

function fail(message) {
  throw new Error(message);
}

function runSupabase(args, { sensitive = false } = {}) {
  // Ejecutar el JS del paquete evita depender de cmd.exe/PowerShell y mantiene
  // los argumentos (incluido el path temporal con espacios) sin reinterpretar.
  const cli = resolve("node_modules/supabase/dist/supabase.js");
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    if (!sensitive && result.stderr) process.stderr.write(result.stderr);
    fail(`Supabase CLI falló al ejecutar ${args[0] ?? "el comando"}`);
  }
  return result.stdout;
}

function parseCliJson(output) {
  const start = output.indexOf("{");
  const arrayStart = output.indexOf("[");
  const first = start === -1 ? arrayStart : arrayStart === -1 ? start : Math.min(start, arrayStart);
  if (first === -1) fail("Supabase CLI no devolvió JSON");
  return JSON.parse(output.slice(first));
}

function readProjectRef() {
  const projectRef = readFileSync(resolve("supabase/.temp/project-ref"), "utf8").trim();
  if (!/^[a-z0-9]{20}$/.test(projectRef)) fail("El project ref linkeado no es válido");
  return projectRef;
}

function readServiceRole(projectRef) {
  const output = runSupabase([
    "projects", "api-keys", "--project-ref", projectRef, "--output", "json",
  ], { sensitive: true });
  const keys = parseCliJson(output);
  const serviceRole = keys.find(key => key.name === "service_role" && key.type === "legacy");
  const apiKey = serviceRole?.api_key ?? serviceRole?.key;
  if (typeof apiKey !== "string" || !apiKey) fail("No se pudo obtener la clave operativa del proyecto");
  return apiKey;
}

function validateArtifact(snapshot, metadata, raw) {
  const checksum = createHash("sha256").update(raw).digest("hex");
  if (checksum !== metadata.checksum_sha256) fail("El checksum del snapshot no coincide");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("El snapshot no es un objeto JSON");
  if (snapshot.schema_version !== CURRENT_SNAPSHOT_VERSION) {
    fail(`El drill exige snapshot v${CURRENT_SNAPSHOT_VERSION}; se encontró v${snapshot.schema_version ?? "desconocida"}`);
  }
  if (snapshot.org_id !== metadata.org_id) fail("El snapshot pertenece a otra organización");
  if (!Array.isArray(snapshot.tables) || snapshot.tables.length !== metadata.table_count) {
    fail("La cantidad de tablas no coincide con el manifiesto");
  }

  const seen = new Set();
  let totalRows = 0;
  for (const table of snapshot.tables) {
    if (!table || typeof table !== "object" || !/^[a-z][a-z0-9_]*$/.test(table.table ?? "")) {
      fail("El snapshot contiene un nombre de tabla inválido");
    }
    if (seen.has(table.table)) fail(`La tabla ${table.table} aparece más de una vez`);
    if (EXCLUDED_CREDENTIAL_STORES.has(table.table)) fail(`El snapshot incluyó el almacén sensible ${table.table}`);
    seen.add(table.table);
    if (table.status !== "exported" && table.status !== "empty") fail(`La tabla ${table.table} está incompleta`);
    if (!Array.isArray(table.rows) || table.rows.length !== table.row_count) {
      fail(`El conteo de ${table.table} no coincide con sus filas`);
    }
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail(`${table.table} contiene una fila inválida`);
      if (table.table === "settings") {
        for (const column of SECRET_SETTINGS_COLUMNS) {
          if (Object.hasOwn(row, column)) fail(`settings filtró la credencial ${column}`);
        }
      }
      if (table.table === "payment_transactions" && Object.hasOwn(row, "raw")) {
        fail("payment_transactions filtró el payload crudo del proveedor");
      }
    }
    totalRows += table.row_count;
  }
  if (totalRows !== metadata.total_rows) fail("El total de filas no coincide con el manifiesto");
  return { totalRows, tableCount: snapshot.tables.length };
}

function restoreSql(snapshot, schemaName) {
  const payload = Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64");
  return `
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE zz_restore_drill_result (
  schema_version integer NOT NULL,
  tables_restored integer NOT NULL,
  rows_restored bigint NOT NULL,
  restore_ms numeric NOT NULL,
  restored_schema text NOT NULL,
  leftovers integer NOT NULL
) ON COMMIT DROP;

DO $drill$
DECLARE
  v_snapshot jsonb := convert_from(decode('${payload}', 'base64'), 'UTF8')::jsonb;
  v_schema text := '${schemaName}';
  v_table jsonb;
  v_table_name text;
  v_rows jsonb;
  v_columns text;
  v_unknown_columns text;
  v_expected bigint;
  v_inserted bigint;
  v_total_rows bigint := 0;
  v_table_count integer := 0;
  v_started_at timestamptz := clock_timestamp();
  v_restore_ms numeric;
  v_leftovers integer;
BEGIN
  IF v_schema !~ '^zz_restore_drill_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Nombre de sandbox inválido';
  END IF;
  IF to_regnamespace(v_schema) IS NOT NULL THEN
    RAISE EXCEPTION 'El sandbox de restore ya existe';
  END IF;

  EXECUTE format('CREATE SCHEMA %I', v_schema);

  FOR v_table IN SELECT value FROM jsonb_array_elements(v_snapshot->'tables')
  LOOP
    v_table_name := v_table->>'table';
    IF v_table_name !~ '^[a-z][a-z0-9_]*$'
       OR to_regclass(format('public.%I', v_table_name)) IS NULL THEN
      RAISE EXCEPTION 'La tabla % no existe en el esquema productivo', v_table_name;
    END IF;
    IF v_table->>'status' NOT IN ('exported', 'empty') THEN
      RAISE EXCEPTION 'La tabla % no es restaurable', v_table_name;
    END IF;

    v_rows := v_table->'rows';
    v_expected := (v_table->>'row_count')::bigint;
    IF jsonb_typeof(v_rows) <> 'array' OR jsonb_array_length(v_rows) <> v_expected THEN
      RAISE EXCEPTION 'Conteo inválido en %', v_table_name;
    END IF;

    EXECUTE format(
      'CREATE TABLE %I.%I (LIKE public.%I INCLUDING DEFAULTS INCLUDING CONSTRAINTS)',
      v_schema, v_table_name, v_table_name
    );

    v_inserted := 0;
    IF v_expected > 0 THEN
      SELECT
        string_agg(format('%I', keys.column_name), ', ' ORDER BY keys.column_name),
        string_agg(keys.column_name, ', ' ORDER BY keys.column_name)
          FILTER (WHERE columns.column_name IS NULL)
      INTO v_columns, v_unknown_columns
      FROM (
        SELECT DISTINCT jsonb_object_keys(row_value) AS column_name
        FROM jsonb_array_elements(v_rows) AS rows(row_value)
      ) AS keys
      LEFT JOIN information_schema.columns AS columns
        ON columns.table_schema = 'public'
       AND columns.table_name = v_table_name
       AND columns.column_name = keys.column_name;

      IF v_unknown_columns IS NOT NULL THEN
        RAISE EXCEPTION 'Columnas inexistentes en %: %', v_table_name, v_unknown_columns;
      END IF;
      IF v_columns IS NULL THEN
        RAISE EXCEPTION 'Las filas de % no tienen columnas', v_table_name;
      END IF;

      EXECUTE format(
        'INSERT INTO %I.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1)',
        v_schema, v_table_name, v_columns, v_columns, v_table_name
      ) USING v_rows;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
    END IF;

    IF v_inserted <> v_expected THEN
      RAISE EXCEPTION 'Restore incompleto en %: % de % filas', v_table_name, v_inserted, v_expected;
    END IF;
    v_total_rows := v_total_rows + v_inserted;
    v_table_count := v_table_count + 1;
  END LOOP;

  v_restore_ms := round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);
  EXECUTE format('DROP SCHEMA %I CASCADE', v_schema);
  SELECT count(*)::integer INTO v_leftovers
  FROM pg_namespace WHERE nspname = v_schema;
  IF v_leftovers <> 0 THEN
    RAISE EXCEPTION 'El sandbox no se eliminó';
  END IF;

  INSERT INTO zz_restore_drill_result
    (schema_version, tables_restored, rows_restored, restore_ms, restored_schema, leftovers)
  VALUES
    ((v_snapshot->>'schema_version')::integer, v_table_count, v_total_rows, v_restore_ms, v_schema, v_leftovers);
EXCEPTION WHEN OTHERS THEN
  IF to_regnamespace(v_schema) IS NOT NULL THEN
    EXECUTE format('DROP SCHEMA %I CASCADE', v_schema);
  END IF;
  RAISE;
END
$drill$;

SELECT schema_version, tables_restored, rows_restored, restore_ms, leftovers
FROM zz_restore_drill_result;
COMMIT;
`;
}

async function main() {
  const projectRef = readProjectRef();
  const serviceRole = readServiceRole(projectRef);
  const client = createClient(`https://${projectRef}.supabase.co`, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: metadata, error: metadataError } = await client
    .from("organization_backup_snapshots")
    .select("id, org_id, storage_path, checksum_sha256, snapshot_schema_version, table_count, total_rows, size_bytes, created_at, last_verified_at")
    .eq("status", "completed")
    .eq("last_verification_status", "passed")
    .not("storage_path", "is", null)
    .not("checksum_sha256", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (metadataError || !metadata) fail("No hay un snapshot íntegro disponible para el drill");

  const { data: blob, error: downloadError } = await client.storage
    .from(BACKUP_BUCKET)
    .download(metadata.storage_path);
  if (downloadError || !blob) fail("No se pudo descargar el snapshot privado");
  const raw = await blob.text();
  let snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    fail("El snapshot no contiene JSON válido");
  }
  const artifact = validateArtifact(snapshot, metadata, raw);

  const schemaName = `zz_restore_drill_${randomUUID().replaceAll("-", "")}`;
  const tempDir = mkdtempSync(join(tmpdir(), "gestiona-restore-drill-"));
  const sqlPath = join(tempDir, "restore.sql");
  try {
    writeFileSync(sqlPath, restoreSql(snapshot, schemaName), { encoding: "utf8", mode: 0o600 });
    const output = runSupabase(["db", "query", "--linked", "--file", sqlPath, "--output", "json"]);
    const result = parseCliJson(output);
    const row = result.rows?.[0];
    if (!row || Number(row.leftovers) !== 0) fail("El drill no confirmó la limpieza del sandbox");
    if (Number(row.tables_restored) !== artifact.tableCount || Number(row.rows_restored) !== artifact.totalRows) {
      fail("La evidencia del restore no coincide con el snapshot");
    }

    // ⚠️ El RPO se mide contra el snapshot que se acaba de restaurar, no
    // contra el más nuevo del bucket: lo que importa es la antigüedad de lo que
    // efectivamente se probó que se puede recuperar.
    const rpoHoras = (Date.now() - new Date(metadata.created_at).getTime()) / 3600000;
    if (!Number.isFinite(rpoHoras) || rpoHoras < 0) {
      fail("No se pudo calcular el RPO: el snapshot no tiene fecha usable");
    }
    if (rpoHoras > RPO_HORAS) {
      fail(
        `RPO incumplido: el snapshot verificado más reciente tiene ${rpoHoras.toFixed(1)} h ` +
        `y el compromiso es ${RPO_HORAS} h. Con la base caída ahora se perderían ` +
        `${rpoHoras.toFixed(1)} horas de operación.`,
      );
    }

    console.log("Restore drill aprobado");
    console.log(`Snapshot: v${row.schema_version} · ${row.tables_restored} tablas · ${row.rows_restored} filas`);
    console.log(`RTO técnico del restore: ${row.restore_ms} ms`);
    console.log(`RPO medido: ${rpoHoras.toFixed(1)} h (compromiso ${RPO_HORAS} h)`);
    console.log(`Restos del sandbox: ${row.leftovers}`);
    console.log("Credenciales y datos de negocio: no impresos");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`Restore drill falló: ${error instanceof Error ? error.message : "error inesperado"}`);
  process.exitCode = 1;
});
