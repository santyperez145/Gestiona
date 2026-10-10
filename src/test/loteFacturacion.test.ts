import { describe, expect, it } from "vitest";
import { resultadoLote, sugerenciaFallaLote } from "@/lib/loteFacturacion";

describe("facturación por lote: resultado por pedido", () => {
  it("traduce cada falla de la base a qué hacer", () => {
    const r = resultadoLote({
      creadas: 3, sin_importe: 1, restantes: 2,
      fallas: [
        { orden: "#1001", error: "El pedido necesita revision fiscal: no tiene un desglose historico de IVA" },
        { orden: "#1002", error: "Falta declarar la condicion frente al IVA del emisor" },
      ],
    });
    expect(r).toMatchObject({ creadas: 3, sinImporte: 1, restantes: 2 });
    expect(r.fallas[0].queHacer).toMatch(/a mano/);
    expect(r.fallas[1].queHacer).toMatch(/Ajustes › ARCA/);
  });

  it("siempre sugiere algo, aunque el motivo sea desconocido", () => {
    expect(sugerenciaFallaLote("algo raro")).toMatch(/volvé a generar/);
    expect(resultadoLote(null)).toEqual({ creadas: 0, sinImporte: 0, restantes: 0, fallas: [] });
  });
});
