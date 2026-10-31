import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preventa: vender lo que todavía no llegó", () => {
  const sql = readFileSync("supabase/migrations/20261030001900_preventa.sql", "utf8");

  it("el disponible baja de cero sólo hasta el cupo, en la línea y en la reserva", () => {
    expect(sql).toContain("IF v_disp + v_cupo < p_qty THEN");
    expect(sql).toContain("IF v_disp + public.cupo_de_preventa(v_pid, v_vid) < v_qty THEN");
    // Con stock se vende primero lo que hay; el resto es preventa.
    expect(sql).toContain("v_preventa := GREATEST(p_qty - GREATEST(v_disp, 0), 0);");
    expect(sql).toContain("THEN jsonb_build_object('preventa', jsonb_build_object(");
    // «quedan 3», no «quedan 3.000»: el cupo y el stock admiten decimales.
    expect(sql).toContain("v_product.name, trim_scale(GREATEST(v_disp + v_cupo, 0)), p_qty");
    expect(sql).toContain("trim_scale(GREATEST(v_disp, 0)), trim_scale(v_qty)");
  });

  it("vence sola pasado el día de llegada y no aplica a productos con variantes", () => {
    // La fecha es el «Próximo ingreso» del producto: un solo dato.
    expect(sql).toContain("AND p.expected_restock_at >= public.hoy_ar()");
    expect(sql).toContain("product.expected_restock_at AS preventa_llega");
    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active)");
    expect(sql).toContain("CHECK (preventa_cupo >= 0)");
    expect(sql).not.toContain("ADD COLUMN IF NOT EXISTS preventa_llega");
  });

  it("lo vendido en preventa vigente no figura como stock negativo", () => {
    expect(sql).toContain("AND NOT (p.preventa_cupo > 0 AND p.expected_restock_at >= public.hoy_ar() AND -p.stock <= p.preventa_cupo);");
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8"))
      .toContain("'20261030001900': 'scripts/preventa-matrix.sql'");
  });
});
