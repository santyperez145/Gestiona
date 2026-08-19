import { describe, it, expect } from "vitest";
import {
  saldoNatural, verificarCuadre, mensajeDeCuadre, cuentaAceptaPartidas,
  compararCodigos, resumir, TIPOS_CUENTA,
  type PartidaLedger, type SaldoCuenta,
} from "@/lib/ledger";

describe("saldoNatural — el signo sale del tipo", () => {
  // Los mismos números que verificó el bloque SQL contra producción.
  it("un activo crece por el debe", () => {
    expect(saldoNatural("activo", 12100, 0)).toBe(12100);
  });

  it("un gasto también", () => {
    expect(saldoNatural("gasto", 500, 0)).toBe(500);
  });

  // Si se restara siempre igual, las ventas aparecerían en negativo.
  it("un ingreso crece por el haber, no en negativo", () => {
    expect(saldoNatural("ingreso", 0, 10000)).toBe(10000);
  });

  it("un pasivo también", () => {
    expect(saldoNatural("pasivo", 0, 2100)).toBe(2100);
  });

  it("el patrimonio también", () => {
    expect(saldoNatural("patrimonio", 0, 5000)).toBe(5000);
  });

  it("un movimiento en contra resta", () => {
    expect(saldoNatural("activo", 12100, 12100)).toBe(0);
    expect(saldoNatural("ingreso", 10000, 10000)).toBe(0);
  });

  it("el catálogo dice por qué lado crece cada uno", () => {
    expect(TIPOS_CUENTA.activo.crecePor).toBe("debe");
    expect(TIPOS_CUENTA.ingreso.crecePor).toBe("haber");
    expect(TIPOS_CUENTA.gasto.estado).toBe("resultado");
    expect(TIPOS_CUENTA.pasivo.estado).toBe("balance");
  });
});

describe("verificarCuadre", () => {
  const asiento: PartidaLedger[] = [
    { cuenta: "1.1.01", debe: 12100 },
    { cuenta: "4.1.01", haber: 10000 },
    { cuenta: "2.1.02", haber: 2100 },
  ];

  it("un asiento que cuadra", () => {
    const c = verificarCuadre(asiento);
    expect(c.cuadra).toBe(true);
    expect(c.totalDebe).toBe(12100);
    expect(c.totalHaber).toBe(12100);
    expect(c.diferencia).toBe(0);
  });

  it("uno que no cuadra dice cuánto falta", () => {
    const c = verificarCuadre([
      { cuenta: "1.1.01", debe: 1000 },
      { cuenta: "4.1.01", haber: 999 },
    ]);
    expect(c.cuadra).toBe(false);
    expect(c.problema).toBe("no_cuadra");
    expect(c.diferencia).toBe(1);
  });

  it("una sola partida no puede cuadrar contra nada", () => {
    expect(verificarCuadre([{ cuenta: "1.1.01", debe: 100 }]).problema).toBe("sin_partidas");
  });

  it("sin partidas con importe tampoco", () => {
    expect(verificarCuadre([{ cuenta: "1.1.01" }, { cuenta: "4.1.01" }]).problema).toBe("sin_partidas");
    expect(verificarCuadre([]).problema).toBe("sin_partidas");
    expect(verificarCuadre(null).problema).toBe("sin_partidas");
  });

  it("una partida con debe y haber a la vez no significa nada", () => {
    const c = verificarCuadre([
      { cuenta: "1.1.01", debe: 100, haber: 100 },
      { cuenta: "4.1.01", haber: 100 },
    ]);
    expect(c.cuadra).toBe(false);
    expect(c.problema).toBe("partida_ambigua");
  });

  // Sumar 0.1 + 0.2 en punto flotante da 0.30000000000000004. Un asiento que
  // cuadra perfecto quedaría rechazado por un error que no existe en la base.
  it("los centavos se comparan como enteros, no en punto flotante", () => {
    const c = verificarCuadre([
      { cuenta: "1.1.01", debe: 0.1 },
      { cuenta: "1.1.02", debe: 0.2 },
      { cuenta: "4.1.01", haber: 0.3 },
    ]);
    expect(c.cuadra).toBe(true);
    expect(c.diferencia).toBe(0);
  });

  it("y un centavo de diferencia sí se detecta", () => {
    const c = verificarCuadre([
      { cuenta: "1.1.01", debe: 100.01 },
      { cuenta: "4.1.01", haber: 100.00 },
    ]);
    expect(c.cuadra).toBe(false);
    expect(c.diferencia).toBeCloseTo(0.01, 2);
  });
});

describe("mensajeDeCuadre", () => {
  const fmt = (n: number) => `$${n.toLocaleString("es-AR")}`;

  it("dice de qué lado falta", () => {
    const faltaHaber = verificarCuadre([
      { cuenta: "1.1.01", debe: 1000 }, { cuenta: "4.1.01", haber: 900 },
    ]);
    expect(mensajeDeCuadre(faltaHaber, fmt)).toContain("haber");

    const faltaDebe = verificarCuadre([
      { cuenta: "1.1.01", debe: 900 }, { cuenta: "4.1.01", haber: 1000 },
    ]);
    expect(mensajeDeCuadre(faltaDebe, fmt)).toContain("debe");
  });

  it("no dice nada cuando cuadra", () => {
    const ok = verificarCuadre([
      { cuenta: "1.1.01", debe: 100 }, { cuenta: "4.1.01", haber: 100 },
    ]);
    expect(mensajeDeCuadre(ok, fmt)).toBeNull();
  });
});

describe("cuentaAceptaPartidas", () => {
  it("una cuenta de agrupación no recibe partidas", () => {
    expect(cuentaAceptaPartidas({ codigo: "1", nombre: "Activo", tipo: "activo", imputable: false })).toBe(false);
  });

  it("una inactiva tampoco", () => {
    expect(cuentaAceptaPartidas({ codigo: "1.1.01", nombre: "Caja", tipo: "activo", is_active: false })).toBe(false);
  });

  it("una hoja activa sí", () => {
    expect(cuentaAceptaPartidas({ codigo: "1.1.01", nombre: "Caja", tipo: "activo" })).toBe(true);
  });
});

describe("compararCodigos", () => {
  // Como texto, '1.10' va antes que '1.9'. En un plan de cuentas eso está mal.
  it("ordena por número de tramo, no alfabéticamente", () => {
    const codigos = ["1.10", "1.9", "1.1", "2.1", "1.1.02", "1.1.01"];
    expect([...codigos].sort(compararCodigos))
      .toEqual(["1.1", "1.1.01", "1.1.02", "1.9", "1.10", "2.1"]);
  });
});

describe("resumir", () => {
  const saldos: SaldoCuenta[] = [
    { codigo: "1.1.01", nombre: "Caja",   tipo: "activo",  saldo: 12100 },
    { codigo: "1.1.02", nombre: "Banco",  tipo: "activo",  saldo: 5000 },
    { codigo: "2.1.02", nombre: "IVA",    tipo: "pasivo",  saldo: 2100 },
    { codigo: "4.1.01", nombre: "Ventas", tipo: "ingreso", saldo: 10000 },
    { codigo: "5.2.01", nombre: "Comis.", tipo: "gasto",   saldo: 1500 },
  ];

  it("agrupa por tipo", () => {
    const r = resumir(saldos);
    expect(r.activo).toBe(17100);
    expect(r.pasivo).toBe(2100);
    expect(r.ingresos).toBe(10000);
    expect(r.gastos).toBe(1500);
  });

  // Una venta cobrada por MercadoPago que no se acreditó ya es un ingreso, y la
  // plata no está. Confundirlo hace creer que un buen mes fue malo.
  it("el resultado es ingresos menos gastos, no lo que hay en la caja", () => {
    expect(resumir(saldos).resultado).toBe(8500);
  });

  it("sin datos no explota", () => {
    expect(resumir(null).resultado).toBe(0);
    expect(resumir([]).activo).toBe(0);
  });
});
