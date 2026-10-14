import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { anterioresSinTerminar } from "@/lib/catalogImportSession";

// Medido 2026-10-14: 407 MB de base (el gratuito corta en 500), 211 MB en
// filas de importación; Famatina tenía 7 intentos reemplazados esperando que
// el dueño tocara «Descartar las anteriores». La poda diaria los descarta.
const sql = fs.readFileSync("supabase/migrations/20261014000200_importaciones_reemplazadas_se_descartan.sql", "utf8");

describe("la poda descarta importaciones reemplazadas", () => {
  it("sólo cancela una sesión sin terminar si hay otra más nueva del mismo negocio y pasó una semana", () => {
    expect(sql).toContain("s.status NOT IN ('completed', 'cancelled')");
    expect(sql).toContain("s.updated_at < now() - interval '7 days'");
    expect(sql).toMatch(/n\.org_id = s\.org_id AND n\.created_at > s\.created_at AND n\.status <> 'cancelled'/);
  });

  it("cancela como el botón (lotes en espera) y no borra las filas en la misma corrida", () => {
    expect(sql).toMatch(/UPDATE public\.product_import_batches b SET status = 'cancelled'[\s\S]*b\.status = 'staged'/);
    expect(sql).toContain("SET status = 'cancelled', updated_at = now()");
  });

  it("coincide con el criterio del front: la más nueva sin terminar nunca es «anterior»", () => {
    const historial = [
      { id: "nueva", status: "applying" }, { id: "vieja", status: "applying" }, { id: "cancelada", status: "cancelled" },
    ];
    expect(anterioresSinTerminar(historial)).toEqual(["vieja"]);
  });

  it("el historial del cron baja a 7 días", () => {
    expect(sql).toContain("DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'");
  });
});
