import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("límite por IP en las funciones públicas nuevas", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011002400_limite_por_ip_en_lo_publico.sql"), "utf8");
  it("cada función pública nueva consulta rate_limit_publico al empezar", () => {
    for (const f of ["registrar_busqueda", "registrar_busqueda_sin_resultado", "registrar_clic_de_busqueda",
      "registrar_pedido_de_busqueda", "registrar_vitales_tienda", "registrar_error_app", "pedir_aviso_de_busqueda"]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${f}(`);
    }
    expect(sql.match(/IF NOT public\.rate_limit_publico\(/g)?.length).toBe(7);
  });
  it("el aviso responde con un mensaje legible que la tienda muestra tal cual", () => {
    expect(sql).toContain("RAISE EXCEPTION 'Probá de nuevo en unos minutos' USING ERRCODE = '53400';");
  });
});
