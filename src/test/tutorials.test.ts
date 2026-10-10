import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES } from "@/app/routeManifest";
import { CAMINOS, TUTORIALES, avanceCamino, tutorialDeRuta } from "@/lib/tutorials";

describe("tutoriales de la plataforma", () => {
  it("cada lección de la Academia existe y corre en una ruta real", () => {
    const rutas = new Set(ROUTES.map(r => r.path));
    for (const camino of CAMINOS) {
      for (const id of camino.lecciones) {
        const t = TUTORIALES[id];
        expect(t, `${camino.id} → ${id}`).toBeDefined();
        expect(rutas.has(t.ruta), `${id} corre en ${t.ruta}`).toBe(true);
      }
    }
  });

  it("los recorridos propios usan el id de su ruta y tienen pasos con texto", () => {
    const porId = new Map(ROUTES.map(r => [r.id, r.path]));
    for (const t of Object.values(TUTORIALES)) {
      if (t.id !== "bienvenida") expect(porId.get(t.id), t.id).toBe(t.ruta);
      expect(t.pasos.length).toBeGreaterThan(0);
      for (const paso of t.pasos) expect(paso.texto.length).toBeGreaterThan(20);
    }
  });

  it("toda pantalla del menú tiene recorrido, propio o generado con sus consejos", () => {
    for (const r of ROUTES.filter(r => r.nav)) {
      const t = tutorialDeRuta({ id: r.id, path: r.path, label: r.nav!.label, keywords: r.nav!.keywords });
      expect(t.pasos.length, r.id).toBeGreaterThanOrEqual(1);
    }
    const generado = tutorialDeRuta({ id: "zz", path: "/zz", label: "ZZ" }, [{ title: "Consejo", desc: "Hacé esto" }]);
    expect(generado.pasos.map(p => p.titulo)).toContain("Consejo");
  });

  it("calcula el avance de un camino", () => {
    expect(avanceCamino({ id: "x", titulo: "", descripcion: "", lecciones: ["a", "b"] }, new Set(["a"]))).toBe(50);
  });

  it("el progreso es por usuario y la ayuda es una sola", () => {
    const sql = readFileSync("supabase/migrations/20261010000600_progreso_tutoriales.sql", "utf8");
    expect(sql).toContain("USING (user_id = auth.uid())");
    const layout = readFileSync("src/components/AppLayout.tsx", "utf8");
    expect(layout).toContain("<TutorialHelp");
    expect(layout).not.toContain("<PageGuide />");
  });
});
