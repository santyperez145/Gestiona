/**
 * extract-invoice — Extracts line items from an invoice image or PDF using Claude Vision.
 *
 * Accepts: { fileBase64: string, mediaType: string } (e.g. "image/jpeg", "image/png", "application/pdf")
 * Returns: { items: Array<{ name, qty, unit_price, currency, brand, notes }> }
 *
 * Secured with JWT auth — only authenticated users can call this.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ── Inlined rate limiter (avoids _shared import issues during deploy) ──
const _rlStore = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(req: Request, fnName: string, opts: { max: number; windowMs: number }): boolean {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `${fnName}:${ip}`;
  const now = Date.now();
  const win = _rlStore.get(key);
  if (!win || now > win.resetAt) { _rlStore.set(key, { count: 1, resetAt: now + opts.windowMs }); return false; }
  win.count += 1;
  return win.count > opts.max;
}
function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "60", "Access-Control-Allow-Origin": "*" },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (checkRateLimit(req, "extract-invoice", { max: 10, windowMs: 60_000 })) return rateLimitResponse();

  // JWT auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { fileBase64, mediaType } = await req.json() as { fileBase64: string; mediaType: string };

    if (!fileBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: "Se requiere fileBase64 y mediaType" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supportedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "application/pdf"];
    if (!supportedTypes.includes(mediaType)) {
      return new Response(JSON.stringify({ error: `Tipo de archivo no soportado: ${mediaType}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isPdf = mediaType === "application/pdf";

    // Build content block — Claude supports PDFs and images natively
    const contentBlock: any = isPdf
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: mediaType, data: fileBase64 },
        };

    const systemPrompt = `Sos un asistente especializado en extraer datos de facturas de proveedores de perfumería árabe/diseñador y vapers en Argentina.
Tu tarea es analizar la imagen o PDF de la factura y extraer TODOS los productos listados.

REGLAS ESTRICTAS:
- Extraé SOLO los productos que están en la factura, sin inventar nada.
- Si un campo no está disponible, usá null.
- Los precios siempre en números sin símbolos ni separadores de miles.
- La moneda detectada: "USD" o "ARS" (si no podés determinar, usá "USD").
- Para la cantidad: si dice "1 unidad" o solo hay precio sin cantidad, usá 1.
- El nombre del producto debe ser lo más completo posible (marca + nombre + variante/tamaño si aplica).
- Respondé SOLO con JSON válido, sin texto adicional, sin markdown.`;

    const userPrompt = `Analizá este documento de factura de proveedor y extraé todos los ítems de productos.

Respondé EXCLUSIVAMENTE con este JSON:
{
  "supplier": "nombre del proveedor si está visible, sino null",
  "invoice_date": "fecha en formato YYYY-MM-DD si está visible, sino null",
  "items": [
    {
      "name": "nombre completo del producto",
      "brand": "marca si es distinguible del nombre, sino null",
      "qty": número,
      "unit_price": número,
      "currency": "USD" o "ARS",
      "notes": "información extra como tamaño, variante, código, sino null"
    }
  ]
}`;

    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            contentBlock,
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";

    // Parse JSON — strip markdown code fences if present
    const cleaned = rawText.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON from the text
      const match = cleaned.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { items: [] };
    }

    return new Response(JSON.stringify({
      supplier: parsed.supplier || null,
      invoice_date: parsed.invoice_date || null,
      items: (parsed.items || []).map((it: any) => ({
        name: String(it.name || "Producto sin nombre"),
        brand: it.brand || null,
        qty: Number(it.qty) || 1,
        unit_price: Number(it.unit_price) || 0,
        currency: it.currency === "ARS" ? "ARS" : "USD",
        notes: it.notes || null,
      })),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("extract-invoice error:", err);
    return new Response(JSON.stringify({ error: "Error al procesar la factura" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
