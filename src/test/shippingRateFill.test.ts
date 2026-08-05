import { describe, it, expect } from "vitest";
import {
  BANDA_POR_PROVINCIA, MULTIPLICADOR_BANDA, DIAS_BANDA,
  bandaDeZona, redondearPrecio, completarTarifario, provinciasSinCobertura,
  type ZonaParaCompletar, type TarifaBase,
} from "@/lib/shippingRateFill";
import { AR_PROVINCES } from "@/lib/shippingCalc";

const base: TarifaBase = {
  carrier: "correo_argentino",
  service: "domicilio",
  min_weight_kg: 0,
  max_weight_kg: 1,
  price: 10_000,
  price_per_extra_kg: 2_000,
  free_above: 150_000,
};

describe("bandas de distancia", () => {
  it("cubre las 24 provincias del país, sin faltar ninguna", () => {
    // Una provincia sin banda se estima como la más cara y el comercio termina
    // cotizando Córdoba como si fuera Ushuaia.
    const sinBanda = AR_PROVINCES.filter(p => BANDA_POR_PROVINCIA[p.code] === undefined);
    expect(sinBanda.map(p => p.name)).toEqual([]);
  });

  it("CABA es la base y Tierra del Fuego la más lejana", () => {
    expect(BANDA_POR_PROVINCIA["AR-C"]).toBe(0);
    expect(BANDA_POR_PROVINCIA["AR-V"]).toBe(4);
  });

  it("cada banda tiene multiplicador y días, y ambos crecen con la distancia", () => {
    for (let b = 0; b <= 4; b++) {
      expect(MULTIPLICADOR_BANDA[b]).toBeGreaterThan(0);
      expect(DIAS_BANDA[b]).toHaveLength(2);
    }
    for (let b = 1; b <= 4; b++) {
      expect(MULTIPLICADOR_BANDA[b]).toBeGreaterThan(MULTIPLICADOR_BANDA[b - 1]);
      expect(DIAS_BANDA[b][1]).toBeGreaterThan(DIAS_BANDA[b - 1][1]);
    }
  });

  it("los días mínimos nunca superan a los máximos", () => {
    for (let b = 0; b <= 4; b++) expect(DIAS_BANDA[b][0]).toBeLessThanOrEqual(DIAS_BANDA[b][1]);
  });
});

describe("bandaDeZona", () => {
  it("toma la provincia MÁS lejana, no el promedio", () => {
    // Patagonia tiene Neuquén (3) y Tierra del Fuego (4). Cotizar el promedio
    // es vender a pérdida justo en el despacho más caro.
    expect(bandaDeZona(["AR-Q", "AR-R", "AR-U", "AR-Z", "AR-V"])).toBe(4);
  });

  it("una zona de una sola provincia usa su banda", () => {
    expect(bandaDeZona(["AR-C"])).toBe(0);
  });

  it("una zona vacía o con códigos desconocidos se trata como la más cara", () => {
    expect(bandaDeZona([])).toBe(4);
    expect(bandaDeZona(["XX-1"])).toBe(4);
  });

  it("ignora los códigos desconocidos si hay al menos uno válido", () => {
    expect(bandaDeZona(["AR-C", "XX-1"])).toBe(0);
  });
});

describe("redondearPrecio", () => {
  it("redondea a centenas: un envío de $8.437 no lo cobra nadie", () => {
    expect(redondearPrecio(8_437)).toBe(8_400);
    expect(redondearPrecio(8_450)).toBe(8_500);
    expect(redondearPrecio(0)).toBe(0);
  });

  it("nunca devuelve un precio negativo", () => {
    expect(redondearPrecio(-500)).toBe(0);
  });
});

describe("completarTarifario", () => {
  const zonas: ZonaParaCompletar[] = [
    { id: "caba", name: "CABA", provinces: ["AR-C"] },
    { id: "gba", name: "GBA / Buenos Aires", provinces: ["AR-B"] },
    { id: "centro", name: "Centro", provinces: ["AR-X", "AR-S", "AR-E"] },
    { id: "pat", name: "Patagonia", provinces: ["AR-Q", "AR-U", "AR-V"] },
  ];

  it("saltea las zonas que ya tienen tarifa: nunca pisa lo cargado a mano", () => {
    const filas = completarTarifario(zonas, base, { zonasConTarifa: new Set(["caba"]) });
    expect(filas.map(f => f.zone_id)).toEqual(["gba", "centro", "pat"]);
  });

  it("encarece por distancia y redondea", () => {
    const filas = completarTarifario(zonas, base, { zonasConTarifa: new Set(["caba"]) });
    const porZona = Object.fromEntries(filas.map(f => [f.zone_id, f]));
    expect(porZona.gba.price).toBe(redondearPrecio(10_000 * 1.15));
    expect(porZona.centro.price).toBe(redondearPrecio(10_000 * 1.4));
    expect(porZona.pat.price).toBe(redondearPrecio(10_000 * 2.1));
    expect(porZona.pat.price).toBeGreaterThan(porZona.centro.price);
  });

  it("el kilo extra también se encarece: es el mismo camión", () => {
    const [gba] = completarTarifario([zonas[1]], base);
    expect(gba.price_per_extra_kg).toBe(redondearPrecio(2_000 * 1.15));
  });

  it("el envío gratis se copia igual: es comercial, no depende de la distancia", () => {
    const filas = completarTarifario(zonas, base);
    expect(filas.every(f => f.free_above === 150_000)).toBe(true);
  });

  it("los días de entrega crecen con la distancia", () => {
    const filas = completarTarifario(zonas, base);
    const pat = filas.find(f => f.zone_id === "pat")!;
    const gba = filas.find(f => f.zone_id === "gba")!;
    expect(pat.delivery_days_max).toBeGreaterThan(gba.delivery_days_max);
  });

  it("conserva transportista, servicio y rango de peso de la tarifa base", () => {
    const [f] = completarTarifario([zonas[1]], base);
    expect(f.carrier).toBe("correo_argentino");
    expect(f.service).toBe("domicilio");
    expect(f.min_weight_kg).toBe(0);
    expect(f.max_weight_kg).toBe(1);
  });

  it("con saltearConTarifa en false recotiza todo, incluida la base", () => {
    const filas = completarTarifario(zonas, base, {
      zonasConTarifa: new Set(["caba"]), saltearConTarifa: false,
    });
    expect(filas).toHaveLength(4);
    // CABA es banda 0: se recotiza al mismo precio, no se encarece.
    expect(filas.find(f => f.zone_id === "caba")!.price).toBe(10_000);
  });

  it("no escribe nada: devuelve las filas para poder mostrarlas antes", () => {
    const filas = completarTarifario(zonas, base);
    expect(filas[0]).toHaveProperty("multiplicador");
    expect(filas[0]).toHaveProperty("zone_name");
  });

  it("sin zonas devuelve una lista vacía en vez de romper", () => {
    expect(completarTarifario([], base)).toEqual([]);
  });
});

describe("provinciasSinCobertura", () => {
  const todas = AR_PROVINCES.map(p => p.code);
  const zonas: ZonaParaCompletar[] = [
    { id: "caba", name: "CABA", provinces: ["AR-C"] },
    { id: "gba", name: "GBA", provinces: ["AR-B"] },
  ];

  it("es el estado real de hoy: con tarifa sólo en CABA no se le vende a nadie más", () => {
    const sin = provinciasSinCobertura(zonas, new Set(["caba"]), todas);
    expect(sin).not.toContain("AR-C");
    expect(sin).toContain("AR-B");
    expect(sin).toHaveLength(todas.length - 1);
  });

  it("una zona sin tarifa no cubre, aunque tenga provincias asignadas", () => {
    // Este es el bug de negocio: las 6 zonas existen y parecen configuradas.
    const sin = provinciasSinCobertura(zonas, new Set(), todas);
    expect(sin).toHaveLength(todas.length);
  });

  it("con todo cargado no queda ninguna afuera", () => {
    const completa: ZonaParaCompletar[] = [{ id: "u", name: "Única", provinces: todas }];
    expect(provinciasSinCobertura(completa, new Set(["u"]), todas)).toEqual([]);
  });
});
