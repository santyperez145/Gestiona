import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260821000001_recepcion_idempotente.sql");
const verif = leer("supabase/verificaciones/20260821_recepcion_idempotente.sql");
const pagina = leer("src/pages/PurchaseOrdersPage.tsx");

/**
 * I6a — guarda de la recepción idempotente.
 *
 * ── El agujero que tapó, medido ───────────────────────────────────────────
 *
 * `receive_purchase_order` parecía protegida porque al recibir una orden
 * COMPLETA el estado pasa a "recibida" y la guarda de estado frena el segundo
 * intento.
 *
 * La recepción **parcial** no. Verificado contra producción con rollback:
 * recibir 4 de 10, y repetir el mismo pedido, dejaba **8**. La orden queda en
 * "confirmada" tras una parcial, así que nada lo impedía.
 *
 * Es la misma familia del bug que hacía que vender 3 bajara 6.
 */
describe("recepción de mercadería idempotente", () => {
  it("existe el envoltorio y NO reimplementa la función original", () => {
    expect(migracion).toContain("v_resultado := public.receive_purchase_order(");
    // Si copiara la lógica, las dos versiones se separarían con el tiempo.
    expect(migracion).not.toContain("UPDATE public.purchase_order_items");
    expect(migracion).not.toContain("record_stock_movement");
  });

  it("la organización sale de la orden, no del navegador", () => {
    // Si la mandara el cliente, cualquiera podría reservar claves en la
    // organización de otro y bloquearle las recepciones.
    expect(migracion).toContain("FROM public.purchase_orders po WHERE po.id = p_order_id");
    expect(migracion).not.toMatch(/p_org\s+uuid/);
  });

  it("el hash incluye los renglones: dos entregas distintas son distintas", () => {
    // Recibir 4 y después otros 4 de la misma orden es legítimo. Lo que se
    // frena es el MISMO pedido repetido, no la segunda entrega.
    expect(migracion).toContain("'items', p_items");
    expect(migracion).toContain("'location_id', p_location_id");
  });

  it("una recepción fallida se puede reintentar", () => {
    // Sin esto la clave queda trabada y el comercio no puede recibir nunca más.
    expect(migracion).toContain("idempotencia_fallar");
  });

  it("no es llamable por anon", () => {
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.receive_purchase_order_idem");
    expect(migracion).toMatch(/GRANT EXECUTE[\s\S]{0,140}TO\s+authenticated/);
    expect(migracion).not.toMatch(/GRANT EXECUTE[\s\S]{0,140}anon/);
  });

  it("la pantalla genera la clave una vez por intento, en un ref", () => {
    expect(pagina).toContain("claveIdem = useRef");
    expect(pagina).toContain("if (!claveIdem.current) claveIdem.current = crypto.randomUUID()");
    expect(pagina).toContain("receive_purchase_order_idem");
  });

  it("la clave se limpia al cerrar: la próxima entrega es otra entrega", () => {
    // Si no se limpiara, una segunda entrega legítima de la misma orden
    // devolvería la respuesta vieja y la mercadería no entraría.
    expect(pagina).toMatch(/if \(!open\) claveIdem\.current = null/);
  });

  it("la verificación prueba que NO sobre-bloquea", () => {
    // Frenar una entrega legítima sería peor que el problema original.
    expect(verif).toContain("recepcion_legitima_con_otra_clave");
    expect(verif).toContain("zz-clave-B");
    expect(verif.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });
});
