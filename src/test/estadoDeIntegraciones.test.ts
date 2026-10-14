import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { estadoDeIntegraciones, type FuentesDeIntegraciones } from "@/lib/estadoDeIntegraciones";

// 2026-10-14: el panel leía integration_logs (nadie escribe ahí Mercado Pago,
// ARCA ni API), mostraba ARCA siempre «configurado» y el refresco usaba un
// estado viejo. Ahora sale de las conexiones reales.
const vacio: FuentesDeIntegraciones = { mercadoPago: null, arca: null, claves: [], whatsapp: null, correo: null, fallidas: [] };
const ahora = new Date("2026-10-14T12:00:00Z");
const de = (f: Partial<FuentesDeIntegraciones>) => Object.fromEntries(estadoDeIntegraciones({ ...vacio, ...f }, ahora).map(t => [t.id, [t.estado, t.detalle]]));

describe("estado de integraciones", () => {
  it("sin nada conectado, nada figura configurado (ARCA tampoco)", () => {
    const e = de({});
    expect(Object.values(e).map(x => x[0])).toEqual(["sin_configurar", "sin_configurar", "sin_configurar", "sin_configurar", "sin_configurar"]);
    expect(e.correo[1]).toBe("Se usa el correo de Nerqia");
  });

  it("Mercado Pago: conectada, vencida, en prueba o con error", () => {
    expect(de({ mercadoPago: { conectado: true, vigente: true, nickname: "FERRE", live_mode: true } }).mercadopago).toEqual(["ok", "FERRE"]);
    expect(de({ mercadoPago: { conectado: true, vigente: false } }).mercadopago[0]).toBe("atencion");
    expect(de({ mercadoPago: { conectado: true, expires_at: "2026-10-01T00:00:00Z" } }).mercadopago[1]).toMatch(/venció/);
    expect(de({ mercadoPago: { conectado: true, live_mode: false } }).mercadopago[1]).toMatch(/modo prueba/);
    expect(de({ mercadoPago: { conectado: true, last_error: "invalid_token" } }).mercadopago).toEqual(["error", "invalid_token"]);
  });

  it("ARCA: producción ok, homologación avisa, delegación sin verificar avisa", () => {
    expect(de({ arca: { configured: true, environment: "produccion", cuit: "20123456789", punto_venta: 3, razon_social: "Ferretería SA" } }).arca)
      .toEqual(["ok", "Ferretería SA · CUIT 20123456789 · PV 3"]);
    expect(de({ arca: { configured: true, environment: "homologacion" } }).arca[1]).toMatch(/homologación/);
    expect(de({ arca: { configured: true, environment: "produccion", modo: "delegado", delegacion_verificada: false } }).arca[0]).toBe("atencion");
  });

  it("API: cuenta sólo claves vivas y muestra el último uso", () => {
    expect(de({ claves: [{ expires_at: "2026-01-01T00:00:00Z" }] }).api[0]).toBe("sin_configurar");
    expect(de({ claves: [{ last_used_at: "2026-10-10T15:00:00Z" }, { last_used_at: null }] }).api).toEqual(["ok", "2 claves activas · último uso 10/10/2026"]);
  });

  it("una fuente que no se pudo leer lo dice, en vez de mostrarse vacía", () => {
    expect(de({ fallidas: ["arca"], arca: null }).arca).toEqual(["sin_datos", "No se pudo leer el estado: actualizá"]);
    expect(de({ claves: null }).api[0]).toBe("sin_datos");
  });

  it("la pantalla ya no lee integration_logs ni usa un estado viejo en el intervalo", () => {
    const pagina = fs.readFileSync("src/pages/IntegrationsPage.tsx", "utf8");
    expect(pagina).not.toContain("integration_logs");
    expect(pagina).toContain("estadoDeIntegraciones({");
    expect(pagina).not.toContain(`label: "AFIP"`);
  });
});
