import { describe, it, expect } from "vitest";
import {
  primeros, resumirStockBajo, resumirMargenBajo, resumirClientesInactivos,
  resumirDeudasVencidas, resumirVencimientos,
} from "../../supabase/functions/_shared/resumenDeAlertas";
import { rutaDelAviso } from "@/lib/rutaDelAviso";

// 2026-10-15: una corrida de check-alerts dejó 51 avisos sin leer en Exentry.
describe("resúmenes de alertas", () => {
  it("lista los primeros y cuenta el resto", () => {
    expect(primeros(["A"])).toBe("A");
    expect(primeros(["A", "B"])).toBe("A y B");
    expect(primeros(["A", "B", "C", "D", "E"])).toBe("A, B, C y 2 más");
  });

  it("stock bajo: un aviso, sin archivados, los más urgentes primero", () => {
    const r = resumirStockBajo([
      { name: "X", stock: 4 }, { name: "Y", stock: 0 }, { name: "Z", stock: 1, is_active: false },
    ], 5);
    expect(r?.title).toBe("2 productos con stock bajo");
    expect(r?.message).toContain("Y (0) y X (4)");
    expect(r?.message).toContain("1 ya no tiene stock");
    expect(r?.url).toBe("/planificacion?vista=reposicion");
    expect(resumirStockBajo([], 5)).toBeNull();
  });

  it("un cliente que nunca compró no está inactivo", () => {
    const ahora = new Date("2026-10-15T12:00:00Z");
    const r = resumirClientesInactivos(
      [{ id: "1", name: "Karima" }, { id: "2", name: "Santiago Perez" }, { id: "3", name: "Nueva" }],
      [
        { customer_name: "karima", date: "2026-04-09T03:00:00Z", total_ars: 103500 },
        { customer_id: "3", date: "2026-10-10T03:00:00Z", total_ars: 10 },
      ],
      60, ahora,
    );
    expect(r?.title).toBe("1 cliente no compra hace más de 60 días");
    expect(r?.message).toContain("Karima ($103.500)");
    expect(r?.message).not.toContain("Santiago");
  });

  it("margen, deudas y vencimientos se resumen en un aviso cada uno", () => {
    expect(resumirMargenBajo([{ name: "A", sale_price_ars: 100, profit_per_unit_ars: 5 }], 15)?.title)
      .toBe("1 producto con margen menor a 15%");
    const d = resumirDeudasVencidas([
      { customer_name: "Ana", remaining_ars: 1000, due_date: "2026-10-01" },
      { customer_name: "Beto", remaining_ars: 3000, due_date: "2026-10-05" },
    ], new Date("2026-10-15T15:00:00Z"));
    expect(d?.title).toBe("2 deudas vencidas por $4.000");
    expect(d?.message).toContain("Beto ($3.000) y Ana ($1.000)");
    expect(d?.message).toContain("hace 14 días");
    const v = resumirVencimientos([
      { name: "Leche", expiry_date: "2026-10-10", stock: 3 },
      { name: "Yogur", expiry_date: "2026-10-20", stock: 2 },
    ], "2026-10-15");
    expect(v?.title).toBe("1 producto vencido y 1 por vencer");
    expect(v?.message).toContain("Por vencer: Yogur (20/10/2026)");
  });

  it("tocar un aviso lleva a su pantalla, sólo si es una ruta interna", () => {
    expect(rutaDelAviso({ entity_type: "ruta", entity_id: "/clientes" })).toBe("/clientes");
    expect(rutaDelAviso({ entity_type: "ruta", entity_id: "https://otro.sitio" })).toBeNull();
    expect(rutaDelAviso({ entity_type: "ruta", entity_id: "//otro.sitio" })).toBeNull();
    expect(rutaDelAviso({ entity_type: "sale", entity_id: "/clientes" })).toBeNull();
  });
});
