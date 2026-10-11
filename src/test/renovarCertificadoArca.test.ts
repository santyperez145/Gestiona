import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { comandosCsr, cuitValido, dondeSubirElPedido, textoParaSubject } from "@/lib/renovarCertificadoArca";

const fecha = new Date("2026-10-11T12:00:00Z");

describe("asistente de renovación del certificado de ARCA", () => {
  it("valida el CUIT con su dígito verificador", () => {
    expect(cuitValido("20-12345678-6")).toBe(true);
    expect(cuitValido("20123456786")).toBe(true);
    expect(cuitValido("20123456787")).toBe(false);
    expect(cuitValido("2012345678")).toBe(false);
  });

  it("arma los comandos con el subject que pide ARCA", () => {
    const c = comandosCsr("20-12345678-6", "Nerqia S.A.S.", "produccion", fecha)!;
    expect(c.generarClave).toBe("openssl genrsa -out nerqia-prod-2026-10-11.key 2048");
    expect(c.generarPedido).toBe('openssl req -new -key nerqia-prod-2026-10-11.key -subj "/C=AR/O=Nerqia S.A.S./CN=nerqia/serialNumber=CUIT 20123456786" -out nerqia-prod-2026-10-11.csr');
    expect(comandosCsr("20123456786", "Nerqia", "homologacion", fecha)?.archivoPedido).toBe("nerqia-homo-2026-10-11.csr");
  });

  it("no deja romper el comando con lo que se escribe en la razón social", () => {
    expect(textoParaSubject('Peña "SA"/CN=otro; rm -rf')).toBe("Pena SA CN otro rm -rf");
    const c = comandosCsr("20123456786", 'Peña "SA"/CN=x', "produccion", fecha)!;
    expect(c.generarPedido).toContain("/O=Pena SA CN x/");
    expect(c.generarPedido.match(/"/g)).toHaveLength(2);
  });

  it("sin CUIT válido o sin razón social no arma nada", () => {
    expect(comandosCsr("123", "Nerqia", "produccion")).toBeNull();
    expect(comandosCsr("20123456786", "  ", "produccion")).toBeNull();
  });

  it("dice dónde subir el pedido según el ambiente y la pantalla lo muestra", () => {
    expect(dondeSubirElPedido("produccion")).toContain("Administración de Certificados Digitales");
    expect(dondeSubirElPedido("homologacion")).toContain("WSASS");
    const page = readFileSync(resolve(process.cwd(), "src/pages/PlatformAfipPage.tsx"), "utf8");
    expect(page).toContain("<RenovarCertificadoArca cuit={cuit} razonSocial={razonSocial} ambiente={environment} />");
  });
});
