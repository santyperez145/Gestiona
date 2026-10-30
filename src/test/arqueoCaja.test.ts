import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BILLETES, denominacionesParaBase, MONEDAS, sistemaPorMedio, totalDenominaciones } from "@/lib/arqueo";
import { comprobanteDesdeRenglon } from "@/lib/cierreZ";

describe("arqueo de caja", () => {
  it("lo del sistema por medio de pago es entradas menos salidas, sin efectivo", () => {
    expect(sistemaPorMedio([
      { entry_type: "opening", payment_method: "efectivo", amount_ars: 1000 },
      { entry_type: "sale_in", payment_method: "efectivo", amount_ars: 5000 },
      { entry_type: "sale_in", payment_method: "Debito", amount_ars: 3000 },
      { entry_type: "sale_in", payment_method: "qr", amount_ars: 2000 },
      { entry_type: "refund_out", payment_method: "qr", amount_ars: 500 },
      { entry_type: "closing", payment_method: "debito", amount_ars: 99 },
    ])).toEqual({ debito: 3000, qr: 1500 });
  });

  it("el conteo de billetes suma billete y moneda del mismo valor", () => {
    const base = denominacionesParaBase({ 20000: 2, 10: 3, 1: 0 });
    expect(base).toEqual({ "20000": 2, "10": 3 });
    expect(totalDenominaciones(base)).toBe(40030);
  });

  it("los billetes y monedas son los vigentes, los mismos que acepta la base", () => {
    expect([...BILLETES]).toEqual([20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10]);
    expect([...MONEDAS]).toEqual([10, 5, 2, 1]);
    const sql = readFileSync("supabase/migrations/20261023000700_arqueos_y_cierres_z.sql", "utf8");
    expect(sql).toContain("ARRAY['20000', '10000', '2000', '1000', '500', '200', '100', '50', '20', '10', '5', '2', '1']");
    const contador = readFileSync("src/components/shared/CashDenominationCountDialog.tsx", "utf8");
    expect(contador).not.toMatch(/value: 5000|value: 25,/);
  });
});

describe("cierre Z cargado a mano", () => {
  it("arma el comprobante del ticket: alícuotas con importe, y la cantidad sale del rango si no se escribe", () => {
    const c = comprobanteDesdeRenglon({
      tipo: "82", desde: "101", hasta: "110", cantidad: "", total: "12100,50",
      neto21: "10000", iva21: "2100", neto105: "", iva105: "", neto27: "", iva27: "", exento: "0,5", noGravado: "", internos: "",
    });
    expect(c).toEqual({ tipo: 82, desde: 101, hasta: 110, cantidad: 10, total: 12100.5, exento: 0.5, no_gravado: 0, internos: 0,
      alicuotas: [{ tasa: 21, neto: 10000, iva: 2100 }] });
  });
});
