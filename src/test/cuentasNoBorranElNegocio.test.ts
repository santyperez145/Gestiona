import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14: borrar la cuenta de quien cargó los datos se llevaba en cascada
// productos, ventas, compras, deudas y ajustes del negocio. La matriz
// scripts/cuentas-no-borran-el-negocio-matrix.sql lo prueba en la base.
describe("borrar una cuenta no borra el negocio", () => {
  const m = fs.readFileSync("supabase/migrations/20261014002300_cuentas_no_borran_el_negocio.sql", "utf8");
  it("las tablas del negocio quedan RESTRICT y los ajustes SET NULL", () => {
    for (const t of ["customer_communications", "deals", "debts", "marketing_posts", "products", "purchases", "sales", "seller_payouts"]) {
      expect(m, t).toContain(`ALTER TABLE public.${t} ADD CONSTRAINT ${t}_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT`);
    }
    expect(m).toContain("REFERENCES auth.users(id) ON DELETE SET NULL;");
  });
});
