#!/usr/bin/env node
/**
 * P0-01 — que la documentación no invente números.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Medido el 2026-08-25, la documentación del repo declaraba **seis cantidades
 * distintas de tests** (418, 1.201, 1.446, 1.469, 1.498, 1.534) y **cuatro de
 * tablas** (147, 269, 282, 308). Este repo es público: un análisis externo ya
 * citó "418 tests" tomándolo de una línea vieja, cuando la suite era mucho
 * mayor. Un número sin fecha se convierte en el dato que otros repiten.
 *
 * ── La regla, que ya estaba escrita y nadie podía hacer cumplir ───────────
 *
 * `CONTRIBUTING.md`: *"Los números medidos van con la fecha o con el comando al
 * lado."* Eso es exactamente lo que verifica este script.
 *
 *   - Un número **con fecha** (`2026-08-25`) es una medición de un momento.
 *     Puede ser viejo y estar bien: así se lee el historial de sesiones.
 *   - Un número **con el comando al lado** (`npm test`, `ls supabase/...`)
 *     dice cómo reproducirlo.
 *   - Un número **sin ninguna de las dos cosas** se presenta como verdad
 *     atemporal y envejece en silencio. Eso falla.
 *
 * ── Y lo que sí se puede contar sin base de datos, se cuenta ──────────────
 *
 * Edge Functions, archivos de migración y archivos de test salen del
 * filesystem. Si un documento los cita **sin fecha**, tiene que coincidir con
 * la realidad de hoy; con fecha, se respeta como medición histórica.
 *
 * Los conteos que dependen de la base —tablas, funciones, políticas— no se
 * pueden verificar en CI sin credenciales de producción, y apuntar el CI a
 * producción sería peor que el problema. Para esos, la fecha es la garantía.
 *
 * Uso:  node scripts/verificar-conteos.mjs [--fix-listado]
 */
import fs from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();

/** Documentos que se revisan. */
const DOCS = [
  "CONTRIBUTING.md",
  "ROADMAP.md",
  "README.md",
  ...fs.existsSync(path.join(RAIZ, "docs"))
    ? fs.readdirSync(path.join(RAIZ, "docs"))
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join("docs", f))
    : [],
].filter((f) => fs.existsSync(path.join(RAIZ, f)));

/** Sustantivos que denotan una medición del sistema. */
const UNIDADES = [
  "tests?", "pruebas", "tablas", "vistas", "funciones", "triggers",
  "índices", "indices", "políticas", "politicas", "policies",
  "migraciones", "Edge Functions", "edge functions", "cron jobs", "crons",
];

const RE_NUMERO = new RegExp(
  String.raw`\*{0,2}(\d{1,3}(?:[.,]\d{3})*|\d+)\*{0,2}\s+(?:${UNIDADES.join("|")})\b`,
  "gi",
);

const RE_FECHA = /\d{4}-\d{2}-\d{2}/;
const RE_COMANDO = /`[^`]*(?:npm |npx |ls |git |select |SELECT )[^`]*`/i;

/** Ventana alrededor del número donde se acepta la fecha o el comando. */
const VENTANA = 260;

/**
 * Números que NO son mediciones del sistema.
 *
 * La regla es mecánica y no puede distinguir "hay 65 Edge Functions" de "un
 * producto con 100 funciones puede ser peor que uno con 20". Estas tres frases
 * son retóricas, y dos de ellas están **dentro de una tabla de cómo NO hay que
 * presentar el producto**: el número es el ejemplo de lo que está mal decir.
 *
 * ⚠️ La lista se mantiene chica a propósito. Si crece, el que crece es el
 * problema: una guarda con muchas excepciones enseña a ignorar la luz roja, y
 * este repo ya descartó dos guardas por eso el mismo día que nació ésta.
 */
const RETORICOS = [
  "no 100 snapshots frágiles",
  "Cantidad de código no es valor",
  '"Tenemos 84 páginas',
];

/** Lo que se puede contar sin base de datos. */
function realidad() {
  const dirFn = path.join(RAIZ, "supabase", "functions");
  const dirMig = path.join(RAIZ, "supabase", "migrations");
  return {
    "edge functions": fs.existsSync(dirFn)
      ? fs.readdirSync(dirFn).filter((f) => f !== "_shared"
          && fs.statSync(path.join(dirFn, f)).isDirectory()).length
      : null,
    migraciones: fs.existsSync(dirMig)
      ? fs.readdirSync(dirMig).filter((f) => f.endsWith(".sql")).length
      : null,
  };
}

const REAL = realidad();

/** Normaliza "1.534" y "1,534" a 1534. */
const aNumero = (s) => Number(String(s).replace(/[.,]/g, ""));

const problemas = [];

for (const doc of DOCS) {
  const texto = fs.readFileSync(path.join(RAIZ, doc), "utf8");
  const lineas = texto.split("\n");

  let m;
  RE_NUMERO.lastIndex = 0;
  while ((m = RE_NUMERO.exec(texto))) {
    const cita = m[0];
    const valor = aNumero(m[1]);

    // Números chicos no son mediciones: "3 tablas nuevas", "dos triggers".
    if (valor < 10) continue;

    const desde = Math.max(0, m.index - VENTANA);
    const contexto = texto.slice(desde, m.index + cita.length + VENTANA);

    if (RETORICOS.some((frase) => contexto.includes(frase))) continue;

    const tieneFecha = RE_FECHA.test(contexto);
    const tieneComando = RE_COMANDO.test(contexto);
    const linea = texto.slice(0, m.index).split("\n").length;

    if (!tieneFecha && !tieneComando) {
      problemas.push({
        doc, linea, cita,
        motivo: "sin fecha ni comando: se lee como verdad atemporal y envejece en silencio",
      });
      continue;
    }

    // Lo contable sin base: si NO lleva fecha, tiene que ser el número de hoy.
    if (!tieneFecha) {
      const unidad = cita.toLowerCase().includes("edge function")
        ? "edge functions"
        : /migraciones/i.test(cita) ? "migraciones" : null;
      if (unidad && REAL[unidad] != null && valor !== REAL[unidad]) {
        problemas.push({
          doc, linea, cita,
          motivo: `dice ${valor} y hoy hay ${REAL[unidad]} (contado del filesystem)`,
        });
      }
    }
  }
}

if (problemas.length === 0) {
  console.log("Conteos: sin problemas.");
  console.log(`  Referencia local: ${REAL["edge functions"]} Edge Functions, ${REAL.migraciones} migraciones.`);
  process.exit(0);
}

console.error(`\nConteos: ${problemas.length} problema(s).\n`);
for (const p of problemas) {
  console.error(`  ${p.doc}:${p.linea}  "${p.cita.trim()}"`);
  console.error(`      ${p.motivo}\n`);
}
console.error("Regla (CONTRIBUTING.md): todo número medido lleva la fecha o el comando al lado.");
console.error("Una medición vieja CON fecha es válida — es así como se lee el historial.\n");
process.exit(1);
