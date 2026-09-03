import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  filasProvinciaVista,
  planificarPrecioProvincia,
  precioActualProvincia,
  resumenCoberturaProvincias,
  zonaDeProvincia,
} from "@/lib/provinceShippingRates";

const ZONAS = [
  { id: "z-caba", name: "CABA", provinces: ["AR-C"], sort_order: 1 },
  { id: "z-centro", name: "Centro", provinces: ["AR-S", "AR-X", "AR-E", "AR-P"], sort_order: 2 },
];

const RATES = [
  {
    id: "r1",
    zone_id: "z-caba",
    carrier: "propio",
    service: "domicilio",
    min_weight_kg: 0,
    max_weight_kg: null,
    price: 2500,
  },
];

describe("tarifario por provincia (Tiendanube traducido)", () => {
  it("lee el precio desde la zona que contiene la provincia", () => {
    expect(zonaDeProvincia(ZONAS, "AR-C")?.id).toBe("z-caba");
    expect(precioActualProvincia(ZONAS, RATES, "AR-C")).toBe(2500);
    expect(precioActualProvincia(ZONAS, RATES, "AR-X")).toBeNull();
  });

  it("en zona de una provincia actualiza la tarifa propia", () => {
    const plan = planificarPrecioProvincia({
      zones: ZONAS,
      rates: RATES,
      code: "AR-C",
      price: 3000,
      nextSortOrder: 10,
    });
    expect(plan?.zonaNueva).toBeNull();
    expect(plan?.quitarDeZona).toBeNull();
    expect(plan?.rate.zoneIdExistente).toBe("z-caba");
    expect(plan?.rate.rateIdToUpdate).toBe("r1");
    expect(plan?.rate.price).toBe(3000);
  });

  it("en zona compartida parte la provincia para no mezclar precios", () => {
    const plan = planificarPrecioProvincia({
      zones: ZONAS,
      rates: RATES,
      code: "AR-X",
      price: 4800,
      nextSortOrder: 10,
    });
    expect(plan?.quitarDeZona).toEqual({
      zoneId: "z-centro",
      provinces: ["AR-S", "AR-E", "AR-P"],
    });
    expect(plan?.zonaNueva?.provinces).toEqual(["AR-X"]);
    expect(plan?.zonaNueva?.name).toMatch(/Córdoba|Cordoba/i);
    expect(plan?.rate.zoneIdExistente).toBeNull();
    expect(plan?.rate.price).toBe(4800);
  });

  it("no inventa un plan con precio vacío o cero", () => {
    expect(planificarPrecioProvincia({
      zones: ZONAS, rates: RATES, code: "AR-C", price: 0, nextSortOrder: 1,
    })).toBeNull();
    expect(planificarPrecioProvincia({
      zones: ZONAS, rates: RATES, code: "AR-C", price: -10, nextSortOrder: 1,
    })).toBeNull();
  });

  it("el resumen cuenta cobertura real, no zonas sembradas", () => {
    const filas = filasProvinciaVista(ZONAS, RATES, [
      { code: "AR-C", name: "CABA" },
      { code: "AR-X", name: "Córdoba" },
    ]);
    expect(resumenCoberturaProvincias(filas)).toEqual({ conPrecio: 1, sinPrecio: 1 });
  });

  it("el panel vive arriba del acordeón de zonas y no inventa precios", () => {
    const tab = readFileSync(
      resolve(process.cwd(), "src/components/shipping/ShippingZonesTab.tsx"),
      "utf8",
    );
    const panel = readFileSync(
      resolve(process.cwd(), "src/components/shipping/ProvinceRatesPanel.tsx"),
      "utf8",
    );
    expect(tab).toContain("ProvinceRatesPanel");
    expect(panel).toContain("No se inventan precios");
    expect(panel).not.toMatch(/Math\.random|2500|5000/);
  });
});
