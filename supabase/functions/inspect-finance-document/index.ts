// Inspector privado del Document Inbox.
//
// El navegador sólo pide una inspección. La función vuelve a descargar el
// original desde el bucket privado, calcula hash/tamaño/MIME sobre los bytes y
// consulta un scanner controlado por la plataforma. Sin scanner limpio no hay
// transición a ready_for_extraction.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import {
  detectFinanceDocumentMime,
  findActivePdfFeature,
  sha256Hex,
} from "../_shared/financeDocumentInspection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_BYTES = 10 * 1024 * 1024;

type ScannerStatus = "not_run" | "clean" | "infected" | "error" | "unavailable";
type InspectionTarget = {
  document_id: string;
  version_id: string;
  storage_path: string;
  declared_mime_type: string;
  declared_size_bytes: number;
  declared_sha256: string;
  inspection_token: string | null;
  should_inspect: boolean;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

async function scanWithPrivateService(bytes: Uint8Array, mimeType: string, sha256: string) {
  const scannerUrl = Deno.env.get("FINANCE_DOCUMENT_SCANNER_URL");
  const scannerToken = Deno.env.get("FINANCE_DOCUMENT_SCANNER_TOKEN");
  if (!scannerUrl || !scannerToken) {
    return {
      provider: "private-scanner",
      status: "unavailable" as ScannerStatus,
      reference: null,
      reason: "El scanner privado todavía no está configurado",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const exactBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const response = await fetch(scannerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${scannerToken}`,
        "Content-Type": mimeType,
        "X-Content-SHA256": sha256,
      },
      body: exactBuffer,
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        provider: "private-scanner",
        status: "error" as ScannerStatus,
        reference: response.headers.get("x-request-id"),
        reason: `El scanner respondió HTTP ${response.status}`,
      };
    }

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const status = payload?.status === "clean" || payload?.status === "infected"
      ? payload.status as ScannerStatus
      : "error";
    return {
      provider: safeText(payload?.engine, 80) || "private-scanner",
      status,
      reference: safeText(payload?.reference, 160) || response.headers.get("x-request-id"),
      reason: status === "infected"
        ? safeText(payload?.signature, 300) || "El scanner detectó contenido malicioso"
        : status === "error"
          ? "El scanner devolvió un resultado inválido"
          : null,
    };
  } catch (cause) {
    return {
      provider: "private-scanner",
      status: "error" as ScannerStatus,
      reference: null,
      reason: cause instanceof DOMException && cause.name === "AbortError"
        ? "El scanner superó el timeout de 20 segundos"
        : "No se pudo contactar al scanner privado",
    };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  let body: { documentId?: string; versionId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo JSON inválido" }, 400);
  }
  if (!body.documentId || !body.versionId) {
    return json({ error: "documentId y versionId son obligatorios" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRole) {
    return json({ error: "Configuración de inspección no disponible" }, 503);
  }

  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(url, serviceRole);

  const { data: targetRows, error: beginError } = await userClient.rpc(
    "finance_document_begin_inspection",
    { p_document_id: body.documentId, p_version_id: body.versionId },
  );
  if (beginError) return json({ error: beginError.message }, beginError.code === "42501" ? 403 : 409);
  const target = targetRows?.[0] as InspectionTarget | undefined;
  if (!target) return json({ error: "La base no devolvió la inspección" }, 500);
  if (!target.should_inspect) {
    return json({ ok: true, skipped: true, reason: "terminal_state" });
  }
  if (!target.inspection_token) return json({ error: "Lease de inspección inválido" }, 500);

  let actualSha256: string | null = null;
  let actualMimeType: string | null = null;
  let actualSizeBytes: number | null = null;
  let scannerProvider = "private-scanner";
  let scannerStatus: ScannerStatus = "error";
  let scannerReference: string | null = null;
  let reason: string | null = null;

  try {
    const { data: original, error: downloadError } = await admin.storage
      .from("finance-documents")
      .download(target.storage_path);
    if (downloadError || !original) throw new Error("No se pudo descargar el original privado");

    const bytes = new Uint8Array(await original.arrayBuffer());
    actualSizeBytes = bytes.byteLength;
    actualMimeType = detectFinanceDocumentMime(bytes);
    actualSha256 = await sha256Hex(bytes);

    if (!actualSizeBytes || actualSizeBytes > MAX_BYTES) {
      scannerProvider = "structural-policy";
      scannerStatus = "infected";
      reason = "El tamaño real está vacío o supera 10 MB";
    } else if (!actualMimeType) {
      scannerProvider = "structural-policy";
      scannerStatus = "infected";
      reason = "La firma binaria no corresponde a PDF, JPG, PNG o WEBP";
    } else {
      const activePdfFeature = findActivePdfFeature(bytes);
      if (activePdfFeature) {
        scannerProvider = "structural-policy";
        scannerStatus = "infected";
        reason = `PDF con acción activa no permitida: ${activePdfFeature}`;
      } else {
        const scanner = await scanWithPrivateService(bytes, actualMimeType, actualSha256);
        scannerProvider = scanner.provider;
        scannerStatus = scanner.status;
        scannerReference = scanner.reference;
        reason = scanner.reason;
      }
    }
  } catch (cause) {
    scannerStatus = "error";
    reason = cause instanceof Error ? cause.message : "Falló la lectura del original";
  }

  const { data: resultRows, error: completeError } = await admin.rpc(
    "finance_document_complete_inspection",
    {
      p_version_id: target.version_id,
      p_inspection_token: target.inspection_token,
      p_actor_id: auth.user.id,
      p_actual_sha256: actualSha256,
      p_actual_mime_type: actualMimeType,
      p_actual_size_bytes: actualSizeBytes,
      p_scanner_provider: scannerProvider,
      p_scanner_status: scannerStatus,
      p_scanner_reference: scannerReference,
      p_reason: reason,
    },
  );
  if (completeError) return json({ error: completeError.message }, 500);
  const result = resultRows?.[0];
  return json({ ok: true, result });
});
