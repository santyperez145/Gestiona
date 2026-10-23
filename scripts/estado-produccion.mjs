/**
 * Control del estado de producción (2026-10-23).
 *
 * El 2026-10 la base quedó apagada por una factura impaga y nos enteramos por
 * las fallas, no por un aviso. Este control corre cada 6 horas en GitHub
 * Actions (`.github/workflows/estado-produccion.yml`):
 *   1. Prueba la salud de Supabase (Auth y REST) con la clave publicable, la
 *      misma que viaja en la página: no hace falta ningún secreto nuevo.
 *   2. Prueba que el sitio responda.
 *   3. Si algo falla, abre un issue «Producción caída» (o le agrega un
 *      comentario si ya está abierto): GitHub le avisa por mail al dueño.
 *      Cuando todo vuelve, lo cierra con un comentario.
 *
 * Uso: node scripts/estado-produccion.mjs  (con SUPABASE_URL, SUPABASE_KEY;
 * GITHUB_TOKEN y GITHUB_REPOSITORY para el aviso; sin ellos sólo informa).
 */
import { pathToFileURL } from "node:url";

export const SITIO = "https://nerqia.app";
export const TITULO_AVISO = "Producción caída: revisar Supabase y el sitio";

/** Qué chequear y cómo se lee cada respuesta. */
export function chequeos(supabaseUrl) {
  const base = String(supabaseUrl ?? "").replace(/\/+$/, "");
  return [
    { nombre: "Supabase Auth", url: `${base}/auth/v1/health`, conClave: true },
    { nombre: "Supabase REST", url: `${base}/rest/v1/`, conClave: true },
    { nombre: "Sitio", url: `${SITIO}/estado`, conClave: false },
  ];
}

/**
 * Lee un resultado. Supabase responde 540 o 503 con el proyecto pausado y
 * «tenant not found» cuando está inactivo por facturación; cualquier respuesta
 * que no sea 2xx (salvo 401/404 de REST, que prueban que el servidor responde)
 * cuenta como caída.
 */
export function leerResultado(nombre, r) {
  if (r.error) {
    // Un proyecto inactivo deja de tener dominio: ENOTFOUND es la señal de facturación más común.
    const pista = /ENOTFOUND/.test(r.error) && nombre.startsWith("Supabase") ? ". El dominio del proyecto no existe: suele ser el proyecto inactivo por facturación." : "";
    return { nombre, ok: false, detalle: `sin respuesta (${r.error})${pista}` };
  }
  const pausado = r.status === 540 || /tenant.*not found|project.*paused|inactive/i.test(r.cuerpo ?? "");
  if (pausado) return { nombre, ok: false, detalle: `proyecto pausado o inactivo (HTTP ${r.status}). Revisá primero la facturación de Supabase.` };
  const ok = (r.status >= 200 && r.status < 300) || (nombre === "Supabase REST" && (r.status === 401 || r.status === 404));
  return { nombre, ok, detalle: ok ? `HTTP ${r.status}` : `HTTP ${r.status}` };
}

export function cuerpoDelAviso(resultados, cuando) {
  return [
    `Control automático del ${cuando}.`,
    "",
    ...resultados.map(r => `- ${r.ok ? "✅" : "❌"} **${r.nombre}**: ${r.detalle}`),
    "",
    "Si la base está pausada o inactiva, lo primero es la factura de Supabase (organización › Billing).",
    "Este issue se cierra solo cuando el control vuelve a dar todo bien.",
  ].join("\n");
}

async function probar(c, clave) {
  try {
    const res = await fetch(c.url, {
      headers: c.conClave && clave ? { apikey: clave, Authorization: `Bearer ${clave}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    return leerResultado(c.nombre, { status: res.status, cuerpo: (await res.text()).slice(0, 500) });
  } catch (e) {
    const causa = e && typeof e === "object" && "cause" in e ? e.cause?.code ?? e.cause?.message : null;
    return leerResultado(c.nombre, { error: [e instanceof Error ? e.message : String(e), causa].filter(Boolean).join(": ") });
  }
}

async function github(ruta, opciones = {}) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`GitHub ${ruta}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const url = process.env.SUPABASE_URL;
  if (!url) { console.error("::error::Falta SUPABASE_URL"); process.exitCode = 1; return; }
  const resultados = [];
  for (const c of chequeos(url)) {
    // Un reintento: un corte de un segundo no es una caída.
    let r = await probar(c, process.env.SUPABASE_KEY);
    if (!r.ok) { await new Promise(ok => setTimeout(ok, 15_000)); r = await probar(c, process.env.SUPABASE_KEY); }
    resultados.push(r);
    console.log(`${r.ok ? "OK " : "MAL"} ${r.nombre}: ${r.detalle}`);
  }
  const caido = resultados.some(r => !r.ok);
  process.exitCode = caido ? 1 : 0;
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) return;

  // Se reconoce por el título: no depende de que exista una etiqueta en el repositorio.
  const abiertos = (await github("/issues?state=open&per_page=100")).filter(i => !i.pull_request && i.title === TITULO_AVISO);
  const cuando = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  if (caido) {
    if (abiertos.length) await github(`/issues/${abiertos[0].number}/comments`, { method: "POST", body: JSON.stringify({ body: cuerpoDelAviso(resultados, cuando) }) });
    else await github("/issues", { method: "POST", body: JSON.stringify({ title: TITULO_AVISO, body: cuerpoDelAviso(resultados, cuando) }) });
    console.error("::error title=Producción caída::" + resultados.filter(r => !r.ok).map(r => `${r.nombre}: ${r.detalle}`).join(" · "));
    return;
  }
  for (const i of abiertos) {
    await github(`/issues/${i.number}/comments`, { method: "POST", body: JSON.stringify({ body: `Volvió a andar: ${cuando}.\n\n${resultados.map(r => `- ✅ ${r.nombre}: ${r.detalle}`).join("\n")}` }) });
    await github(`/issues/${i.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
