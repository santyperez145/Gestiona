import { describe, it, expect } from "vitest";
import {
  normalizeText, queryTokens, matchesAllTokens,
  distanciaEdicion, toleranciaDe, tokenAproxima, matchesAllTokensAprox,
} from "./searchText";

describe("normalizeText", () => {
  it("baja a minúsculas y saca tildes", () => {
    expect(normalizeText("Ámbar Óud")).toBe("ambar oud");
  });

  it("null y undefined dan cadena vacía", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("matchesAllTokens", () => {
  it("exige TODOS los términos", () => {
    expect(matchesAllTokens("LATTAFA KHAMRAH", queryTokens("lattafa khamrah"))).toBe(true);
    expect(matchesAllTokens("LATTAFA ASAD", queryTokens("lattafa khamrah"))).toBe(false);
  });
});

// ── B10 — tolerancia a errores de tipeo ─────────────────────────────────────

describe("distanciaEdicion", () => {
  it("una transposición cuesta 1, no 2", () => {
    // Es el error de tipeo más común y por eso se usa Damerau y no Levenshtein
    // a secas: contarla como 2 obliga a subir el umbral, que trae basura.
    expect(distanciaEdicion("ab", "ba")).toBe(1);
  });

  it("mide el caso real que no encontraba nada", () => {
    expect(distanciaEdicion("lataffa", "lattafa")).toBeLessThanOrEqual(2);
  });

  it("corta apenas se pasa del máximo", () => {
    expect(distanciaEdicion("perfume", "zapatilla", 2)).toBeGreaterThan(2);
  });

  it("iguales dan 0", () => {
    expect(distanciaEdicion("lattafa", "lattafa")).toBe(0);
  });

  it("contra vacío da el largo", () => {
    expect(distanciaEdicion("", "abc")).toBe(3);
    expect(distanciaEdicion("abc", "")).toBe(3);
  });
});

describe("toleranciaDe", () => {
  it("un término corto no tiene margen", () => {
    // Con tolerancia 1, "oud" matchearía "sud", "sur" y "out".
    expect(toleranciaDe("oud")).toBe(0);
  });

  it("uno mediano tolera un error", () => {
    expect(toleranciaDe("khamra")).toBe(1);
  });

  it("uno largo tolera dos", () => {
    expect(toleranciaDe("zanzibar")).toBe(2);
  });
});

describe("tokenAproxima", () => {
  it("encuentra el producto con el nombre mal tipeado", () => {
    expect(tokenAproxima("LATTAFA ASAD ZANZIBAR", "lataffa")).toBe(true);
  });

  it("compara palabra por palabra, no contra el texto entero", () => {
    // La distancia de "lataffa" al nombre completo es enorme; contra
    // "lattafa" sola es 2.
    expect(tokenAproxima("LATTAFA ASAD ZANZIBAR 100ML EDP", "lataffa")).toBe(true);
  });

  it("sigue funcionando mientras se escribe", () => {
    expect(tokenAproxima("LATTAFA KHAMRAH", "khamr")).toBe(true);
  });

  it("la coincidencia literal gana sin calcular distancia", () => {
    expect(tokenAproxima("TOM FORD OMBRE LEATHER", "ombre")).toBe(true);
  });

  it("NO trae cualquier cosa: un término corto y distinto no matchea", () => {
    expect(tokenAproxima("TOM FORD OUD WOOD", "sud")).toBe(false);
  });

  it("una palabra completamente distinta no matchea", () => {
    expect(tokenAproxima("LATTAFA ASAD", "zapatilla")).toBe(false);
  });
});

describe("matchesAllTokensAprox", () => {
  it("exige que TODOS los términos se parezcan", () => {
    expect(matchesAllTokensAprox("LATTAFA KHAMRAH", ["lataffa", "khamrah"])).toBe(true);
    expect(matchesAllTokensAprox("LATTAFA KHAMRAH", ["lataffa", "zapatilla"])).toBe(false);
  });

  it("sin términos matchea todo", () => {
    expect(matchesAllTokensAprox("cualquier cosa", [])).toBe(true);
  });
});
