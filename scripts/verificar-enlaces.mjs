#!/usr/bin/env node
// Valida los enlaces internos de la documentación.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
//
// Este repo es público y su documentación se lee de afuera. Un enlace roto en
// el README es peor que una sección faltante: manda a alguien a una página que
// no existe y le hace pensar que el proyecto está abandonado.
//
// Y adentro pasa lo mismo. CLAUDE.md le dice a cada sesión que lea
// `docs/ARQUITECTURA.md` antes de escribir código; si ese archivo se renombra,
// la instrucción sigue ahí y apunta a la nada.
//
// ── Qué valida, y qué NO ───────────────────────────────────────────────────
//
// **Sí:** enlaces a archivos del repo (`docs/X.md`, `src/lib/y.ts`), con o sin
// ancla, y que el ancla exista como encabezado en el archivo destino.
//
// **No:** URLs externas. Salir a la red desde CI hace el build lento y frágil —
// un sitio caído no es un error del repo, y un CI que falla por algo ajeno
// enseña a ignorar el CI. Se cuentan y se informan, nada más.
//
// Uso: `npm run check:enlaces`

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const RAIZ = process.cwd();

// Los .md de la raíz y de docs/. No se recorre node_modules ni dist.
function documentos() {
  const salida = [];
  for (const entrada of readdirSync(RAIZ)) {
    if (entrada.endsWith(".md")) salida.push(join(RAIZ, entrada));
  }
  const recorrer = (dir) => {
    if (!existsSync(dir)) return;
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (entrada.endsWith(".md")) salida.push(ruta);
    }
  };
  recorrer(join(RAIZ, "docs"));
  return salida;
}

// Un ancla de GitHub: minúsculas, sin acentos ni signos, espacios por guiones.
function anclaDe(titulo) {
  return titulo
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const anclasPorArchivo = new Map();
function anclasDe(ruta) {
  if (anclasPorArchivo.has(ruta)) return anclasPorArchivo.get(ruta);
  const set = new Set();
  if (existsSync(ruta) && ruta.endsWith(".md")) {
    for (const linea of readFileSync(ruta, "utf8").split("\n")) {
      const m = linea.match(/^#{1,6}\s+(.*)$/);
      if (m) set.add(anclaDe(m[1]));
    }
  }
  anclasPorArchivo.set(ruta, set);
  return set;
}

const rotos = [];
let externos = 0;
let internos = 0;

for (const doc of documentos()) {
  const texto = readFileSync(doc, "utf8");
  const lineas = texto.split("\n");

  // Se saltan los bloques de código: un `[x](y)` dentro de ``` es un ejemplo.
  let enCodigo = false;

  lineas.forEach((linea, i) => {
    if (/^\s*```/.test(linea)) { enCodigo = !enCodigo; return; }
    if (enCodigo) return;

    for (const m of linea.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const destino = m[1];

      if (/^(https?:|mailto:)/.test(destino)) { externos++; continue; }
      // Un ancla dentro del mismo documento.
      if (destino.startsWith("#")) {
        internos++;
        if (!anclasDe(doc).has(destino.slice(1).toLowerCase())) {
          rotos.push({ doc, linea: i + 1, destino, motivo: "ancla inexistente en este archivo" });
        }
        continue;
      }

      internos++;
      const [rutaCruda, ancla] = destino.split("#");
      const absoluta = rutaCruda.startsWith("/")
        ? join(RAIZ, rutaCruda.slice(1))
        : resolve(dirname(doc), rutaCruda);

      // Un enlace a un archivo puede llevar `:línea`, que es un puntero para el
      // editor y no parte de la ruta.
      const sinLinea = absoluta.replace(/:\d+$/, "");

      if (!existsSync(sinLinea)) {
        rotos.push({ doc, linea: i + 1, destino, motivo: "el archivo no existe" });
        continue;
      }
      if (ancla && sinLinea.endsWith(".md") && !anclasDe(sinLinea).has(ancla.toLowerCase())) {
        rotos.push({ doc, linea: i + 1, destino, motivo: "el archivo existe pero no tiene esa sección" });
      }
    }
  });
}

const corto = (p) => relative(RAIZ, p).split("\\").join("/");

if (rotos.length === 0) {
  console.log(`\nEnlaces: sin problemas.`);
  console.log(`  ${internos} enlaces internos verificados en ${documentos().length} documentos.`);
  console.log(`  ${externos} externos NO se verifican: salir a la red desde CI es frágil.`);
  process.exit(0);
}

console.log(`\nEnlaces: ${rotos.length} roto(s).\n`);
for (const r of rotos) {
  console.log(`  ${corto(r.doc)}:${r.linea}  →  ${r.destino}`);
  console.log(`      ${r.motivo}`);
}
console.log(`\nEste repo es público: un enlace roto manda a alguien a una página que no existe.`);
process.exit(1);
