import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describirAjuste, textoDeshacerAjuste } from "@/lib/ajustesDePrecio";

describe("ajustes de precio con historial y deshacer", () => {
  const sql = readFileSync("supabase/migrations/20261030000500_ajustes_de_precio_deshacer.sql", "utf8");

  it("envuelve los tres ajustes sin cambiarlos y guarda antes y después", () => {
    expect(sql).toContain("v_resultado := public.ajustar_precios_en_bloque(");
    expect(sql).toContain("v_resultado := public.actualizar_precios_por_cotizacion(");
    expect(sql).toContain("v_resultado := public.recalcular_precios_desde_costo_usd(");
    expect(sql).toContain("AND v_antes->(p.id::text) IS DISTINCT FROM public.foto_precio_producto(p);");
  });

  it("deshacer no pisa lo editado después, una vez y con permiso", () => {
    expect(sql).toContain("IF v_actual = v_item.despues THEN");
    expect(sql).toContain("PERFORM public.exigir_permiso(v_ajuste.org_id, 'products', 'edit', 'deshacer un ajuste de precios');");
    expect(sql).toContain("IF v_ajuste.deshecho_at IS NOT NULL THEN");
  });

  it("describe cada ajuste como lo pidió el comercio", () => {
    expect(describirAjuste({ origen: "porcentaje", parametros: { porcentaje: 8, que: "precio", categoria: "Pinturas" } })).toBe("+8% al precio · Pinturas");
    expect(describirAjuste({ origen: "porcentaje", parametros: { porcentaje: -5, que: "costo_y_precio" } })).toBe("-5% al costo y precio");
    expect(describirAjuste({ origen: "cotizacion", parametros: { rate_before: 1200, rate_after: 1350, nombre: "Blue" } })).toBe("Cotización 1200 → 1350 (Blue)");
    expect(describirAjuste({ origen: "costo_usd", parametros: { tipo_cambio: 1400, markup_pct: 60 } })).toBe("Desde costo U$S a $1400 con 60% de markup");
  });

  it("el aviso dice qué volvió y qué se respetó", () => {
    expect(textoDeshacerAjuste({ restaurados: 120, con_cambios_posteriores: 0 })).toBe("Ajuste deshecho: 120 productos volvieron a su precio anterior.");
    expect(textoDeshacerAjuste({ restaurados: 1, con_cambios_posteriores: 2 })).toBe("Ajuste deshecho: 1 producto volvió a su precio anterior; 2 se habían vuelto a editar y quedaron como están.");
  });
});
