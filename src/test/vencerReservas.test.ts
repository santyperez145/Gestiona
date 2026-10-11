import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("reservas vencidas", () => {
  it("vencer_reservas corre cada hora y la app no la invoca", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011002700_vencer_reservas_cada_hora.sql"), "utf8");
    expect(sql).toContain("cron.schedule('vencer-reservas-de-stock', '23 * * * *', 'SELECT public.vencer_reservas()')");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.vencer_reservas() FROM PUBLIC, anon, authenticated;");
  });
});
