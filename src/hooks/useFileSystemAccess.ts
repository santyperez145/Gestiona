/**
 * useFileSystemAccess — File System Access API hook.
 *
 * Allows reading and writing files directly to the user's filesystem with
 * a native OS file picker — no URL.createObjectURL() dance required.
 * Falls back to the traditional download-link approach on unsupported browsers.
 *
 * Browser support: Chrome 86+, Edge 86+. Firefox/Safari: download fallback.
 *
 * Features:
 *   - Open file with native picker (read text, JSON, CSV, etc.)
 *   - Save file with native "Save As" dialog (or overwrite an existing handle)
 *   - Full TypeScript types for FileSystemFileHandle
 *   - Transparent fallback: download/upload work everywhere
 *
 * Usage:
 *   const { openFile, saveFile, supported } = useFileSystemAccess();
 *
 *   // Open a CSV:
 *   const text = await openFile({ accept: [".csv"] });
 *
 *   // Save a PDF blob:
 *   await saveFile(pdfBlob, { suggestedName: "reporte_mayo.pdf" });
 *
 *   // Save text/JSON:
 *   await saveFile("Hello world", { suggestedName: "datos.txt" });
 */
import { useCallback } from "react";
import { toast } from "sonner";

type FileSystemSupportedTypes = Array<{
  description?: string;
  accept: Record<string, string[]>;
}>;

interface OpenFileOptions {
  /** File extensions to accept, e.g. [".csv", ".tsv"] */
  accept?: string[];
  /** MIME types + extensions for FileSystem API picker */
  types?: FileSystemSupportedTypes;
  multiple?: boolean;
}

interface SaveFileOptions {
  /** Suggested filename for the save dialog */
  suggestedName?: string;
  /** MIME types + extensions for FileSystem API picker */
  types?: FileSystemSupportedTypes;
}

interface UseFileSystemAccessReturn {
  /** Whether the File System Access API is available */
  supported: boolean;
  /**
   * Open a file picker and return its text contents.
   * Returns null if user cancels or an error occurs.
   */
  openFile: (options?: OpenFileOptions) => Promise<string | null>;
  /**
   * Show a "Save As" dialog and write content to disk.
   * Falls back to <a download> on unsupported browsers.
   * Returns true on success.
   */
  saveFile: (content: string | Blob, options?: SaveFileOptions) => Promise<boolean>;
}

const supported =
  typeof window !== "undefined" && "showOpenFilePicker" in window;

export function useFileSystemAccess(): UseFileSystemAccessReturn {
  const openFile = useCallback(async (opts: OpenFileOptions = {}): Promise<string | null> => {
    if (supported) {
      try {
        const types: FileSystemSupportedTypes = opts.types ?? (
          opts.accept ? [{ description: "Archivos", accept: { "text/plain": opts.accept } }] : []
        );
        const [handle] = await (window as any).showOpenFilePicker({
          multiple: opts.multiple ?? false,
          ...(types.length > 0 ? { types } : {}),
        });
        const file = await handle.getFile();
        return await file.text();
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          toast.error("No se pudo abrir el archivo");
          console.error("[useFileSystemAccess]", e);
        }
        return null;
      }
    } else {
      // Fallback: standard file input
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        if (opts.accept) input.accept = opts.accept.join(",");
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) { resolve(null); return; }
          resolve(await file.text());
        };
        input.oncancel = () => resolve(null);
        input.click();
      });
    }
  }, []);

  const saveFile = useCallback(async (
    content: string | Blob,
    opts: SaveFileOptions = {}
  ): Promise<boolean> => {
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: "text/plain;charset=utf-8;" });

    if (supported) {
      try {
        const types: FileSystemSupportedTypes = opts.types ?? [];
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: opts.suggestedName ?? "archivo",
          ...(types.length > 0 ? { types } : {}),
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          toast.error("No se pudo guardar el archivo");
          console.error("[useFileSystemAccess]", e);
        }
        return false;
      }
    } else {
      // Fallback: traditional download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = opts.suggestedName ?? "archivo";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return true;
    }
  }, []);

  return { supported, openFile, saveFile };
}
