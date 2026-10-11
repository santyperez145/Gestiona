import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ingresos y retiros de caja", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011002200_caja_ingresos_y_retiros.sql"), "utf8");
  it("el servidor exige permiso, caja abierta, motivo y no deja retirar más de lo que hay", () => {
    expect(sql).toContain("PERFORM public.exigir_permiso(v_session.org_id, 'pos', 'edit', 'registrar movimientos de caja');");
    expect(sql).toContain("IF v_session.status <> 'open' THEN");
    expect(sql).toContain("RAISE EXCEPTION 'Escribí el motivo del movimiento'");
    expect(sql).toContain("IF round(p_monto, 2) > v_esperado THEN");
  });

  it("la caja muestra el formulario con selector compartido", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/CashSessionPage.tsx"), "utf8");
    const form = readFileSync(resolve(process.cwd(), "src/components/pos/MovimientoDeCaja.tsx"), "utf8");
    expect(page).toContain("<MovimientoDeCaja sessionId={openSession.id} onRegistrado={load} />");
    expect(form).toContain('from "@/components/ui/select"');
    expect(form).not.toContain("<select");
  });
});
