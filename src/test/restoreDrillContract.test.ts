import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "scripts/restore-drill.mjs"), "utf8");

describe("restore drill aislado", () => {
  it("parte de un snapshot privado ya verificado y vuelve a controlar su hash", () => {
    expect(source).toContain('.eq("last_verification_status", "passed")');
    expect(source).toContain("checksum !== metadata.checksum_sha256");
    expect(source).toContain("client.storage");
    expect(source).toContain(".download(metadata.storage_path)");
  });

  it("restaura con tipos y constraints reales sin escribir en public", () => {
    expect(source).toContain("LIKE public.%I INCLUDING DEFAULTS INCLUDING CONSTRAINTS");
    expect(source).toContain("jsonb_populate_recordset(NULL::public.%I, $1)");
    expect(source).not.toMatch(/INSERT INTO public\./);
    expect(source).not.toMatch(/UPDATE public\./);
    expect(source).not.toMatch(/DELETE FROM public\./);
  });

  it("limpia el esquema único aun cuando el ensayo falla", () => {
    expect(source).toContain("BEGIN;");
    expect(source).toContain("DROP SCHEMA %I CASCADE");
    expect(source).toContain("EXCEPTION WHEN OTHERS");
    expect(source).toContain("Restos del sandbox: ${row.leftovers}");
  });

  it("no imprime claves, ids de organización ni filas del negocio", () => {
    expect(source).not.toContain("console.log(serviceRole");
    expect(source).not.toContain("console.log(metadata");
    expect(source).not.toContain("console.log(snapshot");
    expect(source).toContain("Credenciales y datos de negocio: no impresos");
  });
});
