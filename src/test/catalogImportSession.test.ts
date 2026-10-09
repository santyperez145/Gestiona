import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogImportChunks, applyCatalogImportChunk, approveCatalogImport, getCatalogImportSession, stageCatalogImportChunk, startCatalogImport, catalogImportErrorMessage } from "@/lib/catalogImportSession";
import { productMatchesCode } from "@/lib/productCodes";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => mocks.rpc.mockReset());

describe("sesión de importación", () => {
  it("muestra causas accionables sin exponer SQL, identificadores o mensajes técnicos", () => {
    const safe = "El catálogo supera el límite de productos de tu plan";
    expect(catalogImportErrorMessage({ message: safe }, "Reintentá")).toBe(safe);
    expect(catalogImportErrorMessage(new Error("Failed to fetch"), "Reintentá")).toBe("Reintentá");
    expect(catalogImportErrorMessage({ message: 'violates constraint products_org_id_fkey: private-uuid' }, "Reintentá")).toBe("Reintentá");
  });
  it("divide 11.926 productos sintéticos en 48 lotes determinísticos", () => {
    const rows = Array.from({ length: 11_926 }, (_, i) => ({ name: "ZZ Ejemplo", sku: String(i), provided: ["name", "sku"] }));
    const chunks = catalogImportChunks(rows);
    expect(chunks).toHaveLength(48); expect(chunks.at(-1)?.position).toBe(11750); expect(chunks.at(-1)?.rows).toHaveLength(176);
    expect(chunks.flatMap(chunk => chunk.rows)).toEqual(rows);
  });
  it("limita bytes además de filas", () => {
    const rows = Array.from({ length: 12 }, () => ({ name: "ZZ", description: "ñ".repeat(80_000), provided: ["name"] }));
    expect(catalogImportChunks(rows).every(chunk => chunk.rows.length < 250 && new TextEncoder().encode(JSON.stringify(chunk.rows)).length < 900000)).toBe(true);
    expect(() => catalogImportChunks([{ name: "ZZ", description: "x".repeat(950000), provided: ["name"] }])).toThrow("tamaño");
  });
  it("transporta opciones y filas sólo al staging autoritativo", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, id: "session" }, error: null });
    const options: Parameters<typeof startCatalogImport>[0]["options"] = {
      stock_mode: "ignore", location_id: "", destination_store_id: "", exchange_rate: 0,
      margin_percent: 0, auto_price: false, cost_currency: "ARS", sheet_name: "Productos", fingerprint: "zz",
      mapping: { name: "0", sku: "1", brand: "", category: "", cost: "", sale: "", barcode: "", barcode2: "", barcode3: "", stock: "", description: "", classification: "" },
      column_mapping: { "0": "name", "1": "sku", "2": "" },
    };
    await startCatalogImport({ id: "session", org_id: "tenant", filename: "zz.xls", source_format: "xls", source_system: "generic", source_rows: 1, total: 1, options });
    expect(mocks.rpc).toHaveBeenCalledWith("start_catalog_import", expect.objectContaining({ p_session_id: "session", p_org_id: "tenant", p_options: options }));
    const rows = [{ name: "ZZ", provided: ["name"] }]; await stageCatalogImportChunk("session", 250, rows);
    expect(mocks.rpc).toHaveBeenLastCalledWith("stage_catalog_import_chunk", { p_session_id: "session", p_position: 250, p_rows: rows });
  });
  it("propaga fallos para que se puedan recuperar, sin transformar errores en éxito", async () => {
    const error = new Error("Network failure"); mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(getCatalogImportSession("session")).rejects.toBe(error);
    await expect(approveCatalogImport("session", true)).rejects.toBe(error);
    await expect(applyCatalogImportChunk("session", 250)).rejects.toBe(error);
  });
});
describe("códigos del catálogo", () => {
  it("busca códigos principales, alternativos y SKU sin borrar ceros", () => {
    const product = { sku: "000001", barcode: "001234", barcode_aliases: ["009876"] };
    for (const code of ["000001", "001234", "009876"]) expect(productMatchesCode(product, code)).toBe(true);
    expect(productMatchesCode(product, "9876")).toBe(false); expect(productMatchesCode({}, "")).toBe(false);
    expect([{ barcode: "ZZ" }, { barcode_aliases: ["ZZ"] }].filter(p => productMatchesCode(p, "ZZ"))).toHaveLength(2);
  });
});
