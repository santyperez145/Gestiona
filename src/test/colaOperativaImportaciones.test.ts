import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010003000_cola_operativa_importaciones.sql"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/pages/PlatformOperationsPage.tsx"), "utf8");

describe("cola operativa: importaciones de catálogo trabadas", () => {
  it("suma la fuente con la misma regla que la vista de importaciones y conserva las demás", () => {
    expect(migration).toContain("'catalog_import'::text AS source");
    expect(migration).toContain("s.updated_at < (now() - '00:30:00'::interval)");
    for (const fuente of ["'outbox'::text AS source", "'meli_webhook'::text AS source", "'payment_attempt'::text AS source", "'cron'::text AS source"]) {
      expect(migration).toContain(fuente);
    }
    expect(migration).toContain("WHERE is_platform_admin(auth.uid())");
  });

  it("la página la nombra y cuenta filas aplicadas, no intentos", () => {
    expect(page).toContain("catalog_import: { label: 'Importación de catálogo'");
    expect(page).toContain("trabada: { label: 'Trabada'");
    expect(page).toContain("row.source === 'catalog_import' ? `${row.attempts.toLocaleString('es-AR')} filas aplicadas`");
  });
});
