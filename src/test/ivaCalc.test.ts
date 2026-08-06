import { describe, it, expect } from "vitest";
import {
  desglosarIva, ivaDeOrden, leyendaIva, alicuotaValida,
  type ConfiguracionIva,
} from "@/lib/ivaCalc";

const CONFIG: ConfiguracionIva = { habilitado: true, tasa: 21, preciosIncluyenIva: true };

describe("desglosarIva — precio con IVA incluido", () => {
  it("saca el IVA de adentro, no lo suma", () => {
    const d = desglosarIva(121, 21, true);
    expect(d.neto).toBe(100);
    expect(d.iva).toBe(21);
    expect(d.total).toBe(121);
  });

  // Es el caso real de esta organización: 21% con precios IVA incluido.
  it("el total facturado de producción se desglosa bien", () => {
    const d = desglosarIva(1_549_574, 21, true);
    expect(d.total).toBe(1_549_574);
    expect(d.neto).toBeCloseTo(1_280_639.67, 2);
    expect(d.iva).toBeCloseTo(268_934.33, 2);
  });

  // Confundir las dos formas es un error del 21% en la dirección equivocada.
  it("NO es lo mismo que sumarle 21%", () => {
    const incluido = desglosarIva(121, 21, true);
    const sumado = desglosarIva(121, 21, false);
    expect(incluido.total).toBe(121);
    expect(sumado.total).toBe(146.41);
    expect(incluido.iva).not.toBe(sumado.iva);
  });
});

describe("desglosarIva — precio sin IVA", () => {
  it("suma el IVA arriba", () => {
    const d = desglosarIva(100, 21, false);
    expect(d.neto).toBe(100);
    expect(d.iva).toBe(21);
    expect(d.total).toBe(121);
  });

  it("aplica la alícuota reducida", () => {
    const d = desglosarIva(100, 10.5, false);
    expect(d.iva).toBe(10.5);
    expect(d.total).toBe(110.5);
  });
});

describe("el redondeo no puede perder centavos", () => {
  // Si se redondean neto e IVA por separado, la suma se va uno o dos centavos y
  // la factura no cierra contra la orden.
  it("neto + iva da exactamente el total, en muchos importes", () => {
    for (const total of [
      0.01, 1, 3.33, 99.99, 100, 121, 1000.05, 12_345.67,
      33_333.33, 1_549_574, 7_777.77, 19.99, 0.99,
    ]) {
      const d = desglosarIva(total, 21, true);
      expect(d.neto + d.iva, `falla en ${total}`).toBeCloseTo(d.total, 10);
    }
  });

  it("también sin IVA incluido", () => {
    for (const base of [0.01, 1, 3.33, 99.99, 12_345.67]) {
      const d = desglosarIva(base, 21, false);
      expect(d.neto + d.iva, `falla en ${base}`).toBeCloseTo(d.total, 10);
    }
  });
});

describe("casos borde", () => {
  // Un producto exento tiene IVA cero, no IVA desconocido.
  it("tasa cero deja todo como neto", () => {
    const d = desglosarIva(100, 0, true);
    expect(d.neto).toBe(100);
    expect(d.iva).toBe(0);
    expect(d.tasa).toBe(0);
  });

  it("importes inválidos no rompen ni inventan", () => {
    expect(desglosarIva(0, 21, true).iva).toBe(0);
    expect(desglosarIva(-100, 21, true).iva).toBe(0);
    expect(desglosarIva(NaN, 21, true).iva).toBe(0);
    expect(desglosarIva(100, NaN, true).iva).toBe(0);
    expect(desglosarIva(100, -5, true).iva).toBe(0);
  });
});

describe("ivaDeOrden", () => {
  it("desglosa el total cobrado con la config de la organización", () => {
    const d = ivaDeOrden(121, CONFIG);
    expect(d.iva).toBe(21);
    expect(d.neto).toBe(100);
  });

  // Un monotributista no discrimina IVA.
  it("con IVA deshabilitado no inventa impuesto", () => {
    const d = ivaDeOrden(121, { ...CONFIG, habilitado: false });
    expect(d.iva).toBe(0);
    expect(d.neto).toBe(121);
  });

  it("sin configuración tampoco", () => {
    expect(ivaDeOrden(121, null).iva).toBe(0);
    expect(ivaDeOrden(121, undefined).iva).toBe(0);
  });

  // El envío es un servicio gravado: dejarlo afuera subdeclara el IVA de cada
  // venta con envío. Se desglosa el total cobrado, envío incluido.
  it("el envío entra en la base imponible", () => {
    const soloMercaderia = ivaDeOrden(100_000, CONFIG);
    const conEnvio = ivaDeOrden(115_000, CONFIG);
    expect(conEnvio.iva).toBeGreaterThan(soloMercaderia.iva);
  });
});

describe("leyendaIva", () => {
  // Discriminar en la vitrina es de mayorista y confunde al comprador minorista.
  it("con precios IVA incluido sólo se avisa", () => {
    expect(leyendaIva(CONFIG)).toBe("IVA incluido");
  });

  it("sin IVA incluido se aclara que se suma", () => {
    expect(leyendaIva({ ...CONFIG, preciosIncluyenIva: false })).toBe("+ IVA 21%");
  });

  it("sin IVA no se muestra nada", () => {
    expect(leyendaIva({ ...CONFIG, habilitado: false })).toBeNull();
    expect(leyendaIva({ ...CONFIG, tasa: 0 })).toBeNull();
    expect(leyendaIva(null)).toBeNull();
  });
});

describe("alicuotaValida", () => {
  // ARCA acepta las alícuotas de la ley, no cualquier número.
  it("acepta las de la ley", () => {
    expect(alicuotaValida(21)).toBe(true);
    expect(alicuotaValida(10.5)).toBe(true);
    expect(alicuotaValida(27)).toBe(true);
    expect(alicuotaValida(0)).toBe(true);
  });

  it("rechaza una inventada", () => {
    expect(alicuotaValida(15)).toBe(false);
    expect(alicuotaValida(22)).toBe(false);
  });
});
