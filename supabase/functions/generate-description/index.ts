import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const isPerfume = !category || category.toString().toLowerCase().includes('perfume') || category === 'perfume_arabe' || category === 'perfume_diseñador';
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

    const prompt = `Generá la descripción de venta para:
- Producto: "${name}"
- Marca: "${brand || 'sin marca declarada'}"
- Categoría: ${categoryLabel}
- Género: ${genderLabel}

Incluí en este orden, en máximo 4 oraciones cortas:
1. Familia olfativa + notas principales (salida → corazón → fondo) plausibles para este perfume.
2. Longevidad estimada (en horas) y proyección.
3. Ocasión ideal (1-2: noche, oficina, citas, clima cálido/frío).
4. Cierre con gancho de venta corto.

PROHIBIDO: comillas, empezar con "Este perfume" o con el nombre del producto, emojis, hashtags, listas, viñetas, mencionar precio, mencionar otros perfumes salvo que sea un clon árabe reconocido del producto.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        temperature: 0.6,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes, intentá de nuevo en unos segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(JSON.stringify({ description }), {
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
