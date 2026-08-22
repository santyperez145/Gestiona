export type SupportedFinanceMime =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/** Detecta el tipo por magic bytes; nunca confía en Content-Type/extensión. */
export function detectFinanceDocumentMime(bytes: Uint8Array): SupportedFinanceMime | null {
  if (startsWith(bytes, PDF_HEADER)) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (startsWith(bytes, PNG_HEADER)) return "image/png";
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const ACTIVE_PDF_TOKENS = [
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/OpenAction",
  "/AA",
];

/**
 * Defensa previa al antivirus: documentos comerciales no necesitan acciones,
 * JavaScript ni adjuntos ejecutables. Encontrarlos manda el original a
 * cuarentena, aunque el MIME y el hash coincidan.
 */
export function findActivePdfFeature(bytes: Uint8Array): string | null {
  if (detectFinanceDocumentMime(bytes) !== "application/pdf") return null;
  const source = new TextDecoder("latin1").decode(bytes);
  return ACTIVE_PDF_TOKENS.find(token => source.includes(token)) || null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const exactBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", exactBuffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
