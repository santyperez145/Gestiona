// Extrae un documento Finance ya inspeccionado y guarda un borrador revisable.
// El navegador sólo envía IDs. La función descarga el original privado, vuelve
// a verificar su hash y fuerza una tool call estructurada. Sin habilitación
// legal/operativa explícita falla cerrado y no transmite ningún byte.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { resolveWorkerCapability } from "../_shared/capabilities.ts";
import { sha256Hex } from "../_shared/financeDocumentInspection.ts";
import { normalizeFinanceExtraction } from "../_shared/financeDocumentExtraction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const PROMPT_VERSION = "finance-invoice-v1";

type ExtractionTarget = {
  extraction_id: string;
  document_id: string;
  version_id: string;
  storage_path: string;
  mime_type: string;
  source_sha256: string;
  extraction_token: string | null;
  should_extract: boolean;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

const confidenceField = (valueSchema: Record<string, unknown>) => ({
  type: "object",
  properties: {
    value: valueSchema,
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["value", "confidence"],
  additionalProperties: false,
});

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const extractionTool = {
  name: "record_finance_document",
  description: "Registra únicamente los datos visibles del comprobante, con confianza por campo.",
  input_schema: {
    type: "object",
    properties: {
      supplier_name: confidenceField(nullableString),
      supplier_tax_id: confidenceField(nullableString),
      document_number: confidenceField(nullableString),
      issue_date: confidenceField(nullableString),
      currency: confidenceField({ type: ["string", "null"], enum: ["ARS", "USD", null] }),
      subtotal: confidenceField(nullableNumber),
      tax_total: confidenceField(nullableNumber),
      total: confidenceField(nullableNumber),
      items: {
        type: "array",
        maxItems: 500,
        items: {
          type: "object",
          properties: {
            description: confidenceField({ type: "string" }),
            sku: confidenceField(nullableString),
            quantity: confidenceField(nullableNumber),
            unit_price: confidenceField(nullableNumber),
            line_total: confidenceField(nullableNumber),
            tax_rate: confidenceField(nullableNumber),
          },
          required: ["description", "sku", "quantity", "unit_price", "line_total", "tax_rate"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "supplier_name", "supplier_tax_id", "document_number", "issue_date",
      "currency", "subtotal", "tax_total", "total", "items",
    ],
    additionalProperties: false,
  },
};

Deno.serve(async req => {
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
  if (!url || !anonKey || !serviceRole) return json({ error: "Configuración no disponible" }, 503);

  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, serviceRole);
  const { data: documentScope, error: scopeError } = await admin
    .from("finance_documents")
    .select("org_id")
    .eq("id", body.documentId)
    .maybeSingle();
  if (scopeError || !documentScope?.org_id) {
    return json({ error: "No se pudo verificar la capacidad documental" }, 403);
  }
  const capability = await resolveWorkerCapability(
    admin,
    documentScope.org_id,
    "finance.documents",
  );
  if (capability.error) {
    return json({ error: "No se pudo evaluar la capacidad documental" }, 503);
  }
  if (!capability.allowed) {
    return json({ error: "Finance Documents no está habilitado" }, 403);
  }
  const { data: targetRows, error: beginError } = await userClient.rpc(
    "finance_document_begin_extraction",
    { p_document_id: body.documentId, p_version_id: body.versionId },
  );
  if (beginError) return json({ error: beginError.message }, beginError.code === "42501" ? 403 : 409);
  const target = targetRows?.[0] as ExtractionTarget | undefined;
  if (!target) return json({ error: "La base no devolvió la extracción" }, 500);
  if (!target.should_extract) return json({ ok: true, skipped: true, extractionId: target.extraction_id });
  if (!target.extraction_token) return json({ error: "Lease de extracción inválido" }, 500);

  const complete = async (args: {
    payload?: Record<string, unknown>;
    confidence?: Record<string, unknown>;
    overall?: number;
    provider?: string;
    model?: string;
    failure?: string;
  }) => admin.rpc("finance_document_complete_extraction", {
    p_extraction_id: target.extraction_id,
    p_extraction_token: target.extraction_token,
    p_actor_id: auth.user.id,
    p_payload: args.payload || null,
    p_confidence: args.confidence || null,
    p_overall_confidence: args.overall ?? null,
    p_provider: args.provider || null,
    p_model: args.model || null,
    p_prompt_version: PROMPT_VERSION,
    p_failure_reason: args.failure || null,
  });

  const enabled = Deno.env.get("FINANCE_DOCUMENT_EXTRACTION_ENABLED") === "true";
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const model = Deno.env.get("FINANCE_DOCUMENT_MODEL");
  if (!enabled || !apiKey || !model) {
    await complete({ provider: "anthropic", model, failure: "Extracción externa no habilitada para documentos Finance" });
    return json({ error: "La extracción está bloqueada hasta aprobar proveedor, privacidad y modelo" }, 503);
  }

  try {
    const { data: original, error: downloadError } = await admin.storage
      .from("finance-documents")
      .download(target.storage_path);
    if (downloadError || !original) throw new Error("No se pudo leer el original privado");
    const bytes = new Uint8Array(await original.arrayBuffer());
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== target.source_sha256) throw new Error("El hash cambió después de la inspección");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4_000,
          system: "Extraé sólo evidencia visible. No completes por conocimiento previo. Si falta un valor, devolvé null y confianza 0. Respondé mediante la herramienta indicada.",
          tools: [extractionTool],
          tool_choice: { type: "tool", name: extractionTool.name },
          messages: [{
            role: "user",
            content: [
              target.mime_type === "application/pdf"
                ? { type: "document", source: { type: "base64", media_type: target.mime_type, data: bytesToBase64(bytes) } }
                : { type: "image", source: { type: "base64", media_type: target.mime_type, data: bytesToBase64(bytes) } },
              { type: "text", text: "Extraé cabecera, importes e ítems. Los totales deben copiarse; no inventes ni completes catálogos." },
            ],
          }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`El proveedor respondió HTTP ${response.status}`);
    const providerPayload = await response.json() as { content?: Array<{ type?: string; name?: string; input?: unknown }> };
    const toolUse = providerPayload.content?.find(block => block.type === "tool_use" && block.name === extractionTool.name);
    if (!toolUse) throw new Error("El proveedor no devolvió la estructura obligatoria");

    const normalized = normalizeFinanceExtraction(toolUse.input);
    const { data: resultRows, error: completeError } = await complete({
      payload: normalized.payload as unknown as Record<string, unknown>,
      confidence: normalized.confidence,
      overall: normalized.overallConfidence,
      provider: "anthropic",
      model,
    });
    if (completeError) throw completeError;
    return json({ ok: true, result: resultRows?.[0] || null });
  } catch (cause) {
    const reason = cause instanceof DOMException && cause.name === "AbortError"
      ? "El proveedor superó el timeout de 45 segundos"
      : cause instanceof Error ? cause.message : "Falló la extracción estructurada";
    const { error: completionError } = await complete({ provider: "anthropic", model, failure: reason });
    if (completionError) return json({ error: "Falló la extracción y no se pudo cerrar su lease" }, 500);
    return json({ error: reason }, 502);
  }
});
