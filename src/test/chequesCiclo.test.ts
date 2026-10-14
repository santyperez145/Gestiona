import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { accionesDeCheque, etiquetaDeEstado } from "@/lib/cheques";

// 2026-10-14 (páginas legacy): la cartera de cheques cambiaba de estado sin
// reglas, «Depositar» aparecía en los emitidos y un depositado no podía
// rebotar. La base custodia el ciclo (20261014001400); esto es su espejo.
describe("cheques: acciones según tipo y estado", () => {
  it("recibido: pendiente se deposita, rebota o cancela; depositado se acredita o rebota", () => {
    expect(accionesDeCheque("received", "pending").map(a => a.estado)).toEqual(["deposited", "bounced", "cancelled"]);
    expect(accionesDeCheque("received", "deposited").map(a => a.estado)).toEqual(["cleared", "bounced"]);
  });

  it("emitido: no se deposita; se debita, rebota o anula", () => {
    expect(accionesDeCheque("issued", "pending").map(a => a.estado)).toEqual(["cleared", "bounced", "cancelled"]);
    expect(etiquetaDeEstado("issued", "cleared")).toBe("Debitado");
    expect(etiquetaDeEstado("received", "cleared")).toBe("Acreditado");
  });

  it("los estados finales no tienen acciones", () => {
    for (const estado of ["cleared", "bounced", "cancelled"] as const) {
      expect(accionesDeCheque("received", estado)).toEqual([]);
      expect(accionesDeCheque("issued", estado)).toEqual([]);
    }
  });

  it("la pantalla usa las acciones válidas, deja la fecha a la base y avisa errores de carga", () => {
    const pagina = fs.readFileSync("src/pages/ChequesPage.tsx", "utf8");
    expect(pagina).toContain("accionesDeCheque(c.type, c.status).map(");
    expect(pagina).not.toContain("update.deposited_at");
    expect(pagina).toContain('toast.error("No se pudieron cargar los cheques: " + error.message)');
    const sql = fs.readFileSync("supabase/migrations/20261014001400_cheques_ciclo_de_vida.sql", "utf8");
    expect(sql).toContain("WHEN OLD.type = 'received' AND OLD.status = 'deposited' THEN NEW.status IN ('cleared', 'bounced')");
  });
});
