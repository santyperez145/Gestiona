import { describe, it, expect } from "vitest";
import { normalizeText, queryTokens, matchesAllTokens, literalFilter } from "@/lib/searchText";

// Reproduce el problema reportado: el buscador de productos traía resultados
// que no coincidían con lo escrito.

const productos = [
  { id: "1", name: "KHAMRAH", brand: "LATTAFA", sku: "LAT-001", barcode: "779001" },
  { id: "2", name: "ASAD", brand: "LATTAFA", sku: "LAT-002", barcode: "779002" },
  { id: "3", name: "CLUB DE NUIT", brand: "ARMAF", sku: "ARM-010", barcode: "889010" },
  { id: "4", name: "ÁMBAR ÓUD", brand: "AL HARAMAIN", sku: "ALH-003", barcode: "669003" },
  { id: "5", name: "SUPREME", brand: "AFNAN", sku: "AFN-004", barcode: "559004" },
];

const campos = (p: (typeof productos)[number]) => [p.name, p.brand, p.sku, p.barcode];

describe("normalizeText", () => {
  it("saca mayúsculas y tildes", () => {
    expect(normalizeText("ÁMBAR Óud")).toBe("ambar oud");
    expect(normalizeText("Café")).toBe("cafe");
  });

  it("tolera null/undefined", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("queryTokens", () => {
  it("parte en términos y descarta espacios sobrantes", () => {
    expect(queryTokens("  lattafa   khamrah ")).toEqual(["lattafa", "khamrah"]);
    expect(queryTokens("")).toEqual([]);
  });
});

describe("matchesAllTokens", () => {
  it("exige que aparezcan TODOS los términos", () => {
    expect(matchesAllTokens("KHAMRAH LATTAFA", ["lattafa", "khamrah"])).toBe(true);
    expect(matchesAllTokens("ASAD LATTAFA", ["lattafa", "khamrah"])).toBe(false);
  });
});

describe("literalFilter — casos del bug reportado", () => {
  it("buscar una marca trae solo esa marca", () => {
    const r = literalFilter(productos, "lattafa", campos);
    expect(r.map(p => p.id).sort()).toEqual(["1", "2"]);
  });

  it("marca + producto acota al producto exacto", () => {
    const r = literalFilter(productos, "lattafa khamrah", campos);
    expect(r.map(p => p.id)).toEqual(["1"]);
  });

  it("NO trae productos que no contienen lo buscado", () => {
    const r = literalFilter(productos, "armaf", campos);
    expect(r.map(p => p.id)).toEqual(["3"]);
    expect(r.some(p => p.brand === "LATTAFA")).toBe(false);
  });

  it("encuentra sin importar tildes ni mayúsculas", () => {
    expect(literalFilter(productos, "ambar", campos).map(p => p.id)).toEqual(["4"]);
    expect(literalFilter(productos, "ÁMBAR", campos).map(p => p.id)).toEqual(["4"]);
  });

  it("busca por SKU y por código de barras", () => {
    expect(literalFilter(productos, "ARM-010", campos).map(p => p.id)).toEqual(["3"]);
    expect(literalFilter(productos, "559004", campos).map(p => p.id)).toEqual(["5"]);
  });

  it("una escritura parcial sí encuentra (es substring)", () => {
    expect(literalFilter(productos, "khamra", campos).map(p => p.id)).toEqual(["1"]);
  });

  it("devuelve vacío ante un typo real → ahí entra el fuzzy", () => {
    expect(literalFilter(productos, "kamrah", campos)).toEqual([]); // falta la 'h'
    expect(literalFilter(productos, "zzzz", campos)).toEqual([]);
  });
});
