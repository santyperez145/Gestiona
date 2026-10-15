import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { estadoDeServicios } from "@/lib/estadoDeServicios";

// 2026-10-15: «Incluido en tu plan» decía «✓ Activo» fijo en todo, aunque
// WhatsApp no estuviera configurado en la plataforma o el respaldo fallara.
const ahora = new Date("2026-10-15T12:00:00Z");
const de = (f: Parameters<typeof estadoDeServicios>[0]) =>
  Object.fromEntries(estadoDeServicios({ ...f, ahora }).map(s => [s.id, s.etiqueta]));

describe("servicios incluidos", () => {
  it("con correo listo y WhatsApp sin configurar lo dice", () => {
    const e = de({ mensajeria: { email_listo: true, whatsapp_listo: false }, ultimoRespaldo: { status: "completed", created_at: "2026-10-15T03:30:00Z" }, puedeVerRespaldos: true });
    expect(e).toMatchObject({ correo: "✓ Activo", campanas: "✓ Activo", whatsapp: "Próximamente", respaldos: "✓ Activo" });
  });
  it("sin correo configurado, los envíos quedan en espera", () => {
    expect(de({ mensajeria: { email_listo: false, smtp_configurado: false }, ultimoRespaldo: null, puedeVerRespaldos: true }).correo).toBe("En espera");
  });
  it("un respaldo fallido o viejo pide atención; sin datos no inventa", () => {
    expect(de({ mensajeria: {}, ultimoRespaldo: { status: "failed", created_at: "2026-10-14T03:30:00Z" }, puedeVerRespaldos: true }).respaldos).toBe("Atención");
    expect(de({ mensajeria: {}, ultimoRespaldo: { status: "completed", created_at: "2026-09-30T03:30:00Z" }, puedeVerRespaldos: true }).respaldos).toBe("Atención");
    expect(de({ mensajeria: null, ultimoRespaldo: null, puedeVerRespaldos: false }).correo).toBe("Sin datos");
  });
  it("el panel ya no escribe «✓ Activo» fijo", () => {
    const panel = fs.readFileSync("src/components/integrations/PlatformServicesPanel.tsx", "utf8");
    expect(panel).not.toContain(">✓ Activo<");
    expect(panel).toContain('supabase.rpc("mensajeria_de_plataforma")');
  });
});

describe("la IA sigue al plan", () => {
  it("con la prueba vencida no dice «Activo»", async () => {
    const { estadoDeServicios } = await import("@/lib/estadoDeServicios");
    const base = { mensajeria: { email_listo: true }, ultimoRespaldo: null, puedeVerRespaldos: false };
    expect(estadoDeServicios({ ...base, iaIncluida: false }).find(s => s.id === "ia")?.etiqueta).toBe("Plan pago");
    expect(estadoDeServicios({ ...base, iaIncluida: true }).find(s => s.id === "ia")?.etiqueta).toBe("✓ Activo");
    expect(estadoDeServicios(base).find(s => s.id === "ia")?.etiqueta).toBe("…");
  });
});
