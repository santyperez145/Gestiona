import { describe, it, expect } from "vitest";
import {
  SENALES, SENALES_URGENTES, esUrgente, ordenarPorAtencion, resumirPlataforma,
  pesos, desdeUltimoCobro, type OrgHealthRow, type Senal,
} from "@/lib/orgHealth";

const fila = (over: Partial<OrgHealthRow>): OrgHealthRow => ({
  org_id: "x", org_name: "Org", slug: null, org_creada: "2026-01-01",
  plan_name: null, subscription_status: "active",
  gmv_30d: 0, gmv_prev_30d: 0, gmv_total: 0,
  comision_30d: 0, comision_total: 0,
  cobros_30d: 0, cobros_total: 0,
  ultimo_cobro: null, dias_sin_cobrar: null,
  miembros: 1, productos: 0, tiendas_activas: 0,
  variacion_pct: null, senal: "estable",
  ...over,
});

describe("señales", () => {
  it("cubre exactamente las seis que devuelve la vista", () => {
    // Espejo del CASE de 20260802000010. Si la migración agrega una señal y
    // acá no, la UI la muestra sin etiqueta ni acción.
    expect(Object.keys(SENALES).sort()).toEqual(
      ["cayendo", "creciendo", "dormido", "en_riesgo", "estable", "sin_activar"],
    );
  });

  it("cada señal dice qué hacer: una señal sin acción es un adorno", () => {
    for (const meta of Object.values(SENALES)) {
      expect(meta.accion.length).toBeGreaterThan(10);
    }
  });

  it("las urgentes son las que piden acción hoy, y ninguna buena lo es", () => {
    expect(SENALES_URGENTES).toEqual(["en_riesgo", "cayendo", "sin_activar"]);
    expect(esUrgente("creciendo")).toBe(false);
    expect(esUrgente("estable")).toBe(false);
    expect(esUrgente("en_riesgo")).toBe(true);
  });
});

describe("ordenarPorAtencion", () => {
  it("pone primero lo urgente, sin importar cuánto factura", () => {
    const rows = [
      fila({ org_id: "grande", senal: "creciendo", gmv_30d: 5_000_000 }),
      fila({ org_id: "chico", senal: "en_riesgo", gmv_prev_30d: 100 }),
    ];
    expect(ordenarPorAtencion(rows).map(r => r.org_id)).toEqual(["chico", "grande"]);
  });

  it("dentro de la misma señal, primero el que tiene más en juego", () => {
    const rows = [
      fila({ org_id: "a", senal: "cayendo", gmv_prev_30d: 1_000 }),
      fila({ org_id: "b", senal: "cayendo", gmv_prev_30d: 900_000 }),
      fila({ org_id: "c", senal: "cayendo", gmv_prev_30d: 50_000 }),
    ];
    expect(ordenarPorAtencion(rows).map(r => r.org_id)).toEqual(["b", "c", "a"]);
  });

  it("no muta el arreglo original", () => {
    const rows = [fila({ org_id: "a", senal: "estable" }), fila({ org_id: "b", senal: "en_riesgo" })];
    ordenarPorAtencion(rows);
    expect(rows.map(r => r.org_id)).toEqual(["a", "b"]);
  });

  it("una señal desconocida cae al final en vez de romper el orden", () => {
    const rows = [
      fila({ org_id: "raro", senal: "loquesea" as Senal }),
      fila({ org_id: "ok", senal: "estable" }),
    ];
    expect(ordenarPorAtencion(rows).map(r => r.org_id)).toEqual(["ok", "raro"]);
  });
});

describe("resumirPlataforma", () => {
  const rows = [
    fila({ org_id: "1", senal: "en_riesgo",   gmv_30d: 0,       gmv_prev_30d: 200_000, comision_total: 10_000, cobros_30d: 0 }),
    fila({ org_id: "2", senal: "cayendo",     gmv_30d: 30_000,  gmv_prev_30d: 100_000, comision_30d: 1_500, comision_total: 6_500, cobros_30d: 4 }),
    fila({ org_id: "3", senal: "creciendo",   gmv_30d: 300_000, gmv_prev_30d: 100_000, comision_30d: 15_000, comision_total: 20_000, cobros_30d: 40 }),
    fila({ org_id: "4", senal: "sin_activar" }),
  ];

  it("suma GMV, comisión y activos", () => {
    const r = resumirPlataforma(rows);
    expect(r.comercios).toBe(4);
    expect(r.gmv30).toBe(330_000);
    expect(r.gmvPrev30).toBe(400_000);
    expect(r.comision30).toBe(16_500);
    expect(r.comisionTotal).toBe(36_500);
    expect(r.activos30).toBe(2);
  });

  it("el GMV en riesgo se mide con el mes anterior, que es lo que se pierde", () => {
    // El que está en riesgo hoy factura 0: contar su mes actual diría que no
    // hay nada en juego, que es justo al revés.
    expect(resumirPlataforma(rows).gmvEnRiesgo).toBe(300_000);
  });

  it("cuenta por señal sin dejar ninguna afuera", () => {
    const r = resumirPlataforma(rows);
    expect(r.porSenal.en_riesgo).toBe(1);
    expect(r.porSenal.sin_activar).toBe(1);
    expect(r.porSenal.dormido).toBe(0);
  });

  it("sin mes anterior no inventa una variación", () => {
    expect(resumirPlataforma([fila({ gmv_30d: 5_000 })]).variacionPct).toBeNull();
    expect(resumirPlataforma([]).variacionPct).toBeNull();
  });

  it("la variación es porcentual con un decimal", () => {
    const r = resumirPlataforma([fila({ gmv_30d: 150, gmv_prev_30d: 100 })]);
    expect(r.variacionPct).toBe(50);
  });

  it("aguanta números que llegan como texto desde PostgREST", () => {
    // `numeric` viaja como string en JSON: sin el Number() la suma concatena.
    const r = resumirPlataforma([
      fila({ gmv_30d: "1000" as unknown as number }),
      fila({ gmv_30d: "500" as unknown as number }),
    ]);
    expect(r.gmv30).toBe(1500);
  });

  it("una plataforma vacía no rompe", () => {
    const r = resumirPlataforma([]);
    expect(r.gmv30).toBe(0);
    expect(r.comercios).toBe(0);
  });
});

describe("formato", () => {
  it("pesos redondea y agrupa", () => {
    expect(pesos(1234567.89)).toBe("$1.234.568");
    expect(pesos(0)).toBe("$0");
    expect(pesos(null as unknown as number)).toBe("$0");
  });

  it("desdeUltimoCobro distingue 'nunca' de 'hace mucho'", () => {
    // Son estados distintos: uno es onboarding roto, el otro es churn.
    expect(desdeUltimoCobro(null)).toBe("nunca");
    expect(desdeUltimoCobro(0)).toBe("hoy");
    expect(desdeUltimoCobro(1)).toBe("ayer");
    expect(desdeUltimoCobro(12)).toBe("hace 12 días");
    expect(desdeUltimoCobro(35)).toBe("hace 1 mes");
    expect(desdeUltimoCobro(95)).toBe("hace 3 meses");
  });
});
