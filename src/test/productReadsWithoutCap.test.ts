import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PostgREST corta en 1.000 filas sin avisar. Con catálogos de 11.000
 * productos, leer `products` de una organización sin paginar deja pantallas
 * incompletas (stock, reposición, Kardex, precios). Las lecturas completas
 * pasan por `selectOrgProducts`/`fetchOrgProducts`; una lectura acotada a
 * propósito declara `.limit(`, `.range(`, `.single()`, `.maybeSingle()`,
 * filtra por id o usa `count`.
 */
const ALLOWED = new Set([
  // Panel de staff: lectura de usuarios de plataforma, fuera del alcance de un tenant.
  "src/pages/AdminPage.tsx",
  // Tienda pública: lecturas acotadas por slug/colección del storefront.
  "src/lib/publicDataSource.ts",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) ? [path.replaceAll("\\", "/")] : [];
  });
}

describe("lecturas de productos sin tope silencioso", () => {
  it("ninguna pantalla lee el catálogo de una organización sin paginar", () => {
    const offenders: string[] = [];
    for (const file of files("src")) {
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(file, "utf8");
      const re = /\.from\((['"])products\1\)([\s\S]{0,400}?)(?=;|\n\s*\n|\),\s*\n)/g;
      for (const match of source.matchAll(re)) {
        const chain = match[2];
        if (!/\.select\(/.test(chain)) continue;
        // El propio helper paginado agrega límite y rango en las líneas siguientes.
        if (chain.includes(".select(columns)")) continue;
        if (/\.(limit|range|single|maybeSingle)\(|\.(eq|in)\((['"])id\2|count:\s*['"]exact|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(chain)) continue;
        offenders.push(`${file}: ${chain.replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
