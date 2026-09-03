import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migracion = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260903000020_seed_privacidad_en_tienda.sql"),
  "utf8",
);

describe("seed de tienda incluye política de privacidad", () => {
  it("la RPC siembra politica-de-privacidad en draft con marcador", () => {
    expect(migracion).toContain("politica-de-privacidad");
    expect(migracion).toContain("Completá acá tu razón social, CUIT");
    expect(migracion).toContain("'draft'");
    expect(migracion).toContain("ON CONFLICT (store_id, slug) DO NOTHING");
  });

  it("hace backfill sin pisar tiendas que ya la tienen", () => {
    expect(migracion).toContain("WHERE NOT EXISTS");
    expect(migracion).toContain("p.slug = 'politica-de-privacidad'");
  });
});
