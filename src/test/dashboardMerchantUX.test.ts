import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardias de la mejora de UX del Dashboard y de la Tienda Online.
 *
 * El dashboard es la primera pantalla del Commerce OS: si las acciones rápidas
 * son genéricas, el merchant pierde tiempo navegando en vez de despachar y
 * cobrar. Estos tests fijan el contrato de la integración:
 *
 *   1. El Dashboard computa un pulse de pedidos (despacho/retiro/cobros).
 *   2. FocoDelDia reutiliza ese pulse sin duplicar queries.
 *   3. Las Quick Actions priorizan la operación antes que la navegación.
 *   4. Los campos clave de configuración de tienda tienen ayuda descubrible.
 *   5. Cambiar de tab con cambios sin guardar pide confirmación.
 */

const root = process.cwd();
const leer = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("dashboard operativo: acciones contextuales", () => {
  const dashboard = leer("src/pages/Dashboard.tsx");

  it("el dashboard calcula el pulse de pedidos online en una sola carga", () => {
    expect(dashboard).toContain("setOrderPulse");
    expect(dashboard).toContain("countFulfillmentPulse");
    expect(dashboard).toContain("countActionableUnpaidOrders");
  });

  it("las Quick Actions priorizan la operación (despachar, cobrar) antes que la navegación", () => {
    const acciones = dashboard.indexOf("<CommerceQuickActions");
    const despachar = dashboard.indexOf("Despachar pedidos");
    const cobros = dashboard.indexOf("Cobros pendientes");
    const nuevaVenta = dashboard.indexOf("Nueva Venta");
    expect(acciones).toBeGreaterThan(-1);
    expect(despachar, "falta acción contextual de despacho").toBeGreaterThan(-1);
    expect(cobros, "falta acción contextual de cobros").toBeGreaterThan(-1);
    expect(despachar).toBeGreaterThan(acciones);
    expect(cobros).toBeGreaterThan(acciones);
    expect(nuevaVenta, "falta acción de nueva venta").toBeGreaterThan(-1);
    // Despacho va antes que la acción genérica: primero lo que ya cobró.
    expect(despachar).toBeLessThan(nuevaVenta);
  });

  it("FocoDelDia recibe el pulse por props y no duplica queries", () => {
    const foco = leer("src/components/dashboard/FocoDelDia.tsx");
    expect(foco).toContain("porDespachar?: number");
    expect(foco).toContain("porRetirar?: number");
    expect(foco).toContain("pendientesDePago?: number");
    expect(foco).toContain("p.porDespachar !== undefined && p.porRetirar !== undefined");
  });

  it("Quick Actions muestra el contador como badge, no dentro del texto", () => {
    const acciones = leer("src/components/commerce/CommerceQuickActions.tsx");
    expect(acciones).toContain("extraerBadge");
    expect(acciones).toContain("tabular-nums");
  });

  it("las alertas del dashboard son filas accionables con CTA Resolver", () => {
    expect(dashboard).toContain("Requieren atención");
    expect(dashboard).toContain("Resolver →");
    // La fila entera es clicable — no sólo un link escondido.
    expect(dashboard).toMatch(/<Link\s+key=\{i\}\s+to=\{a\.link \?\? "#"\}/);
  });
});

describe("ayuda descubrible en configuración de tienda", () => {
  it("FieldHint existe y usa tooltip accesible", () => {
    const hint = leer("src/components/shared/FieldHint.tsx");
    expect(hint).toContain("TooltipContent");
    expect(hint).toContain("HelpCircle");
    expect(hint).toContain('aria-label="Ayuda sobre este campo"');
  });

  it("los campos clave de la tienda tienen FieldHint", () => {
    const store = leer("src/pages/EcommerceStorePage.tsx");
    expect(store).toContain('import FieldHint from "@/components/shared/FieldHint"');
    // SLA
    expect(store).toContain("Tiempo objetivo de preparación (SLA)");
    expect(store.match(/<FieldHint/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(store).toContain("Envío gratis desde");
    expect(store).toContain("Peso por producto sin peso cargado (kg)");
  });

  it("cambiar de tab con cambios sin guardar pide confirmación", () => {
    const store = leer("src/pages/EcommerceStorePage.tsx");
    expect(store).toMatch(/const goToTab = async \(next: StoreTab\)/);
    expect(store).toContain("storeFormDirty && !(await confirmDiscardStoreForm())");
  });
});