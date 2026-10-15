import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { cohortesDeClientes } from "@/lib/cohortes";

// 2026-10-15: la vista leía tablas vacías y tenía botones que sólo avisaban.
describe("cohortes sobre ventas reales", () => {
  it("cuenta cuántos clientes de cada mes vuelven", () => {
    const v = (id: string, cliente: string, date: string) => ({ id, customer_name: cliente, date, total_ars: 100 });
    const c = cohortesDeClientes([
      v("1", "Ana", "2026-08-05T15:00:00Z"), v("2", "Beto", "2026-08-10T15:00:00Z"),
      v("3", "Ana", "2026-09-02T15:00:00Z"), v("4", "Caro", "2026-09-20T15:00:00Z"),
    ], "2026-10");
    expect(c[0]).toEqual({ mes: "Ago 2026", clientes: 2, retencion: [100, 50, 0, null, null, null] });
    expect(c[1].clientes).toBe(1);
  });
  it("no vuelve a leer tablas vacías ni a tener botones que sólo avisan", () => {
    const src = fs.readFileSync("src/components/analytics/CohortesView.tsx", "utf8");
    expect(src).not.toContain('.from("bi_snapshots")');
    expect(src).not.toContain('.from("saved_reports")');
    expect(src).not.toMatch(/onClick=\{\(\) => toast\./);
  });
});
