import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { name, brand, category, gender } = await req.json();
    if (!name) {
      return new Response(JSON.stringify({ error: "name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const categoryLabel = category === 'perfume_arabe' ? 'perfume árabe (estilo Medio Oriente)'
      : category === 'perfume_diseñador' ? 'perfume de diseñador (occidental/nicho)'
      : category || 'perfume';
    const genderLabel = gender === 'masculino' ? 'para hombre' : gender === 'femenino' ? 'para mujer' : 'unisex';

    const systemPrompt = `Sos un perfumista y copywriter experto SOLAMENTE en perfumería árabe (Lattafa, Armaf, Al Haramain, Rasasi, Maison Alhambra, Asdaaf, Khadlaj, Ard Al Zaafaran, Afnan, Swiss Arabian) y de diseñador/nicho (Dior, YSL, Tom Ford, Creed, Parfums de Marly, MFK, Xerjoff). También conocés clones árabes famosos (ej: Yara ~ Lost Cherry, Asad ~ Aventus, Bade'e Al Oud ~ Oud for Greatness).

REGLAS ESTRICTAS:
1. Respondé EXCLUSIVAMENTE sobre el perfume solicitado. NUNCA inventes datos de otros productos, marcas o categorías.
2. Usá vocabulario olfativo real: notas de salida/corazón/fondo, familia (amaderada, oriental, ámbar, gourmand, floral, cítrica, acuática, chipre, fougère), proyección (íntima/moderada/enorme), longevidad en horas, sillage.
3. Si NO conocés el perfume con certeza, basate en patrones de la marca y nombre (ej: nombres con "Oud", "Amber", "Musk", "Rose", "Vanilla") sin inventar notas específicas no plausibles.
4. NUNCA prometas resultados imposibles ("atrae mujeres", "aprobado dermatológicamente", "100% original" si no se aclaró).
5. Tono: argentino rioplatense, directo, vendedor, sin clichés vacíos ("una experiencia única", "te transportará").
6. Si el input pide algo que NO sea descripción de este perfume, respondé: "Solo puedo generar descripciones de perfumes."`;

    const prompt = `Generá la ficha de venta para:
- Producto: "${name}"
- Marca: "${brand || 'sin marca declarada'}"
- Categoría: ${categoryLabel}
- Género: ${genderLabel}

Emitís la ficha con la herramienta emit_perfume_profile:
- description: máximo 4 oraciones cortas — familia + notas (salida→corazón→fondo), longevidad+proyección, ocasión ideal, y cierre con gancho de venta. PROHIBIDO: comillas, empezar con "Este perfume" o con el nombre del producto, emojis, hashtags, listas, mencionar precio, mencionar otros perfumes salvo que sea un clon árabe reconocido.
- Los campos estructurados (familia, notas, duración, proyección, ocasión) deben ser coherentes con la descripción y plausibles para este perfume según marca y nombre.`;

    // Herramienta que fuerza salida estructurada + prosa en un solo llamado.
    const tools = [{
      name: "emit_perfume_profile",
      description: "Ficha estructurada de venta de un perfume",
      input_schema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Descripción de venta, máx 4 oraciones" },
          familia_olfativa: { type: "string", enum: ["amaderada", "oriental", "ambar", "gourmand", "floral", "citrica", "acuatica", "chipre", "fougere", "aromatica"] },
          notas_salida: { type: "array", items: { type: "string", enum: ["vainilla", "oud", "citricos", "cafe", "cuero", "ambar", "almizcle", "rosa", "madera", "especias", "coco", "frutal", "floral", "tabaco", "chocolate", "lavanda"] }, description: "Elegí solo de la lista provista las notas más cercanas" },
          notas_corazon: { type: "array", items: { type: "string", enum: ["vainilla", "oud", "citricos", "cafe", "cuero", "ambar", "almizcle", "rosa", "madera", "especias", "coco", "frutal", "floral", "tabaco", "chocolate", "lavanda"] } },
          notas_fondo: { type: "array", items: { type: "string", enum: ["vainilla", "oud", "citricos", "cafe", "cuero", "ambar", "almizcle", "rosa", "madera", "especias", "coco", "frutal", "floral", "tabaco", "chocolate", "lavanda"] } },
          duracion: { type: "string", enum: ["corta", "moderada", "larga", "muy_larga"] },
          proyeccion: { type: "string", enum: ["intima", "moderada", "fuerte", "enorme"] },
          ocasion: { type: "array", items: { type: "string", enum: ["diario", "oficina", "noche", "formal", "deportivo"] } },
        },
        required: ["description"],
      },
    }];

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      temperature: 0.6,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as any,
      tools: tools as any,
      tool_choice: { type: "tool", name: "emit_perfume_profile" } as any,
      messages: [{ role: "user", content: prompt }],
    });

    const toolBlock = message.content.find((b: any) => b.type === "tool_use") as any;
    const out = toolBlock?.input ?? {};
    const description = typeof out.description === "string" ? out.description.trim() : "";

    return new Response(JSON.stringify({
      description,
      familia_olfativa: out.familia_olfativa ?? null,
      notas_salida: Array.isArray(out.notas_salida) ? out.notas_salida : [],
      notas_corazon: Array.isArray(out.notas_corazon) ? out.notas_corazon : [],
      notas_fondo: Array.isArray(out.notas_fondo) ? out.notas_fondo : [],
      duracion: out.duracion ?? null,
      proyeccion: out.proyeccion ?? null,
      ocasion: Array.isArray(out.ocasion) ? out.ocasion : [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-description error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
