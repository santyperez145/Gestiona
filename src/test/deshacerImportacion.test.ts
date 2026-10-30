import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { textoDeDeshacer, type ResumenDeshacer } from "@/lib/catalogImportSession";

const cero: ResumenDeshacer = {
  restaurados: 0, con_cambios_posteriores: 0, desactivados: 0, conservados_con_movimientos: 0,
  stock_revertido: 0, stock_cambiado_despues: 0, redirects_eliminados: 0,
};

describe("deshacer una importación de catálogo", () => {
  const sql = readFileSync("supabase/migrations/20261030000300_deshacer_importacion_catalogo.sql", "utf8");

  it("no pisa lo que alguien cambió después de importar", () => {
    expect(sql).toContain("IF public.valor_importado_igual(v_actual->v_campo, v_row.normalized->v_campo) THEN");
    expect(sql).toContain("IF v_stock = v_row.stock_after THEN");
  });

  it("no borra productos: desactiva sólo los creados sin movimientos", () => {
    expect(sql).toContain("UPDATE public.products SET is_active = false WHERE id = v_row.result_product_id;");
    expect(sql).not.toMatch(/DELETE FROM public\.products/);
  });

  it("una sola vez, owner o admin, y la sesión entera en una transacción", () => {
    expect(sql).toContain("IF v_batch.deshecho_at IS NOT NULL THEN");
    expect(sql).toContain("v_parcial := public.deshacer_importacion_catalogo(v_batch);");
    expect(sql).toContain("RAISE EXCEPTION 'Sólo owner o admin puede deshacer una importación de catálogo' USING ERRCODE = '42501';");
  });

  it("cuenta lo hecho y avisa lo que quedó como estaba", () => {
    const t = textoDeDeshacer({ ...cero, restaurados: 2, desactivados: 1, stock_revertido: 3, con_cambios_posteriores: 1, stock_cambiado_despues: 1 });
    expect(t.hecho).toBe("Importación deshecha: 2 productos volvieron a como estaban, 1 producto nuevo desactivado, 3 stocks revertidos.");
    expect(t.aviso).toBe("1 producto tenía cambios posteriores que se respetaron; 1 stock cambió después de importar y no se tocó.");
    expect(textoDeDeshacer(cero)).toEqual({ hecho: "Importación deshecha: no había nada para revertir.", aviso: null });
  });
});
