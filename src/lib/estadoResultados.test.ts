import { describe, it, expect } from "vitest";
import {
  RESULTADO_VACIO, margenPorcentual, resultadoPorcentual,
  confianzaDelMargen, filasDelResultado, rangoDelPreset,
  type Resultado,
} from "./estadoResultados";

const base = (p: Partial<Resultado> = {}): Resultado => ({
  ...RESULTADO_VACIO,
  ventas: 20000, costo_mercaderia: 6400, margen_bruto: 13600,
  ingresos: 20000, comision_medios_pago: 1000, gastos_operativos: 1000,
  resultado: 12600, asientos: 1, ...p,
});

describe("margenPorcentual", () => {
  it("es margen sobre VENTAS, no sobre costo", () => {
    // Dividir por el costo daría 212,5%, que es el error clásico.
    expect(margenPorcentual(base())).toBe(68);
  });

  it("sin ventas devuelve null, no 0", () => {
    // Son cosas distintas: 0% dice "vendiste y no ganaste"; null dice "no
    // vendiste". Mostrar el primero cuando pasó el segundo hace que alguien
    // decida sobre un dato que no existe.
    expect(margenPorcentual(base({ ventas: 0, margen_bruto: 0 }))).toBeNull();
  });

  it("un margen negativo se informa, no se recorta a cero", () => {
    // Vender por debajo del costo es un dato que hay que ver.
    expect(margenPorcentual(base({ ventas: 1000, costo_mercaderia: 1500, margen_bruto: -500 })))
      .toBe(-50);
  });

  it("no rompe con valores no finitos", () => {
    expect(margenPorcentual(base({ ventas: NaN }))).toBeNull();
  });
});

describe("resultadoPorcentual", () => {
  it("mide sobre los ingresos totales, flete incluido", () => {
    expect(resultadoPorcentual(base({ ingresos: 25000, resultado: 5000 }))).toBe(20);
  });

  it("sin ingresos devuelve null", () => {
    expect(resultadoPorcentual(base({ ingresos: 0 }))).toBeNull();
  });
});

describe("confianzaDelMargen", () => {
  // Es la función que hace honesto el tablero: si hay ventas sin costo, el
  // margen sale mejor de lo que la realidad es.
  it("sin ventas huérfanas, el margen es confiable", () => {
    expect(confianzaDelMargen(base())).toEqual({
      confiable: true, sinCosto: 0, proporcion: 0,
    });
  });

  it("avisa cuando hay ventas asentadas sin costo", () => {
    const c = confianzaDelMargen(base({ ventas_sin_costo: 3, asientos: 10 }));
    expect(c.confiable).toBe(false);
    expect(c.sinCosto).toBe(3);
    expect(c.proporcion).toBeCloseTo(0.3);
    expect(c.aviso).toContain("menor al que ves");
  });

  it("el aviso está en singular cuando es una sola", () => {
    expect(confianzaDelMargen(base({ ventas_sin_costo: 1, asientos: 4 })).aviso)
      .toContain("Una venta");
  });

  it("sin asientos para comparar, avisa igual", () => {
    // Lo que importa es que hay ventas sin costo, no la proporción exacta.
    const c = confianzaDelMargen(base({ ventas_sin_costo: 2, asientos: 0 }));
    expect(c.confiable).toBe(false);
    expect(c.proporcion).toBe(1);
  });

  it("la proporción nunca pasa de 1", () => {
    expect(confianzaDelMargen(base({ ventas_sin_costo: 50, asientos: 3 })).proporcion).toBe(1);
  });
});

describe("filasDelResultado", () => {
  it("el margen bruto va ANTES que los gastos operativos", () => {
    // No es estético: es la pregunta que responde si el negocio funciona. Un
    // P&L que muestra primero las comisiones invita a optimizar lo que menos
    // mueve la aguja.
    const filas = filasDelResultado(base());
    expect(filas.findIndex(f => f.clave === "margen"))
      .toBeLessThan(filas.findIndex(f => f.clave === "comision_mp"));
  });

  it("no muestra líneas en cero", () => {
    const claves = filasDelResultado(base({ fletes_cobrados: 0, otros_gastos: 0 }))
      .map(f => f.clave);
    expect(claves).not.toContain("fletes_cobrados");
    expect(claves).not.toContain("otros");
  });

  it("muestra el flete cobrado cuando existe", () => {
    expect(filasDelResultado(base({ fletes_cobrados: 500 })).map(f => f.clave))
      .toContain("fletes_cobrados");
  });

  it("siempre termina en el resultado del período", () => {
    const filas = filasDelResultado(base());
    expect(filas.at(-1)?.clave).toBe("resultado");
    expect(filas.at(-1)?.tipo).toBe("total");
  });

  it("el costo se marca como resta, no como ingreso", () => {
    expect(filasDelResultado(base()).find(f => f.clave === "costo")?.tipo).toBe("resta");
  });
});

describe("rangoDelPreset", () => {
  it("el mes anterior termina el último día de ese mes", () => {
    // Se usa el día 0 del mes actual para no listar cuántos días tiene cada
    // mes ni tratar el año bisiesto.
    const { desde, hasta } = rangoDelPreset("mes_anterior");
    expect(desde.endsWith("-01")).toBe(true);
    expect(new Date(hasta) >= new Date(desde)).toBe(true);
  });

  it("30 días son 30 contando hoy, no 31", () => {
    const { desde, hasta } = rangoDelPreset("30dias");
    const dias = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000;
    expect(Math.round(dias)).toBe(29);
  });

  it("todos los presets devuelven fechas ISO válidas y ordenadas", () => {
    for (const p of ["mes", "mes_anterior", "30dias", "anio"] as const) {
      const { desde, hasta } = rangoDelPreset(p);
      expect(desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(desde) <= new Date(hasta)).toBe(true);
    }
  });
});
