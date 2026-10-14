import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// El 2026-10-13 la app subía a dos buckets que no existían: `documents` (OCR
// de facturas, que además no tenía ningún procesador: se quitó) y `avatars`
// (foto de perfil, creado en 20261013000300). Toda subida fallaba siempre.
// Buckets medidos en storage.buckets ese día, más el creado por la migración.
const EXISTENTES = new Set([
  "avatars", "backups", "creator-deliverables", "expense-receipts",
  "finance-documents", "marketing-images", "product-images",
]);

function archivos(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (!/node_modules/.test(p) && path.basename(p) !== "test") archivos(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

describe("la app sólo usa buckets que existen", () => {
  it("cada storage.from('x') del front y de las funciones apunta a un bucket real", () => {
    const usados = new Set<string>();
    for (const f of [...archivos("src"), ...archivos("supabase/functions")]) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/storage\.from\(["']([a-z0-9-]+)["']\)/g)) usados.add(m[1]);
    }
    expect([...usados].filter(b => !EXISTENTES.has(b))).toEqual([]);
  });

  it("no queda la pantalla de OCR que decía «procesando» sin procesador", () => {
    expect(fs.existsSync("src/components/purchases/InvoiceOCRModal.tsx")).toBe(false);
    expect(fs.readFileSync("src/pages/PurchaseOrdersPage.tsx", "utf8")).not.toContain("Escanear factura");
  });

  it("los buckets públicos aceptan sólo imágenes, sin SVG, y escriben en carpeta propia", () => {
    const sql = fs.readFileSync("supabase/migrations/20261013000300_buckets_publicos_solo_imagenes.sql", "utf8");
    expect(sql).not.toMatch(/'image\/svg\+xml'/);
    expect(sql).toContain("AS RESTRICTIVE FOR INSERT TO authenticated");
    expect(sql).toContain("_carpeta_de_marketing_propia(name)");
  });
});

describe("product-images: carpeta propia", () => {
  // Medido 2026-10-13: un usuario de Famatina podía subir a la carpeta de otro
  // negocio y a rutas sueltas del bucket público de productos.
  it("una política restrictiva exige carpeta del usuario o de un negocio suyo", () => {
    const sql = fs.readFileSync("supabase/migrations/20261013000400_imagenes_de_producto_carpeta_propia.sql", "utf8");
    expect(sql).toMatch(/AS RESTRICTIVE FOR INSERT TO authenticated\s+WITH CHECK \(bucket_id <> 'product-images' OR public\._carpeta_de_marketing_propia\(name\)\)/);
    expect(sql).toMatch(/AS RESTRICTIVE FOR UPDATE/);
  });
});
