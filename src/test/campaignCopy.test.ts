import { describe, it, expect } from "vitest";
import { redactarCampana } from "../lib/campaignCopy";

/**
 * Redactor propio de campañas — sin Anthropic.
 *
 * El copy sale del Business Core real (negocio, producto, precio, cupón,
 * vencimiento). Cero copys inventados: si el comercio no carga productos,
 * el cuerpo no nombra nada que no exista.
 */
describe("redactarCampana", () => {
  const base = {
    negocio: "Perfumes Sur",
    productos: [
      { nombre: "Sauvage 100ml", precio_ars: 185000, precio_oferta_ars: 148000, url_producto: "https://t.com/p/1" },
      { nombre: "Oud Malaki", precio_ars: 210000, precio_oferta_ars: null as null },
    ],
    cupon: "VIP20",
    vence_el: new Date("2026-09-30T12:00:00Z").toISOString(),
  };

  it("liquidación lidera el asunto con el % real máximo", () => {
    const r = redactarCampana({ ...base, tipo: "liquidacion" });
    expect(r.subject).toContain("Perfumes Sur");
    expect(r.subject).toContain("20% off"); // (1 - 148000/185000) ≈ 20%
    expect(r.body_html).toContain("Sauvage 100ml");
    expect(r.body_html).toContain("VIP20");
  });

  it("el cupón aparece como código textual", () => {
    const r = redactarCampana({ ...base, tipo: "flash" });
    expect(r.body_html).toContain("VIP20");
  });

  it("el copy nunca inventa un producto: lista sólo lo que entra", () => {
    const r = redactarCampana({ negocio: "X", tipo: "novedad", productos: [] });
    expect(r.body_html).not.toContain("<li");
    expect(r.subject).toContain("X");
  });

  it("recuperación de carrito nombra el producto abandonado", () => {
    const r = redactarCampana({ ...base, tipo: "recuperacion_carrito" });
    expect(r.subject).toContain("dejaste Sauvage 100ml");
    expect(r.body_html).toContain("Terminar mi compra");
  });

  it("sanitiza el nombre del comercio y de productos", () => {
    const r = redactarCampana({
      negocio: 'Tienda <script>alert(1)</script>',
      tipo: "novedad",
      productos: [{ nombre: "<b>Mal</b>", precio_ars: 100 }],
    });
    expect(r.subject).not.toContain("<script>");
    expect(r.body_html).not.toContain("<script>");
    expect(r.body_html).not.toContain("<b>Mal</b>");
  });

  it("la urgencia usa la fecha ISO cargada en es-AR", () => {
    const r = redactarCampana({ ...base, tipo: "flash" });
    // Node puede formatear "30 de septiembre" o "30-septiembre" según ICU.
    expect(r.body_html).toMatch(/Vigente hasta el \d{1,2}[-\s](de )?[a-záéíóú]+/i);
  });

  it("cada tipo trae una razón visible para el comercio", () => {
    for (const tipo of ["liquidacion", "flash", "reengagement", "novedad", "recuperacion_carrito"] as const) {
      const r = redactarCampana({ ...base, tipo });
      expect(r.razon.length).toBeGreaterThan(10);
    }
  });
});