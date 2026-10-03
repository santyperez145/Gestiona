import { mapProductWorkbook, readProductWorkbook, type WorkbookImportOptions } from "@/lib/productImportWorkbook";
let workbook: ReturnType<typeof readProductWorkbook>;
let filename = "";
let fingerprint = "";
self.onmessage = async (event: MessageEvent<{ id: number; buffer?: ArrayBuffer; filename?: string; options?: WorkbookImportOptions }>) => {
  const { id, buffer, options } = event.data;
  try {
    if (buffer) {
      fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))).map(byte => byte.toString(16).padStart(2, "0")).join("");
      workbook = readProductWorkbook(buffer); filename = event.data.filename || "catalogo.xlsx";
    }
    if (!workbook) throw new Error("Volvé a seleccionar el archivo.");
    self.postMessage({ id, result: { ...mapProductWorkbook(workbook, filename, options), fingerprint } });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : "No pudimos leer la planilla." }); }
};
