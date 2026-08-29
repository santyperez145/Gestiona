import { supabase } from "@/integrations/supabase/client";

export const EXPENSE_RECEIPTS_BUCKET = "expense-receipts";
export const EXPENSE_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const EXPENSE_RECEIPT_URL_TTL_SECONDS = 60;

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PATH_PATTERN = new RegExp(`^${UUID}/${UUID}/${UUID}\\.(pdf|jpe?g|png|webp|gif|heic|heif)$`, "i");
const PUBLIC_PATH_MARKER = `/storage/v1/object/public/${EXPENSE_RECEIPTS_BUCKET}/`;

export function validateExpenseReceipt(file: Pick<Blob, "size" | "type">): string | null {
  if (!MIME_EXTENSION[file.type]) {
    return "El comprobante debe ser PDF, JPG, PNG, WebP, GIF, HEIC o HEIF.";
  }
  if (file.size <= 0) return "El comprobante está vacío.";
  if (file.size > EXPENSE_RECEIPT_MAX_BYTES) {
    return "El comprobante supera el máximo de 10 MB.";
  }
  return null;
}

export function buildExpenseReceiptPath(orgId: string, userId: string, mimeType: string): string {
  const extension = MIME_EXTENSION[mimeType];
  if (!extension) throw new Error("Tipo de comprobante no admitido");
  return `${orgId}/${userId}/${crypto.randomUUID()}.${extension}`;
}

/**
 * `receipt_url` conserva su nombre histórico, pero para archivos privados
 * persiste un path. También reconoce la antigua URL pública del mismo bucket
 * para que una futura importación no requiera reexponer el objeto.
 */
export function expenseReceiptPath(reference: string): string | null {
  const value = reference.trim();
  if (PATH_PATTERN.test(value)) return value;
  try {
    const url = new URL(value);
    const markerIndex = url.pathname.indexOf(PUBLIC_PATH_MARKER);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(url.pathname.slice(markerIndex + PUBLIC_PATH_MARKER.length));
    return PATH_PATTERN.test(path) ? path : null;
  } catch {
    return null;
  }
}

export async function uploadExpenseReceipt({
  orgId,
  userId,
  file,
}: {
  orgId: string;
  userId: string;
  file: Blob;
}): Promise<string> {
  const validationError = validateExpenseReceipt(file);
  if (validationError) throw new Error(validationError);

  const path = buildExpenseReceiptPath(orgId, userId, file.type);
  const { error } = await supabase.storage
    .from(EXPENSE_RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function createExpenseReceiptUrl(reference: string): Promise<string> {
  const path = expenseReceiptPath(reference);
  if (!path) {
    // Compatibilidad defensiva para adjuntos externos heredados. Al corte no
    // existe ninguno; nunca convierte un path arbitrario en URL pública.
    if (/^https:\/\//i.test(reference)) return reference;
    throw new Error("La referencia del comprobante no es válida");
  }

  const { data, error } = await supabase.storage
    .from(EXPENSE_RECEIPTS_BUCKET)
    .createSignedUrl(path, EXPENSE_RECEIPT_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("No se pudo preparar el comprobante");
  return data.signedUrl;
}

export async function removeExpenseReceipt(reference: string): Promise<void> {
  const path = expenseReceiptPath(reference);
  if (!path) return;
  const { error } = await supabase.storage.from(EXPENSE_RECEIPTS_BUCKET).remove([path]);
  if (error) throw error;
}
