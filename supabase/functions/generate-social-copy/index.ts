import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const POST_TYPE_LABEL: Record<string, string> = {
  post: "post de feed de Instagram",
  story: "historia de Instagram (breve, con gancho para deslizar/responder)",
  reel: "reel de Instagram (guion corto y dinámico, con hook en la primera línea)",
  carousel: "carrusel de Instagram (varias slides, texto que invite a deslizar)",
  thread: "hilo",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Esta función gasta crédito de Anthropic: exige un usuario real. `verify_jwt`
  // no sirve de barrera porque la clave anónima es un JWT válido y pública.
  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const { productName, brand, category, postType, topic } = await req.json();
    if (!productName && !topic) {
      return new Response(JSON.stringify({ error: "productName or topic is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const typeLabel = POST_TYPE_LABEL[postType] || "post de Instagram";
    const catLabel = category === "perfume_arabe" ? "perfume árabe"
      : category === "perfume_diseñador" ? "perfume de diseñador"
      : category === "vaper" ? "vaper" : category || "";

    const systemPrompt = `Sos community manager y copywriter de una tienda argentina de perfumería árabe/de diseñador y vapers que vende por Instagram y WhatsApp. Escribís en español rioplatense, cercano y vendedor, sin clichés vacíos. Conocés las marcas árabes (Lattafa, Armaf, Al Haramain, Rasasi, Maison Alhambra, Afnan) y de diseñador.

REGLAS:
1. Copy pensado para vender, con un gancho fuerte en la primera línea.
2. Emojis con moderación (2-5, bien ubicados), NUNCA en exceso.
3. Sin inventar datos falsos ni promesas imposibles ("atrae mujeres", "100% original" si no se aclaró).
4. Incluí un call-to-action claro (escribinos por WhatsApp / DM para reservar).
5. Hashtags relevantes al rubro perfumería/vapers en Argentina, en minúscula, sin espacios.`;

    const prompt = `Generá el copy para un ${typeLabel}.
${productName ? `- Producto: "${productName}"` : ""}
${brand ? `- Marca: "${brand}"` : ""}
${catLabel ? `- Tipo: ${catLabel}` : ""}
${topic && topic !== productName ? `- Tema/ángulo: ${topic}` : ""}

Emití con la herramienta emit_social_copy: un título corto interno, el contenido del ${typeLabel}, y 8-15 hashtags.`;

    const tools = [{
      name: "emit_social_copy",
      description: "Copy de red social listo para publicar",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título interno corto para identificar el post" },
          content: { type: "string", description: "Texto del post/historia/reel listo para publicar" },
          hashtags: { type: "array", items: { type: "string" }, description: "Hashtags sin el símbolo #, en minúscula" },
        },
        required: ["content"],
      },
    }];

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      temperature: 0.8,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any,
      tools: tools as any,
      tool_choice: { type: "tool", name: "emit_social_copy" } as any,
      messages: [{ role: "user", content: prompt }],
    });

    const toolBlock = message.content.find((b: any) => b.type === "tool_use") as any;
    const out = toolBlock?.input ?? {};
    const hashtags = Array.isArray(out.hashtags)
      ? out.hashtags.map((h: string) => h.replace(/^#/, "").trim()).filter(Boolean)
      : [];

    return new Response(JSON.stringify({
      title: typeof out.title === "string" ? out.title.trim() : "",
      content: typeof out.content === "string" ? out.content.trim() : "",
      hashtags,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-social-copy error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
