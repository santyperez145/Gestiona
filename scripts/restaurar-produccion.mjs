/**
 * Restaurar producción en un solo comando (2026-10-23).
 *
 * Desde el 2026-10-19 la base productiva está apagada por una factura impaga
 * y se acumularon migraciones y funciones sin publicar. Hacerlo a mano al
 * volver es donde se cuela un error, así que este script hace todo, en orden,
 * y se detiene en el primer paso que falle:
 *
 *   1. El proyecto figura ACTIVE_HEALTHY y Auth responde (si no: pagar).
 *   2. Simulacro de las migraciones pendientes contra producción (no escribe).
 *   3. Si todas dan OK, las aplica (`migraciones-pendientes.mjs --aplicar`).
 *   4. Auditoría de permisos contra producción: sin vistas definer
 *      escribibles, sin TRUNCATE para anon/authenticated y ninguna RPC que
 *      mueva stock o plata sin exigir permiso.
 *   5. Publica las funciones con `deploy-functions.sh` (respeta qué van sin JWT).
 *   6. Corre el control de estado (cierra el aviso «Producción caída») y
 *      vuelve a correr el último CI, que ya no saltea el E2E contra producción.
 *
 * Uso:
 *   npm run restaurar                 # sólo revisa y muestra qué haría
 *   npm run restaurar -- --ejecutar   # hace todo
 *
 * Usa las variables del proceso (SUPABASE_DB_URL, SUPABASE_CA_CERT,
 * VITE_SUPABASE_URL o SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY): nunca las
 * escribe ni las imprime.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { CONSULTAS } from "./auditoria-local.mjs";

export const PROYECTO = "hummeopatkniwkyrrhwc";
export const URL_PROYECTO = `https://${PROYECTO}.supabase.co`;

export const PASOS = [
  "Proyecto activo y Auth respondiendo",
  "Simulacro de las migraciones pendientes",
  "Aplicar las migraciones pendientes",
  "Auditoría de permisos en producción",
  "Publicar las funciones",
  "Control de estado y CI",
];

/** Estado del proyecto según `supabase projects list --output json`. */
export function estadoDelProyecto(salidaJson, ref = PROYECTO) {
  try {
    const p = JSON.parse(salidaJson).find(x => x.id === ref || x.ref === ref);
    return p ? String(p.status) : "NO_ENCONTRADO";
  } catch {
    return "ILEGIBLE";
  }
}

/** Además de las tres de la auditoría local, la guardia de permisos de producción. */
export const CONSULTAS_PRODUCCION = {
  ...CONSULTAS,
  rpcSinPermiso: `SELECT to_regclass('public.audit_rpc_sin_permiso') IS NOT NULL AS hay`,
};

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function correr(cmd, args, { capturar = false } = {}) {
  // En Windows un .cmd (npx.cmd) sólo arranca a través de cmd.exe.
  const [ejecutable, argumentos] = cmd.endsWith(".cmd") ? ["cmd.exe", ["/d", "/c", cmd, ...args]] : [cmd, args];
  const r = spawnSync(ejecutable, argumentos, { stdio: capturar ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8" });
  return { ok: r.status === 0, salida: r.stdout ?? "", error: r.stderr ?? (r.error ? String(r.error) : "") };
}

function ssl() {
  if (process.env.SUPABASE_CA_CERT) return { ca: readFileSync(process.env.SUPABASE_CA_CERT, "utf8"), rejectUnauthorized: true };
  if (process.env.PGSSL_INSECURE === "1") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

async function auditar() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: ssl(), statement_timeout: 60_000 });
  await c.connect();
  try {
    let limpio = true;
    for (const clave of ["vistasEscribibles", "truncate"]) {
      const { rows } = await c.query(CONSULTAS[clave]);
      if (rows.length) { limpio = false; console.error(`  ✗ ${clave}: ${rows.map(r => `${r.objeto} (${r.permisos})`).join("; ")}`); }
      else console.log(`  ✓ ${clave}: ninguna`);
    }
    const { rows: [{ hay }] } = await c.query(CONSULTAS_PRODUCCION.rpcSinPermiso);
    if (hay) {
      const { rows } = await c.query("SELECT * FROM public.audit_rpc_sin_permiso");
      if (rows.length) { limpio = false; console.error(`  ✗ RPC sin permiso: ${rows.map(r => Object.values(r)[0]).join(", ")}`); }
      else console.log("  ✓ RPC que mueven stock o plata: todas exigen permiso");
    }
    return limpio;
  } finally {
    await c.end();
  }
}

async function authResponde(url, clave) {
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: clave ? { apikey: clave } : {}, signal: AbortSignal.timeout(20_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const ejecutar = process.argv.includes("--ejecutar");
  const url = (process.env.SUPABASE_URL ?? URL_PROYECTO).replace(/\/+$/, "");
  const clave = process.env.SUPABASE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const paso = (i) => console.log(`\n[${i + 1}/${PASOS.length}] ${PASOS[i]}`);
  const frenar = (msg) => { console.error(`\n✗ ${msg}`); process.exitCode = 1; };

  paso(0);
  const lista = correr(npx, ["supabase", "projects", "list", "--output", "json"], { capturar: true });
  const estado = lista.ok ? estadoDelProyecto(lista.salida) : "CLI_SIN_RESPUESTA";
  console.log(`  Proyecto ${PROYECTO}: ${estado}`);
  if (estado !== "ACTIVE_HEALTHY") {
    return frenar(estado === "INACTIVE"
      ? "El proyecto sigue inactivo: primero hay que pagar la factura de Supabase (organización › Billing). Nada que hacer hasta entonces."
      : `El proyecto no está listo (${estado}). Esperá unos minutos a que termine de restaurarse y volvé a correr.`);
  }
  if (!(await authResponde(url, clave))) return frenar("Auth todavía no responde: el proyecto se está levantando. Volvé a correr en unos minutos.");
  console.log("  ✓ Auth responde");
  if (!process.env.SUPABASE_DB_URL) return frenar("Falta SUPABASE_DB_URL en el entorno (la conexión a la base; no se guarda en el repo).");

  paso(1);
  if (!correr("node", ["scripts/migraciones-pendientes.mjs"]).ok) return frenar("El simulacro falló: no se aplica nada. Corregir la migración o su matriz; nunca saltear.");

  if (!ejecutar) {
    console.log("\nTodo listo para restaurar. Pasos que faltan, en orden:");
    for (const p of PASOS.slice(2)) console.log(`  - ${p}`);
    console.log("\nPara hacerlo: npm run restaurar -- --ejecutar");
    return;
  }

  paso(2);
  if (!correr("node", ["scripts/migraciones-pendientes.mjs", "--aplicar"]).ok) return frenar("Una migración falló al aplicarse: se detuvo ahí. Las anteriores quedaron aplicadas y registradas.");

  paso(3);
  if (!(await auditar())) return frenar("La auditoría encontró permisos de más: revisarlos antes de publicar las funciones.");

  paso(4);
  if (!correr("bash", ["scripts/deploy-functions.sh"]).ok) return frenar("Alguna función no se publicó: el detalle está arriba. Las migraciones ya están aplicadas.");

  paso(5);
  // En GitHub, con sus credenciales: cierra el aviso «Producción caída».
  correr("gh", ["workflow", "run", "estado-produccion.yml"]);
  console.log("  Control de estado lanzado: cierra el aviso si todo responde.");
  const ultimo = correr("gh", ["run", "list", "--workflow", "ci.yml", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"], { capturar: true });
  if (ultimo.ok && ultimo.salida.trim()) {
    correr("gh", ["run", "rerun", ultimo.salida.trim()]);
    console.log(`  CI ${ultimo.salida.trim()} relanzado: ahora corre el E2E contra producción.`);
  }
  console.log("\n✓ Producción restaurada. Falta mirar el CI relanzado y una tienda real en el navegador.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(e => { console.error(`\n✗ ${e.message}`); process.exitCode = 1; });
}
