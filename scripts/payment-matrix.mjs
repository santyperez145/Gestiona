#!/usr/bin/env node
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const cli = resolve("node_modules/supabase/dist/supabase.js");
const sql = resolve("scripts/payment-matrix.sql");
const result = spawnSync(process.execPath, [
  cli, "db", "query", "--linked", "--file", sql, "--output", "json",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
  shell: false,
  maxBuffer: 10 * 1024 * 1024,
});

if (result.error || result.status !== 0) {
  if (result.stderr) process.stderr.write(result.stderr);
  console.error("La matriz de pagos falló; la transacción no persistió datos ZZ.");
  process.exit(1);
}

const start = result.stdout.indexOf("{");
if (start === -1) {
  console.error("Supabase CLI no devolvió el resultado de la matriz.");
  process.exit(1);
}
const payload = JSON.parse(result.stdout.slice(start));
const rows = payload.rows ?? [];
if (!rows.length || rows.some(row => row.passed !== true)) {
  console.error("La matriz no confirmó todos los escenarios.");
  process.exit(1);
}

console.log(`Matriz de pagos aprobada: ${rows.length - 1} escenarios + cleanup`);
for (const row of rows) console.log(`✓ ${row.scenario}: ${row.detail}`);
