/**
 * El kit para compartir la tienda (2026-11-02). Publicar no vende: la primera
 * venta online llega cuando alguien abre el link. Hasta hoy el comercio sólo
 * podía copiar la URL; ahora tiene el mensaje de WhatsApp listo, el QR y un
 * cartel para el mostrador.
 */

export function mensajeParaCompartir(nombreTienda: string, url: string): string {
  const nombre = nombreTienda.trim();
  return nombre
    ? `¡${nombre} ya tiene tienda online! Mirá los productos y comprá desde acá: ${url}`
    : `¡Ya tenemos tienda online! Mirá los productos y comprá desde acá: ${url}`;
}

/** Abre WhatsApp con el mensaje escrito; el comercio elige a quién mandarlo. */
export function enlaceWhatsApp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Nombre de archivo del QR a partir del nombre de la tienda. */
export function archivoDelQr(nombreTienda: string): string {
  const base = nombreTienda
    .normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `qr-${base || "tienda"}.png`;
}

/** Un cartel A4 para imprimir y pegar en el local: nombre, QR y dirección. */
export function cartelImprimible(input: { nombreTienda: string; url: string; qr: string }): string {
  const nombre = escapar(input.nombreTienda.trim() || "Nuestra tienda");
  const url = escapar(input.url.replace(/^https?:\/\//, ""));
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Cartel · ${nombre}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
  .hoja { width: 210mm; height: 297mm; padding: 24mm 20mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10mm; }
  h1 { font-size: 34pt; margin: 0; line-height: 1.1; }
  .bajada { font-size: 20pt; margin: 0; color: #333; }
  img { width: 120mm; height: 120mm; image-rendering: pixelated; }
  .url { font-size: 16pt; font-weight: 600; word-break: break-all; }
</style></head>
<body><main class="hoja">
  <h1>${nombre}</h1>
  <p class="bajada">Escaneá y comprá online</p>
  <img src="${input.qr}" alt="Código QR de la tienda">
  <p class="url">${url}</p>
</main>
<script>window.addEventListener("load", function () { window.print(); });</script>
</body></html>`;
}
