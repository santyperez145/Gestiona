import { describe, it, expect } from "vitest";
import {
  ventaDiaria, diasDeCobertura, rotacionAnual,
  clasificarABC, clasificarXYZ, coeficienteVariacion, clasificarVelocidad,
  stockDeSeguridad, puntoDeReposicion, loteOptimo, riesgoDeQuiebre,
  calcularMetricas,
} from "@/lib/stockMetrics";

describe("ventaDiaria", () => {
  // El bug que originó el módulo: `int / int` en Postgres trunca, y con todos
  // los productos vendiendo menos de 1 por día la cuenta daba 0 para todos.
  it("divide de verdad, no en enteros", () => {
    expect(ventaDiaria(5, 90)).toBeCloseTo(0.0556, 4);
    expect(ventaDiaria(179, 90)).toBeCloseTo(1.9889, 4);
    expect(ventaDiaria(2, 90)).toBeCloseTo(0.0222, 4);
  });

  it("sin ventas o sin días da 0", () => {
    expect(ventaDiaria(0, 90)).toBe(0);
    expect(ventaDiaria(10, 0)).toBe(0);
    expect(ventaDiaria(NaN, 90)).toBe(0);
  });
});

describe("diasDeCobertura", () => {
  it("dice cuántos días aguanta el stock", () => {
    expect(diasDeCobertura(100, 2)).toBe(50);
    expect(diasDeCobertura(7, 0.0222)).toBeCloseTo(315.3, 0);
  });

  // "Alcanza para siempre" no es un número, y un 9999 se termina graficando.
  it("sin ventas devuelve null, no infinito", () => {
    expect(diasDeCobertura(100, 0)).toBeNull();
    expect(diasDeCobertura(100, -1)).toBeNull();
  });

  it("sin stock la cobertura es cero, no null", () => {
    expect(diasDeCobertura(0, 2)).toBe(0);
  });
});

describe("rotacionAnual", () => {
  it("anualiza contra el stock promedio", () => {
    // 90 unidades en 90 días = 1/día = 365 al año, sobre 100 de stock → 3,65
    expect(rotacionAnual(90, 90, 100)).toBeCloseTo(3.65, 2);
  });

  // Un producto que nunca tuvo stock no rota poco: no tiene el dato.
  it("sin stock promedio devuelve null, no infinito", () => {
    expect(rotacionAnual(90, 90, 0)).toBeNull();
  });
});

describe("clasificarABC", () => {
  it("aplica Pareto 80/95", () => {
    expect(clasificarABC(45)).toBe("A");
    expect(clasificarABC(80)).toBe("A");
    expect(clasificarABC(80.1)).toBe("B");
    expect(clasificarABC(95)).toBe("B");
    expect(clasificarABC(95.1)).toBe("C");
  });
});

describe("coeficienteVariacion y XYZ", () => {
  it("una demanda estable da CV bajo", () => {
    const cv = coeficienteVariacion([10, 10, 10, 10]);
    expect(cv).toBe(0);
    expect(clasificarXYZ(cv)).toBe("X");
  });

  it("una demanda errática da CV alto", () => {
    const cv = coeficienteVariacion([0, 0, 30, 0, 1]);
    expect(cv).not.toBeNull();
    expect(clasificarXYZ(cv)).toBe("Z");
  });

  // Con dos puntos el desvío no significa nada: clasificar de errático a algo
  // que vendió 1 y después 3 sería ruido disfrazado de dato.
  it("con menos de tres períodos no clasifica", () => {
    expect(coeficienteVariacion([5, 9])).toBeNull();
    expect(coeficienteVariacion([])).toBeNull();
    expect(clasificarXYZ(null)).toBeNull();
  });

  it("una serie toda en cero no tiene variabilidad medible", () => {
    expect(coeficienteVariacion([0, 0, 0])).toBeNull();
  });
});

describe("clasificarVelocidad", () => {
  // El umbral absoluto de "2 por día" clasificaba de lento a todo el catálogo
  // de una importadora. La cobertura es adimensional y significa lo mismo en
  // cualquier rubro.
  it("clasifica por cobertura, no por unidades por día", () => {
    expect(clasificarVelocidad(10, 5)).toBe("rapido");
    expect(clasificarVelocidad(60, 5)).toBe("normal");
    expect(clasificarVelocidad(200, 5)).toBe("lento");
    expect(clasificarVelocidad(400, 5)).toBe("muerto");
  });

  it("con stock y sin ventas es muerto", () => {
    expect(clasificarVelocidad(null, 5)).toBe("muerto");
  });

  // Un producto sin stock no es lento: es un producto que no se tiene.
  it("sin stock no se clasifica", () => {
    expect(clasificarVelocidad(null, 0)).toBeNull();
    expect(clasificarVelocidad(10, 0)).toBeNull();
  });
});

describe("stockDeSeguridad", () => {
  it("aplica Z x sigma x raiz(lead time)", () => {
    // 95% → z=1,65; σ=2; L=9 → 1,65 × 2 × 3 = 9,9 → 10
    expect(stockDeSeguridad(2, 9, 95)).toBe(10);
  });

  // Usar L de frente en vez de √L sobredimensiona el colchón, y eso es plata
  // quieta.
  it("crece con la raíz del lead time, no con el lead time", () => {
    const l4 = stockDeSeguridad(2, 4, 95)!;
    const l16 = stockDeSeguridad(2, 16, 95)!;
    expect(l16 / l4).toBeCloseTo(2, 1);   // √16/√4 = 2, no 4
  });

  it("un nivel de servicio más alto pide más colchón", () => {
    expect(stockDeSeguridad(2, 9, 99)!).toBeGreaterThan(stockDeSeguridad(2, 9, 90)!);
  });

  // No hay default razonable: comprar de más cuesta caja, de menos la venta.
  it("sin desvío o sin lead time devuelve null", () => {
    expect(stockDeSeguridad(null, 9)).toBeNull();
    expect(stockDeSeguridad(2, null)).toBeNull();
    expect(stockDeSeguridad(2, 0)).toBeNull();
    expect(stockDeSeguridad(2, 9, 77)).toBeNull();   // nivel no soportado
  });
});

describe("puntoDeReposicion", () => {
  it("cubre el lead time más el colchón", () => {
    expect(puntoDeReposicion(2, 10, 5)).toBe(25);
    expect(puntoDeReposicion(0.5, 30, 0)).toBe(15);
  });

  // Inventar 7 días es la clase de dato que después se usa para comprar.
  it("sin lead time no hay punto de reposición", () => {
    expect(puntoDeReposicion(2, null, 5)).toBeNull();
    expect(puntoDeReposicion(2, 0, 5)).toBeNull();
  });

  it("sin colchón conocido usa sólo el consumo del lead time", () => {
    expect(puntoDeReposicion(2, 10, null)).toBe(20);
  });
});

describe("loteOptimo", () => {
  it("aplica Wilson", () => {
    // √(2 × 1000 × 50 / 10) = √10000 = 100
    expect(loteOptimo(1000, 50, 10)).toBe(100);
  });

  // Con S y H puestos a ojo el EOQ sale redondo, se ve serio y manda a comprar
  // la cantidad equivocada.
  it("sin costos configurados devuelve null en vez de un número plausible", () => {
    expect(loteOptimo(1000, null, 10)).toBeNull();
    expect(loteOptimo(1000, 50, null)).toBeNull();
    expect(loteOptimo(0, 50, 10)).toBeNull();
  });
});

describe("riesgoDeQuiebre", () => {
  it("compara contra el punto de reposición cuando existe", () => {
    expect(riesgoDeQuiebre(0, 20, 10)).toBe("quebrado");
    expect(riesgoDeQuiebre(15, 20, 10)).toBe("critico");
    expect(riesgoDeQuiebre(25, 20, 10)).toBe("atencion");
    expect(riesgoDeQuiebre(50, 20, 10)).toBe("ok");
  });

  // Menos preciso, pero verdadero: no se inventa el lead time para poder
  // mostrar el número "bueno".
  it("sin punto de reposición cae a la cobertura", () => {
    expect(riesgoDeQuiebre(5, null, 10)).toBe("critico");
    expect(riesgoDeQuiebre(5, null, 20)).toBe("atencion");
    expect(riesgoDeQuiebre(5, null, 200)).toBe("ok");
  });

  it("un producto que no vende no se va a quebrar", () => {
    expect(riesgoDeQuiebre(5, null, null)).toBe("ok");
  });
});

describe("calcularMetricas — el caso real de esta organización", () => {
  // Datos reales: ELFBAR ICE KING vendió 2 unidades en 90 días con stock 11.
  // La función vieja lo clasificaba `slow` por división entera; en realidad
  // tiene stock para más de un año.
  const elfbar = calcularMetricas({
    stockActual: 11,
    unidadesVendidas: 2,
    diasDelPeriodo: 90,
    acumuladoPct: 40,
  });

  it("la venta diaria deja de ser cero", () => {
    expect(elfbar.ventaDiaria).toBeGreaterThan(0);
    expect(elfbar.ventaDiaria).toBeCloseTo(0.022, 3);
  });

  it("con 11 unidades y 2 ventas en 90 días, el stock sobra", () => {
    expect(elfbar.cobertura).toBeGreaterThan(365);
    expect(elfbar.velocidad).toBe("muerto");
  });

  it("sin lead time no inventa punto de reposición ni sugerencia", () => {
    expect(elfbar.puntoReposicion).toBeNull();
    expect(elfbar.stockSeguridad).toBeNull();
    expect(elfbar.loteOptimo).toBeNull();
    expect(elfbar.sugerenciaCompra).toBeNull();
  });

  it("con lead time y serie sí calcula todo", () => {
    const m = calcularMetricas({
      stockActual: 5,
      unidadesVendidas: 90,
      diasDelPeriodo: 90,
      serieDemanda: [30, 28, 32],
      leadTimeDias: 15,
      acumuladoPct: 30,
      costoPorPedido: 5000,
      costoAlmacenamientoAnual: 200,
    });
    expect(m.puntoReposicion).not.toBeNull();
    expect(m.stockSeguridad).not.toBeNull();
    expect(m.loteOptimo).not.toBeNull();
    expect(m.xyz).toBe("X");            // demanda estable
    expect(m.riesgo).toBe("critico");   // 5 unidades bajo el punto de reposición
    expect(m.sugerenciaCompra).toBeGreaterThan(0);
  });

  it("no sugiere comprar lo que ya está cubierto", () => {
    const m = calcularMetricas({
      stockActual: 500,
      unidadesVendidas: 90,
      diasDelPeriodo: 90,
      serieDemanda: [30, 28, 32],
      leadTimeDias: 15,
    });
    expect(m.sugerenciaCompra).toBeNull();
    expect(m.riesgo).toBe("ok");
  });
});
