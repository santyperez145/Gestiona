import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dondeSubirElPedido } from "@/lib/renovarCertificadoArca";

const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), "utf8");

describe("renovación del certificado de ARCA", () => {
  it("dice dónde subir el pedido según el ambiente y la pantalla lo muestra", () => {
    expect(dondeSubirElPedido("produccion")).toContain("Administración de Certificados Digitales");
    expect(dondeSubirElPedido("homologacion")).toContain("WSASS");
    expect(leer("src/pages/PlatformAfipPage.tsx")).toContain("<RenovarCertificadoArca estado={estado}");
  });

  // 2026-10-15: un certificado de homologación cargado como producción dejó a
  // todos los comercios sin poder facturar, y la pantalla no lo sabía.
  it("la clave del pedido se genera en el servidor y el certificado se prueba antes de activarlo", () => {
    const edge = leer("supabase/functions/afip-platform-cert/index.ts");
    expect(edge).toContain('action === "generar_pedido"');
    expect(edge).toContain("generarClaveYPedido({ cuit: String(plat.cuit)");
    expect(leer("supabase/functions/_shared/certificadoArca.ts")).toContain("crypto.subtle.generateKey");
    expect(edge).toMatch(/pedirTicketWsaa\(wsaaUrl\(plat\.pedido_ambiente\)[\s\S]*ARCA no aceptó el certificado; no se cambió nada/);
    expect(edge).toMatch(/environment === "produccion" && \/test\/i\.test\(emisor\)/);
    expect(leer("src/components/platform/RenovarCertificadoArca.tsx")).not.toMatch(/openssl|BEGIN PRIVATE KEY/);
  });
});
