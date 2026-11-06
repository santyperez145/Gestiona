import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { partesDeLaFoto, puntoEnLaFoto, unidadesPorProducto, unirPuntos } from "@/components/inventory/ConteoPorZona";
import { candidatosValidos, imagenDeReferenciaValida, puntosValidos } from "../../supabase/functions/_shared/conteoVisual";

/**
 * Conteo por zona (2026-11-05): se apunta a un estante y se cuentan de una vez
 * todos los códigos visibles; para lo que no muestra el código, la IA marca un
 * punto por unidad y la persona corrige antes de sumar.
 */
const funcion = readFileSync("supabase/functions/conteo-visual/index.ts", "utf8");
const componente = readFileSync("src/components/inventory/ConteoPorZona.tsx", "utf8");
const UUID = "0d6a1c0e-1d2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("varios códigos en una foto", () => {
  it("cada código leído es una unidad de su producto; los ajenos no suman", () => {
    const m = unidadesPorProducto([{ productoId: "a" }, { productoId: "a" }, { productoId: "b" }, { productoId: null }]);
    expect([...m]).toEqual([["a", 2], ["b", 1]]);
  });

  it("lee todos los códigos de la foto con el lector único (nativo o ZXing-C++ en WebAssembly)", () => {
    expect(componente).toContain("const lector = await lectorDeCodigos();");
    expect(componente).toContain("await lector.detect(canvas)");
    expect(componente).not.toContain("decodeFromCanvas");
  });
});

describe("conteo visual con IA", () => {
  it("el toque en pantalla se traduce a píxeles de la foto", () => {
    const rect = { left: 10, top: 20, width: 500, height: 250 };
    expect(puntoEnLaFoto(260, 145, rect, 2000, 1000)).toEqual({ x: 1000, y: 500 });
  });

  it("la función sólo acepta candidatos con id válido y puntos dentro de la foto", () => {
    expect(candidatosValidos([{ id: UUID, nombre: " Yerba " }, { id: "x", nombre: "malo" }, { id: UUID, nombre: "repetido" }]))
      .toEqual([{ id: UUID, nombre: "Yerba" }]);
    expect(puntosValidos([{ x: 10.4, y: 5 }, { x: -1, y: 5 }, { x: 10, y: 5 }, { x: 99, y: 9999 }, { x: "a", y: 1 }], 100, 100))
      .toEqual([{ x: 10, y: 5 }]);
  });

  it("estante lleno: 4 partes superpuestas que cubren toda la foto", () => {
    const partes = partesDeLaFoto(2000, 1000);
    expect(partes).toHaveLength(4);
    // Cubren toda la foto y se superponen en el centro (10 %).
    expect(Math.min(...partes.map(p => p.x))).toBe(0);
    expect(Math.max(...partes.map(p => p.x + p.ancho))).toBe(2000);
    expect(Math.max(...partes.map(p => p.y + p.alto))).toBe(1000);
    expect(partes[0]).toEqual({ x: 0, y: 0, ancho: 1100, alto: 550 });
    expect(partes[3]).toEqual({ x: 900, y: 450, ancho: 1100, alto: 550 });
  });

  it("al unir las partes, una unidad de la zona superpuesta cuenta una sola vez", () => {
    const izquierda = [{ x: 100, y: 100 }, { x: 950, y: 300 }];   // la segunda está en la superposición
    const derecha = [{ x: 955, y: 302 }, { x: 1500, y: 300 }];     // la misma unidad, vista desde la otra parte
    expect(unirPuntos([izquierda, derecha], 40)).toEqual([{ x: 100, y: 100 }, { x: 950, y: 300 }, { x: 1500, y: 300 }]);
  });

  it("usa fotos de catálogo como referencia, sólo de nuestro storage público", () => {
    const base = "https://abc.supabase.co";
    const propia = `${base}/storage/v1/object/public/product-images/zz.jpg`;
    expect(imagenDeReferenciaValida(propia, base)).toBe(propia);
    for (const ajena of ["https://evil.example/zz.jpg", `${base}/storage/v1/object/sign/privado/zz.jpg`,
      "http://abc.supabase.co/storage/v1/object/public/zz.jpg", "https://user:pw@abc.supabase.co/storage/v1/object/public/zz.jpg", 42]) {
      expect(imagenDeReferenciaValida(ajena, base), String(ajena)).toBeNull();
    }
    expect(candidatosValidos([{ id: UUID, nombre: "Yerba", imagen: "https://evil.example/x.jpg" }], base)).toEqual([{ id: UUID, nombre: "Yerba" }]);
    expect(funcion).toContain(".slice(0, MAX_REFERENCIAS)");
    expect(funcion).toContain('source: { type: "url", url: c.imagen }');
  });

  it("restringe la respuesta a los candidatos, usa el Opus vigente con respaldo y no guarda la foto", () => {
    expect(funcion).toContain("enum: [...ids, null]");
    expect(funcion).toContain('model: "claude-opus-5-5"');
    expect(funcion).toContain('fallbacks: "default"');
    expect(funcion).toContain('"anthropic-beta": "server-side-fallback-2026-07-01"');
    expect(funcion).toContain('stop_reason === "refusal"');
    expect(funcion).not.toMatch(/temperature|top_p|top_k|storage|\.from\(/);
  });

  it("exige sesión y plan con IA, y la persona confirma los puntos antes de sumar", () => {
    expect(funcion).toContain("requireUser(req, corsHeaders)");
    expect(funcion).toContain('exigirBeneficio(req, orgId, "ia", corsHeaders)');
    expect(componente).toContain("onSumar(productoIA, puntos.length)");
    expect(componente).toContain("Tocá la foto para agregar una unidad que falte; tocá un punto para sacarlo.");
  });
});
