import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createProductImportReader } from "@/lib/productImportReader";
class SyntheticWorker {
  static instance: SyntheticWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { SyntheticWorker.instance = this; }
}
beforeEach(() => vi.stubGlobal("Worker", SyntheticWorker));
afterEach(() => vi.unstubAllGlobals());
describe("lector en worker", () => {
  it("transfiere el archivo sin clonarlo y conserva correlación de mensajes", async () => {
    const reader = createProductImportReader(); const buffer = new ArrayBuffer(10);
    const first = reader.read(buffer, "zz.xls"); const second = reader.read();
    expect(SyntheticWorker.instance.postMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 1, buffer, filename: "zz.xls" }), [buffer]);
    SyntheticWorker.instance.onmessage!({ data: { id: 2, result: { profile: "mapped" } } });
    SyntheticWorker.instance.onmessage!({ data: { id: 1, result: { profile: "hardware" } } });
    await expect(first).resolves.toMatchObject({ profile: "hardware" }); await expect(second).resolves.toMatchObject({ profile: "mapped" });
    reader.dispose(); expect(SyntheticWorker.instance.terminate).toHaveBeenCalledOnce();
  });
  it("propaga validación y rechaza lecturas pendientes al cerrar o fallar", async () => {
    const reader = createProductImportReader(); const first = reader.read();
    SyntheticWorker.instance.onmessage!({ data: { id: 1, error: "La hoja seleccionada está vacía." } });
    await expect(first).rejects.toThrow("vacía");
    const pending = reader.read(); reader.dispose(); await expect(pending).rejects.toThrow("interrumpió");
    const other = createProductImportReader(); const failed = other.read(); SyntheticWorker.instance.onerror!();
    await expect(failed).rejects.toThrow("interrumpió"); other.dispose();
  });
});
