import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { resumenDeFusion } from "@/lib/fusionClientes";

// 2026-10-14: «Combinar clientes» movía ventas, deudas y puntos en tres pasos
// desde el navegador y borraba la ficha. De las 29 tablas que apuntan a
// `customers`, las otras 26 perdían el vínculo o se borraban en cascada
// (actividades del CRM, tickets del portal, segmentos…), y un corte dejaba la
// combinación a medias. Ahora es `fusionar_clientes`, una sola transacción.
describe("combinar clientes", () => {
  const pagina = fs.readFileSync("src/pages/CustomersPage.tsx", "utf8");
  const sql = fs.readFileSync("supabase/migrations/20261014000800_fusionar_clientes.sql", "utf8");

  it("las dos formas de combinar usan la operación atómica y ninguna borra la ficha a mano", () => {
    expect(pagina.match(/await fusionarClientesDB\(activeOrg\.id, srcProfile\.id,/g)).toHaveLength(2);
    expect(pagina).not.toMatch(/const reasignar = async/);
    expect(pagina).not.toMatch(/from\("customers"\)\.delete\(\)/);
  });

  it("la base recorre todas las referencias al cliente, no una lista fija", () => {
    expect(sql).toContain("WHERE c.contype = 'f' AND c.confrelid = 'public.customers'::regclass");
    expect(sql).toContain("i.indisunique AND NOT i.indisprimary");
    expect(sql).toContain("has_org_role(p_org, v_user, ARRAY['owner', 'admin'])");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fusionar_clientes\(uuid, uuid, uuid\) FROM PUBLIC, anon;/);
  });

  it("no reescribe el nombre facturado de los pedidos online", () => {
    const lista = sql.slice(sql.indexOf("v_con_nombre text[] :="), sql.indexOf("BEGIN\n  IF v_user IS NULL"));
    expect(lista).toContain("'sales', 'debts', 'loyalty_points', 'saldo_a_favor_movimientos'");
    expect(lista).not.toContain("ecommerce_orders");
  });

  it("el aviso dice qué pasó al cliente, en castellano", () => {
    expect(resumenDeFusion({ sales: 2, debts: 1, crm_activities: 1, customer_segment_members: 2 }))
      .toBe("2 ventas, 1 deuda y 3 registros más pasaron al cliente.");
    expect(resumenDeFusion({ sales: 1 })).toBe("1 venta pasó al cliente.");
    expect(resumenDeFusion({ crm_activities: 1 })).toBe("1 registro pasó al cliente.");
    expect(resumenDeFusion({ sales: 1, debts: 1 })).toBe("1 venta y 1 deuda pasaron al cliente.");
    expect(resumenDeFusion({})).toBeUndefined();
  });
});
