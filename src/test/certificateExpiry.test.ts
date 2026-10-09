import { describe, expect, it } from "vitest";
import { vencimientoCertificado } from "@/lib/certificateExpiry";

const ahora = new Date("2026-10-09T12:00:00Z");
const en = (dias: number) => new Date(ahora.getTime() + dias * 86_400_000 + 3_600_000).toISOString();

describe("vencimiento del certificado de la plataforma", () => {
  it.each([
    [120, "ok"], [60, "aviso"], [31, "aviso"], [30, "urgente"], [8, "urgente"], [7, "critico"], [0, "critico"],
  ])("a %i días es %s", (dias, nivel) => {
    expect(vencimientoCertificado(en(dias), ahora).nivel).toBe(nivel);
  });

  it("vencido o sin fecha nunca se presenta como vigente", () => {
    expect(vencimientoCertificado(en(-2), ahora)).toMatchObject({ nivel: "vencido" });
    expect(vencimientoCertificado(null, ahora)).toMatchObject({ nivel: "desconocido", dias: null });
    expect(vencimientoCertificado("no-es-fecha", ahora).nivel).toBe("desconocido");
  });

  it("dice qué hacer", () => {
    expect(vencimientoCertificado(en(5), ahora).mensaje).toMatch(/CSR/);
    expect(vencimientoCertificado(en(-1), ahora).mensaje).toMatch(/todos los comercios/);
  });
});
