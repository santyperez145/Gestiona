import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIA_E2, REGLAS_E2 } from "@/lib/guiaEntrevistaE2";

describe("guía de las entrevistas de E2", () => {
  const preguntas = GUIA_E2.flatMap(b => b.preguntas);

  it("ninguna pregunta sugiere la respuesta que mide el experimento", () => {
    // El criterio de éxito es que el comercio nombre solo el margen real.
    for (const q of preguntas) expect(q).not.toMatch(/margen|ganancia|rentab|nerqia/i);
  });

  it("pregunta por hechos pasados y cubre lo que pide el formulario", () => {
    expect(preguntas.length).toBeGreaterThanOrEqual(10);
    const campos = GUIA_E2.map(b => b.campo).join(" ");
    for (const campo of ["Herramientas", "Cuánto paga", "Qué no puede responder", "Notas"]) expect(campos).toContain(campo);
    expect(REGLAS_E2.join(" ")).toContain("No nombres el margen");
  });

  it("el panel de E2 muestra la guía", () => {
    const panel = readFileSync(resolve(process.cwd(), "src/components/platform/EntrevistasE2.tsx"), "utf8");
    expect(panel).toContain("Guía de la entrevista");
    expect(panel).toContain("GUIA_E2.map(");
  });
});
