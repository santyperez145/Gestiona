import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { puntoEnLaFoto, unidadesPorProducto } from "@/components/inventory/ConteoPorZona";
import { candidatosValidos, puntosValidos } from "../../supabase/functions/_shared/conteoVisual";

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

  it("usa el detector nativo (todos los códigos) y cae a ZXing donde no existe", () => {
    expect(componente).toContain("BarcodeDetector");
    expect(componente).toContain("decodeFromCanvas(canvas)");
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
