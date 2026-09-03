import { describe, expect, it } from "vitest";
import {
  etiquetaEstadoMedio,
  mediosOAuthDelCatalogo,
  puedeConectarMedioCatalogo,
  type MedioCatalogo,
} from "@/lib/paymentCatalog";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = (partial: Partial<MedioCatalogo>): MedioCatalogo => ({
  provider: "modo",
  nombre: "MODO",
  descripcion: "Próximamente",
  conexion: "oauth",
  integracion: "declarado",
  conectado: false,
  habilitado: false,
  cuenta: null,
  soporta_cuotas: true,
  orden: 20,
  ...partial,
});

describe("paymentCatalog", () => {
  it("lista OAuth externos y oculta el rail Mercado Pago", () => {
    const list = mediosOAuthDelCatalogo([
      base({ provider: "mercadopago", nombre: "Mercado Pago", orden: 10, integracion: "produccion" }),
      base({ provider: "modo", orden: 20 }),
      base({ provider: "naranjax", nombre: "Naranja X", orden: 30 }),
      base({ provider: "gestionapay", nombre: "Nerqia Pay", conexion: "plataforma", orden: 5 }),
      base({ provider: "transferencia", nombre: "Transferencia", conexion: "ninguna", orden: 50 }),
    ]);
    expect(list.map((m) => m.provider)).toEqual(["modo", "naranjax"]);
  });

  it("etiqueta declarado como Próximamente", () => {
    expect(etiquetaEstadoMedio("declarado")).toEqual({ label: "Próximamente", tone: "soon" });
    expect(etiquetaEstadoMedio("produccion")).toEqual({ label: "Disponible", tone: "live" });
  });

  it("no ofrece Conectar a OAuth sin adapter (Slice B)", () => {
    expect(puedeConectarMedioCatalogo(base({ integracion: "declarado" }))).toBe(false);
    expect(puedeConectarMedioCatalogo(base({ integracion: "produccion", provider: "modo" }))).toBe(false);
    expect(puedeConectarMedioCatalogo(base({ provider: "mercadopago", integracion: "produccion" }))).toBe(false);
  });
});

describe("PaymentConnectionsPanel catálogo", () => {
  const panel = readFileSync(
    resolve(import.meta.dirname, "..", "components", "integrations", "PaymentConnectionsPanel.tsx"),
    "utf8",
  );
  const migracion = readFileSync(
    resolve(import.meta.dirname, "..", "..", "supabase", "migrations", "20260902000040_catalogo_pay_oauth_proximamente.sql"),
    "utf8",
  );
  const migracionMarca = readFileSync(
    resolve(import.meta.dirname, "..", "..", "supabase", "migrations", "20260903000070_nerqia_identidad_canonica.sql"),
    "utf8",
  );

  it("lee medios_de_pago_de y no inventa Conectar para próximamente", () => {
    expect(panel).toContain('medios_de_pago_de');
    expect(panel).toContain("mediosOAuthDelCatalogo");
    expect(panel).toContain("Próximamente");
    expect(panel).toContain("Sin adapter aún");
    expect(panel).toContain("Activar Nerqia Pay");
  });

  it("alinea el catálogo SQL: Nerqia Pay producto, oauth declarado sin cobrar", () => {
    expect(migracionMarca).toContain("nombre_publico = 'Nerqia Pay'");
    expect(migracion).toContain("WHERE codigo = 'gestionapay'");
    expect(migracion).toContain("Hoy no cobra");
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.medios_de_pago_de");
  });
});
