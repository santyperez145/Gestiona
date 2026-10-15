import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { diaAR } from "@/lib/fechaAR";
import { claveDeCompra, contarCompras, frecuenciaEnDias } from "@/lib/comprasDeCliente";

// 2026-10-15, recorriendo Clientes en la app publicada.
describe("hoy es el día de Argentina", () => {
  it("a las 22 h de Argentina sigue siendo hoy, no mañana", () => {
    expect(diaAR(new Date("2026-10-16T01:30:00Z"))).toBe("2026-10-15");
    expect(diaAR("2026-10-15T03:00:00+00:00")).toBe("2026-10-15");
  });
  it("una fecha sin hora no se corre al día anterior", () => {
    expect(diaAR("2026-10-15")).toBe("2026-10-15");
    expect(diaAR(null)).toBe("");
  });
  it("ninguna pantalla vuelve a calcular hoy en UTC", () => {
    let usos = "";
    try {
      usos = execSync(
        `git grep -n -E "new Date\\(\\)\\.toISOString\\(\\)\\.(slice\\(0, (10|7)\\)|split)" -- src ":!src/test" ":!src/lib/fechaAR.ts"`,
        { encoding: "utf8" },
      ).trim();
    } catch (e) {
      // git grep sale con 1 cuando no encuentra nada, que es lo esperado.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(usos).toBe("");
  }, 30_000);
});

describe("una compra es un ticket, no un renglón", () => {
  it("dos productos el mismo día son una compra", () => {
    const renglones = [
      { id: "1", customer_name: "Karima", date: "2026-04-09T03:00:00Z" },
      { id: "2", customer_name: "karima ", date: "2026-04-09T03:00:00Z" },
    ];
    expect(contarCompras(renglones)).toBe(1);
  });
  it("los renglones de un mismo ticket son una compra; sin cliente ni ticket, uno cada uno", () => {
    expect(contarCompras([
      { id: "1", sale_transaction_id: "t1", customer_name: "A" },
      { id: "2", sale_transaction_id: "t1", customer_name: "A" },
      { id: "3", sale_transaction_id: "t2", customer_name: "A" },
      { id: "4", date: "2026-04-09T03:00:00Z" },
      { id: "5", date: "2026-04-09T03:00:00Z" },
    ])).toBe(4);
    expect(claveDeCompra({ sale_transaction_id: "t9" })).toBe("t:t9");
  });
  it("la frecuencia se mide entre días distintos", () => {
    expect(frecuenciaEnDias(["2026-04-09", "2026-04-09"])).toBe(999);
    expect(frecuenciaEnDias(["2026-04-10", "2026-04-10", "2026-05-02", "2026-05-02"])).toBe(22);
  });
});

describe("el recorrido de una pantalla habla de esa pantalla", () => {
  it("no usa la descripción del grupo del menú", async () => {
    const { tutorialDeRuta } = await import("@/lib/tutorials");
    const t = tutorialDeRuta(
      { id: "zz-devoluciones", path: "/zz", label: "Devoluciones", areaHint: "Cuentas por cobrar, facturas ARCA e impuestos" },
      [{ title: "Reintegros", desc: "" }, { title: "Stock", desc: "" }],
    );
    expect(t.resumen).toBe("Reintegros y stock.");
    expect(tutorialDeRuta({ id: "zz-x", path: "/zz", label: "Cupones" }).resumen).toBe("Cupones: para qué sirve esta pantalla y cómo usarla.");
  });
});

describe("una fecha sin hora se muestra en su día", () => {
  it("el 1/10 no se muestra como 30/9", async () => {
    const { fechaLocal } = await import("@/lib/fechaAR");
    expect(fechaLocal("2026-10-01").getDate()).toBe(1);
    expect(fechaLocal("2026-10").getMonth()).toBe(9);
    expect(fechaLocal("2026-10-15T15:30:00Z").toISOString()).toBe("2026-10-15T15:30:00.000Z");
  });
});

describe("la navegación se anota al cambiar la dirección", () => {
  it("un pushState a otra ruta cuenta como navegación aunque la pantalla no llegue a dibujarse", async () => {
    const sw = await import("@/lib/swUpdate");
    sw.instalarDeteccionDeNavegacion(window);
    window.history.pushState({}, "", "/zz-a");
    const t = Date.now();
    window.history.pushState({}, "", "/zz-b");
    expect(sw.navegoHaceInstantes(t + 100)).toBe(true);
  });
});
