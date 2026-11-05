// Prueba de punta a punta del lector de la app (src/lib/lectorDeCodigos.ts):
// 1. zxing-wasm genera 4 EAN-13 (3 distintos, uno repetido) como PNG.
// 2. Chromium abre el dev server de Vite, dibuja los 4 en UN canvas y llama al
//    lector de la app (sin detector nativo: camino WebAssembly).
// Medido el 2026-11-06: los 4 en una sola imagen, 52 ms, sin errores de consola.
//
// Uso: npx vite --port 5199 --strictPort   (en otra terminal)
//      node scripts/probar-lector-de-codigos.mjs http://localhost:5199/
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const R = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(R + "package.json");
const full = await import("file:///" + require.resolve("zxing-wasm/full").replace(/\\/g, "/"));
await full.prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve("zxing-wasm/full/zxing_full.wasm")) }, fireImmediately: true });

const codigos = ["779000100001", "779000200001", "779000300001", "779000100001"];
const pngs = [];
for (const c of codigos) {
  const r = await full.writeBarcode(c, { format: "EAN-13", scale: 3 });
  if (r.error) throw new Error(r.error);
  pngs.push(Buffer.from(await r.image.arrayBuffer()).toString("base64"));
}
console.log("generados:", (await Promise.all(pngs.map(async b => (await full.readBarcodes(Buffer.from(b, "base64"), { formats: ["EAN13"] }))[0]?.text))).join(", "));

const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const errores = [];
page.on("console", m => { if (m.type() === "error") errores.push(m.text()); });
await page.goto(process.argv[2] ?? "http://localhost:5199/", { waitUntil: "domcontentloaded" });
const resultado = await page.evaluate(async (imagenes) => {
  const nativo = "BarcodeDetector" in globalThis;
  const { lectorDeCodigos } = await import("/src/lib/lectorDeCodigos.ts");
  const bitmaps = await Promise.all(imagenes.map(async b => createImageBitmap(await (await fetch("data:image/png;base64," + b)).blob())));
  const canvas = document.createElement("canvas");
  canvas.width = bitmaps.reduce((s, x) => s + x.width + 40, 40);
  canvas.height = Math.max(...bitmaps.map(x => x.height)) + 80;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let x = 40;
  for (const bm of bitmaps) { ctx.drawImage(bm, x, 40); x += bm.width + 40; }
  const lector = await lectorDeCodigos();
  const t = performance.now();
  const leidos = await lector.detect(canvas);
  return { nativo, ms: Math.round(performance.now() - t), codigos: leidos.map(c => c.rawValue), cajas: leidos.map(c => Math.round(c.boundingBox.x)) };
}, pngs);
console.log("detector nativo en este Chromium:", resultado.nativo);
console.log(`leídos en una sola imagen (${resultado.ms} ms):`, resultado.codigos.join(", "));
console.log("x de cada recuadro:", resultado.cajas.join(", "));
console.log("errores de consola:", errores.length ? errores : "ninguno");
await browser.close();
