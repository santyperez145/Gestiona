#!/usr/bin/env node
/**
 * Chequea todas las Edge Functions que existen hoy, sin una lista manual que
 * pueda olvidarse al crear una nueva. Deno es la autoridad de tipos para este
 * código: el TypeScript del frontend no alcanza imports remotos ni globals del
 * Edge Runtime.
 *
 * En CI se instala Deno de forma explícita. Para que el comando también sirva
 * en una PC nueva, localmente cae a `npx --yes deno` si el binario no está en
 * PATH. No genera archivos en el repositorio.
 */
import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const functionsDir = resolve(root, "supabase/functions");

const entries = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => resolve(functionsDir, entry.name, "index.ts"))
  .filter(existsSync)
  .sort()
  .map((entry) => relative(root, entry));

if (entries.length === 0) {
  console.error("No se encontraron Edge Functions para chequear.");
  process.exit(2);
}

const checkArgs = ["check", "--no-lock", ...entries];
const run = (command, args, shell = false) => spawnSync(command, args, {
  cwd: root,
  stdio: "inherit",
  shell,
});

let result = run("deno", checkArgs);
if (result.error?.code === "ENOENT") {
  // npm agrega `.cmd` en Windows; invocarlo por nombre conserva el mismo
  // comando para PowerShell, cmd.exe y los runners Linux.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  console.warn("Deno no está en PATH; se ejecuta temporalmente con npx.");
  result = run(npx, ["--yes", "deno", ...checkArgs], process.platform === "win32");
}

if (result.error) {
  console.error(`No se pudo iniciar Deno: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);
