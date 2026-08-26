// Edge function: check-stock-alerts
// Runs daily via pg_cron. Finds products below threshold and creates notifications.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// El umbral por producto vive en `products.low_stock_threshold`. Cuando esa
// columna está vacía se usa 3, que es el mismo número que muestra el panel
// ("Stock bajo · 1–3 unidades").
const UMBRAL_POR_DEFECTO = 3;

// Tope explícito para que una truncación se vea. Ver el comentario de abajo.
const TOPE_PRODUCTOS = 5000;

Deno.serve(async (req) => {
  try {
    // ⚠️ Acá había una primera consulta que llamaba a `supabase.rpc(
    //    "low_stock_threshold")`. Ese nombre **no es un RPC: es una columna de
    //    `products`**. La llamada devolvía un builder, se stringificaba dentro
    //    del `.filter()` y armaba una consulta inválida; su `error` se
    //    destructuraba y no se miraba nunca, y su resultado se descartaba dos
    //    líneas más abajo. Corría todos los días a las 9 sin hacer nada.

    // ⚠️ Y el error de la consulta que SÍ se usaba tampoco se miraba: con
    //    `data` en null, `(allProducts || [])` daba cero productos y la
    //    función respondía `{ok: true, alerts: 0}`. El cron quedaba en verde
    //    informando que no hay stock bajo, que es exactamente lo contrario de
    //    lo que había pasado. Un fallo tiene que fallar.
    const { data: allProducts, error } = await supabase
      .from("products")
      .select("id, name, stock, org_id, low_stock_threshold")
      .eq("is_active", true)
      .order("id")
      .limit(TOPE_PRODUCTOS);

    if (error) {
      throw new Error(`no se pudieron leer los productos: ${error.message}`);
    }

    // ⚠️ PostgREST corta en 1.000 filas por defecto y no avisa. Con el tope
    //    explícito, alcanzarlo se informa en la respuesta en vez de que la
    //    alerta deje de cubrir productos en silencio a medida que crece el
    //    catálogo. Cuando esto se toque, el arreglo es paginar, no subir el
    //    número.
    const truncado = (allProducts?.length ?? 0) >= TOPE_PRODUCTOS;

    const lowStock = (allProducts ?? []).filter((p: any) => {
      const threshold = p.low_stock_threshold ?? UMBRAL_POR_DEFECTO;
      return p.stock <= threshold && p.stock >= 0;
    });

    if (lowStock.length === 0) {
      return new Response(JSON.stringify({ ok: true, alerts: 0, truncado }), { headers: { "Content-Type": "application/json" } });
    }

    // Group by org
    const byOrg: Record<string, any[]> = {};
    lowStock.forEach((p: any) => {
      if (!byOrg[p.org_id]) byOrg[p.org_id] = [];
      byOrg[p.org_id].push(p);
    });

    // For each org, get the owner's user_id and send notification
    let total = 0;
    for (const [orgId, prods] of Object.entries(byOrg)) {
      const { data: members } = await supabase
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .in("role", ["owner", "admin"]);

      if (!members?.length) continue;

      const today = new Date().toISOString().slice(0, 10);

      for (const member of members) {
        // Check if we already sent a stock alert today
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", member.user_id)
          .eq("type", "stock_bajo")
          .gte("created_at", `${today}T00:00:00`)
          .limit(1);

        if (existing?.length) continue;

        const names = prods.slice(0, 5).map((p: any) => `${p.name} (${p.stock} en stock)`).join(", ");
        const extra = prods.length > 5 ? ` y ${prods.length - 5} más` : "";

        await supabase.from("notifications").insert({
          user_id: member.user_id,
          org_id: orgId,
          type: "stock_bajo",
          title: `${prods.length} producto${prods.length !== 1 ? "s" : ""} con stock bajo`,
          message: names + extra,
          read: false,
        });
        total++;
      }
    }

    return new Response(JSON.stringify({ ok: true, alerts: total, truncado }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
