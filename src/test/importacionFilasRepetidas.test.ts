import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002000_importacion_filas_repetidas.sql"), "utf8");

describe("importación: una fila repetida en el archivo no traba todo (E1/E3)", () => {
  it("omite sólo lo que creó esta misma importación y lo avisa", () => {
    expect(migration).toContain("prev.result_product_id = p.id AND prev.status = 'applied'");
    expect(migration).toContain("prev.batch_id = v_batch.id");
    expect(migration).toContain("current_setting('app.catalog_import_session', true)");
    expect(migration).toContain("SET status = 'skipped', result_product_id = v_dup_id");
    expect(migration).toContain("'Repetida en el archivo: este producto ya se creó con otra fila de esta importación; se omitió'");
  });

  it("concilia contando las repetidas y no las esconde", () => {
    expect(migration).toContain("IF v_applied + v_duplicates <> v_batch.valid_rows THEN");
    expect(migration).toContain("skipped_count = invalid_rows + v_duplicates");
    expect(migration).toContain("WHEN invalid_rows > 0 OR v_duplicates > 0 THEN 'completed_with_errors'");
    expect(migration).toContain("+ (v_batch.skipped_count - v_batch.invalid_rows) = v_batch.valid_rows");
  });

  it("un producto que existía antes sigue frenando, diciendo cuál", () => {
    expect(migration).toContain("El catálogo cambió desde la validación: «%» ya existe");
  });

  it("el error del lote lleva el motivo real", () => {
    expect(migration).toContain("No se pudo aplicar el lote que empieza en la fila %; los lotes anteriores se conservan. Motivo: %");
    expect(migration).not.toContain("Revisá permisos, cupo y datos antes de reintentar.';");
  });
});
