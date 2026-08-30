/**
 * extract-receipt — propone los campos de un comprobante para el formulario de
 * Gastos. No guarda el gasto ni el archivo: la persona revisa y confirma.
 *
 * Acepta: { fileBase64, mediaType, orgId, categorias? }
 * Devuelve: { amount, vendor, date, category, description }
 *
 * Es una función separada de `ai-chat` (SSE conversacional), `extract-invoice`
 * (renglones para Compras) y `extract-finance-document` (producto Finance con
 * revisión versionada). Mezclar esos contratos fue el origen del fallo.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { exigirBeneficio, registrarConsumoIA } from "../_shared/entitlements.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Modelo fijo y auditable: cambiarlo requiere volver a medir exactitud/costo.
const MODELO = "claude-sonnet-5";
const TIPOS_SOPORTADOS = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// La API directa admite hasta 10 MB de base64. El navegador comprime antes y
// este límite deja un error accionable antes de gastar una llamada externa.
const MAX_BASE64_CHARS = 10 * 1024 * 1024;

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function texto(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio ? limpio.slice(0, max) : null;
}

function monto(valor: unknown): number | null {
  const numero = typeof valor === "number"
    ? valor
    : typeof valor === "string"
      ? Number(valor)
      : Number.NaN;
  if (!Number.isFinite(numero) || numero <= 0 || numero > 999_999_999_999.99) return null;
  return Math.round(numero * 100) / 100;
}

function fecha(valor: unknown): string | null {
  const candidata = texto(valor, 10);
  if (!candidata || !/^\d{4}-\d{2}-\d{2}$/.test(candidata)) return null;
  const date = new Date(`${candidata}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidata) return null;
  return date.getTime() <= Date.now() + 86_400_000 ? candidata : null;
}

function base64Valido(valor: string): boolean {
  if (!valor || valor.length > MAX_BASE64_CHARS || valor.length % 4 !== 0) return false;
  if (/[^A-Za-z0-9+/=]/.test(valor)) return false;
  const primerPadding = valor.indexOf("=");
  return primerPadding < 0 || (primerPadding >= valor.length - 2 && !valor.slice(0, primerPadding).includes("="));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // La clave anónima también es un JWT: se exige una persona real antes de
  // aceptar un documento o consumir capacidad del proveedor.
  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  const { fileBase64, mediaType, orgId, categorias } = await req.json().catch(() => ({})) as {
    fileBase64?: unknown;
    mediaType?: unknown;
    orgId?: unknown;
    categorias?: unknown;
  };
  const imagen = typeof fileBase64 === "string" ? fileBase64.trim() : "";
  const tipo = typeof mediaType === "string" ? mediaType.toLowerCase().trim() : "";
  const org = typeof orgId === "string" ? orgId.trim() : "";
  const lista = Array.from(new Set(
    Array.isArray(categorias)
      ? categorias
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 50)
      : [],
  ));

  // Todo error de forma se resuelve antes del proveedor y antes del cupo.
  if (!imagen) return json({ error: "Falta la imagen del comprobante" }, 400);
  if (!tipo) return json({ error: "Falta el tipo de archivo" }, 400);
  if (!TIPOS_SOPORTADOS.has(tipo)) {
    return json({ error: "La extracción admite JPG, PNG, WebP o GIF" }, 415);
  }
  if (!base64Valido(imagen)) {
    return json({ error: "La imagen está dañada o pesa demasiado. Probá con una foto más liviana." }, 413);
  }
  if (!UUID.test(org)) return json({ error: "Falta una organización válida" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "La extracción no está configurada" }, 503);

  // La función no lee tablas del comercio salvo esta verificación; sin ella
  // alguien podría mandar el orgId de otro tenant y usar su cupo.
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: membresia, error: errorMembresia } = await sb
    .from("memberships")
    .select("role")
    .eq("org_id", org)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (errorMembresia) {
    console.error("extract-receipt: no se pudo verificar la membresía", errorMembresia);
    return json({ error: "No se pudo verificar tu acceso a esta organización" }, 503);
  }
  if (!membresia) return json({ error: "Sin acceso a esta organización" }, 403);

  // Primero el plan: a un comercio sin el beneficio le sirve saber cómo
  // resolverlo, no enterarse de detalles internos de configuración.
  const gate = await exigirBeneficio(req, org, "ia", corsHeaders);
  if (gate) return gate;

  // Un comprobante puede contener CUIT, medios de pago u otros datos. No se
  // activa por el solo hecho de configurar IA general: requiere aprobación
  // explícita del proveedor y su tratamiento documental.
  if (Deno.env.get("EXPENSE_RECEIPT_EXTRACTION_ENABLED") !== "true") {
    return json({
      error: "La extracción automática todavía no está habilitada. Podés adjuntar el comprobante y completar el gasto manualmente.",
      code: "extraccion_no_habilitada",
    }, 503);
  }
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({
      error: "La extracción automática no está configurada. Podés adjuntar el comprobante y completar el gasto manualmente.",
      code: "ia_no_configurada",
    }, 503);
  }

  if (checkRateLimit(req, "extract-receipt", { max: 20, windowMs: 60_000 })) {
    return rateLimitResponse();
  }

  const herramienta = {
    name: "registrar_comprobante",
    description: "Datos observados en un comprobante de gasto; no registra el gasto.",
    input_schema: {
      type: "object",
      properties: {
        amount: {
          type: ["number", "null"],
          description: "Total final pagado. null si no se lee con claridad.",
        },
        vendor: {
          type: ["string", "null"],
          description: "Nombre del comercio o proveedor. null si no se lee.",
        },
        date: {
          type: ["string", "null"],
          description: "Fecha de emisión en YYYY-MM-DD. null si no se lee.",
        },
        category: {
          type: ["string", "null"],
          enum: lista.length ? [...lista, null] : undefined,
          description: lista.length
            ? "Una categoría exacta de la lista recibida; null si ninguna corresponde."
            : "Siempre null porque no se recibió una lista de categorías.",
        },
        description: {
          type: ["string", "null"],
          description: "Qué se compró, en pocas palabras. null si no se observa.",
        },
      },
      required: ["amount", "vendor", "date", "category", "description"],
    },
  };

  const instruccion = `Analizá este comprobante de gasto de un comercio argentino y usá la herramienta registrar_comprobante.

REGLAS:
- Leé sólo lo visible. Si un dato no se distingue, devolvé null; nunca inventes ni estimes.
- El monto es el total final pagado, no un subtotal ni un renglón.
- Convertí DD/MM/AAAA a YYYY-MM-DD.
- En importes argentinos, la coma es decimal y el punto separa miles.
- Categorías permitidas: ${lista.length ? JSON.stringify(lista) : "ninguna; devolvé null"}.`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const respuesta = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 1000,
      tools: [herramienta] as never,
      tool_choice: { type: "tool", name: "registrar_comprobante" } as never,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: tipo, data: imagen } },
          { type: "text", text: instruccion },
        ],
      }] as never,
    });

    // El proveedor ya contestó y cobró: recién ahora se descuenta el cupo.
    await registrarConsumoIA({
      orgId: org,
      userId: auth.user.id,
      model: MODELO,
      input: respuesta.usage?.input_tokens,
      output: respuesta.usage?.output_tokens,
    });

    const uso = respuesta.content.find((bloque: { type: string }) => bloque.type === "tool_use") as
      | { input?: Record<string, unknown> }
      | undefined;
    if (!uso?.input) {
      console.error("extract-receipt: el modelo no produjo la salida estructurada");
      return json({ error: "No se pudo leer el comprobante. Probá con una foto más nítida." }, 502);
    }

    const categoria = texto(uso.input.category, 60);
    return json({
      amount: monto(uso.input.amount),
      vendor: texto(uso.input.vendor, 120),
      date: fecha(uso.input.date),
      category: categoria && lista.includes(categoria) ? categoria : null,
      description: texto(uso.input.description, 300),
      reviewRequired: true,
    });
  } catch (error) {
    console.error("extract-receipt: proveedor", error);
    const mensaje = error instanceof Error ? error.message.toLowerCase() : "";
    if (mensaje.includes("credit") || mensaje.includes("billing")) {
      return json({ error: "La extracción automática no tiene crédito disponible. Completá el gasto manualmente." }, 503);
    }
    if (mensaje.includes("rate") || mensaje.includes("429")) {
      return json({ error: "La extracción está ocupada. Probá de nuevo en un minuto." }, 429);
    }
    return json({ error: "No se pudo leer el comprobante. Probá otra foto o completá el gasto manualmente." }, 502);
  }
});
