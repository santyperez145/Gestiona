import type { WorkbookImportOptions, WorkbookImportResult } from "@/lib/productImportWorkbook";

export function createProductImportReader() {
  const worker = new Worker(new URL("../workers/productImport.worker.ts", import.meta.url), { type: "module" });
  let sequence = 0;
  const pending = new Map<number, { resolve: (result: WorkbookImportResult) => void; reject: (error: Error) => void }>();
  worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: WorkbookImportResult; error?: string }>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else if (data.result) request.resolve(data.result);
    else request.reject(new Error("No pudimos leer el catálogo."));
  };
  const fail = () => {
    for (const request of pending.values()) request.reject(new Error("La lectura se interrumpió. Volvé a seleccionar el archivo."));
    pending.clear();
  };
  worker.onerror = fail;
  return {
    read(buffer?: ArrayBuffer, filename?: string, options?: WorkbookImportOptions): Promise<WorkbookImportResult> {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, buffer, filename, options }, buffer ? [buffer] : []);
      });
    },
    dispose() { worker.terminate(); fail(); },
  };
}
