import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CompartirTienda from "@/components/ecommerce/CompartirTienda";
import { archivoDelQr, cartelImprimible, enlaceWhatsApp, mensajeParaCompartir } from "@/lib/compartirTienda";

describe("compartir la tienda", () => {
  it("arma el mensaje de WhatsApp con el link, sin elegir destinatario", () => {
    const texto = mensajeParaCompartir("Aurea", "https://aurea.nerqia.app");
    expect(texto).toContain("Aurea");
    expect(texto).toContain("https://aurea.nerqia.app");
    expect(enlaceWhatsApp(texto)).toBe(`https://wa.me/?text=${encodeURIComponent(texto)}`);
    expect(mensajeParaCompartir("  ", "https://x")).toContain("¡Ya tenemos tienda online!");
  });

  it("el cartel escapa el nombre y no promete nada que la tienda no ofrezca", () => {
    const html = cartelImprimible({ nombreTienda: "<b>Mía & Co</b>", url: "https://mia.nerqia.app", qr: "data:image/png;base64,AAA" });
    expect(html).toContain("&lt;b&gt;Mía &amp; Co&lt;/b&gt;");
    expect(html).not.toContain("<b>Mía");
    expect(html).toContain("mia.nerqia.app");
    expect(html).toContain('src="data:image/png;base64,AAA"');
    expect(html).not.toMatch(/env[ií]o|retir/i);
  });

  it("nombra el archivo del QR sin acentos ni símbolos", () => {
    expect(archivoDelQr("Café Ñandú & Cía")).toBe("qr-cafe-nandu-cia.png");
    expect(archivoDelQr("!!!")).toBe("qr-tienda.png");
  });

  it("ofrece copiar, WhatsApp, QR y cartel", () => {
    render(<CompartirTienda url="https://aurea.nerqia.app" nombreTienda="Aurea" destacado />);
    expect(screen.getByRole("heading", { name: "Tu tienda está online: compartila" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copiar enlace/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Mandar por WhatsApp/ }).getAttribute("href")).toContain("https://wa.me/?text=");
    expect(screen.getByRole("button", { name: /Descargar QR/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Imprimir cartel/ })).toBeTruthy();
  });
});
