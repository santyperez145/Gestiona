/**
 * Resumen del rendimiento de cada pantalla (2026-10-31). Lee lo que deja el
 * barrido con datos (`test-results/rendimiento.jsonl`) y lo publica como tabla,
 * de la pantalla más lenta a la más rápida, en el log y en el resumen de la
 * corrida de GitHub. Sólo informa: los presupuestos se fijan con estos datos.
 *
 *   node scripts/resumen-rendimiento.mjs [archivo]
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function leerFilas(texto) {
  return texto.split("\n").map(l => l.trim()).filter(Boolean).flatMap(l => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

export function percentil(valores, p) {
  const v = [...valores].sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}

export function tabla(filas) {
  const orden = [...filas].sort((a, b) => b.listo - a.listo);
  const lineas = [
    "| Pantalla | Título (ms) | Lista (ms) | LCP (ms) | CLS | Tareas largas | Bloqueo (ms) | JS (KB) | Consultas | Más lenta (ms) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...orden.map(f => `| ${f.ruta} | ${f.titulo} | ${f.listo} | ${f.lcp} | ${f.cls} | ${f.tareasLargas} | ${f.bloqueo} | ${f.jsKb} | ${f.consultas} | ${f.consultaMasLenta} |`),
  ];
  const resumen = ["titulo", "listo", "lcp", "jsKb", "consultas"].map(k =>
    `${k}: p50 ${percentil(filas.map(f => f[k]), 50)} · p90 ${percentil(filas.map(f => f[k]), 90)} · máx ${Math.max(...filas.map(f => f[k]))}`);
  return `### Rendimiento por pantalla (${filas.length}, visita en frío con datos)\n\n${resumen.map(r => `- ${r}`).join("\n")}\n\n${lineas.join("\n")}\n`;
}

function main() {
  const archivo = process.argv[2] ?? "test-results/rendimiento.jsonl";
  if (!existsSync(archivo)) { console.log(`Sin mediciones (${archivo} no existe).`); return; }
  const filas = leerFilas(readFileSync(archivo, "utf8"));
  if (!filas.length) { console.log("Sin mediciones."); return; }
  const md = tabla(filas);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
