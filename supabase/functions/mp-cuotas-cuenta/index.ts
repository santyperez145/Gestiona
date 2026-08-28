/**
 * mp-cuotas-cuenta — qué cuotas ofrece HOY la cuenta de MercadoPago del
 * comercio, para mostrárselo en Ajustes sin que tenga que averiguarlo.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * El reporte fue: «¿por qué Tiendanube puede gestionar las cuotas que cobra con
 * MercadoPago y yo no?». Verificado el 2026-08-27 en la documentación de
 * MercadoPago y en la de Tiendanube:
 *
 *   - **MercadoPago no expone una API para configurar** qué cuotas financia un
 *     vendedor. Sólo expone, al procesar, cuáles hay disponibles.
 *   - **Tiendanube tampoco la tiene.** Su propia página dice que desarrollaron
 *     «nuestro propio plan para que puedas ofrecer cuotas con los mismos costos
 *     de financiación»: armaron un programa de financiación propio. Es un
 *     acuerdo comercial, no una integración.
 *
 * 📌 Así que la diferencia real no es técnica, y prometer lo contrario sería
 * vender algo que no se puede construir. Lo que sí se puede es que el comercio
 * **no tenga que saber nada**: le preguntamos a MercadoPago con su propio token
 * qué ofrece su cuenta, se lo mostramos en castellano, y elige. Si quiere más,
 * un botón lo lleva al lugar exacto y al volver esto se actualiza solo.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, " +
    "x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface PayerCost {
  installments?: number;
  installment_rate?: number;
  installment_amount?: number;
  labels?: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRole) return json({ error: "Configuración no disponible" }, 503);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autenticado" }, 401);

  const sb = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) return json({ error: "No autenticado" }, 401);

  let orgId: string | undefined;
  let monto = 100000;
  try {
    const body = await req.json();
    orgId = body?.org_id;
    if (Number(body?.amount) > 0) monto = Number(body.amount);
  } catch { /* se usa el monto de referencia */ }
  if (!orgId) return json({ error: "Falta la organización" }, 400);

  // Ser miembro alcanza para VER qué ofrece la cuenta del propio comercio.
  const { data: esMiembro } = await sb.rpc("is_org_member", {
    _org_id: orgId, _user_id: userRes.user.id,
  });
  if (!esMiembro) return json({ error: "Sin acceso a esta organización" }, 403);

  const admin = createClient(url, serviceRole);

  // La `public_key` sale de la conexión OAuth del comercio. Se lee con
  // service_role porque `payment_connections` tiene RLS y cero policies, y no
  // sale de acá: sólo se usa para preguntarle a MercadoPago.
  const { data: conn } = await admin
    .from("payment_connections")
    .select("public_key")
    .eq("org_id", orgId)
    .eq("provider", "mercadopago")
    .maybeSingle();

  if (!conn?.public_key) {
    // No es un error: es que todavía no conectó MercadoPago por OAuth.
    return json({ conectado: false, opciones: [] });
  }

  /**
   * ⚠️ El endpoint **exige `payment_method_id`**: con sólo `amount` contesta un
   * error, y la pantalla mostraba «MercadoPago no contestó». La primera versión
   * de esta función mandaba un Bearer y el monto, nada más.
   *
   * 📌 `mp-installments` —la que ya funcionaba— consulta marca por marca con la
   * `public_key`. Se hace igual: cuando una función del mismo repo ya resolvió
   * el mismo problema contra el mismo proveedor, copiar su forma es más barato
   * que redescubrirla.
   */
  const MARCAS = ["visa", "master", "amex", "naranja", "cabal"];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);

  const respuestas = await Promise.allSettled(MARCAS.map(async (marca) => {
    const res = await fetch(
      "https://api.mercadopago.com/v1/payment_methods/installments"
      + `?public_key=${encodeURIComponent(conn.public_key)}`
      + `&amount=${encodeURIComponent(String(monto))}`
      + `&payment_method_id=${marca}`,
      { signal: ctrl.signal },
    );
    if (!res.ok) {
      console.error("MercadoPago rechazó las cuotas de", marca, res.status,
                    (await res.text().catch(() => "")).slice(0, 300));
      return [] as Array<{ payment_type_id?: string; payer_costs?: PayerCost[] }>;
    }
    return await res.json();
  }));
  clearTimeout(t);

  const metodos: Array<{ payment_type_id?: string; payer_costs?: PayerCost[] }> =
    respuestas.flatMap(r => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));

  if (metodos.length === 0) {
    // Que ninguna marca conteste es distinto de «no ofrece cuotas»: se dice.
    return json({
      conectado: true, opciones: [],
      problema: "MercadoPago no contestó qué cuotas ofrece tu cuenta. Probá de nuevo en unos minutos.",
    });
  }

  // Sólo crédito: débito y efectivo devuelven una "cuota" única que no es
  // financiación y confundiría al comercio tanto como al comprador.
  const costos = metodos
    .filter(m => m.payment_type_id === "credit_card")
    .flatMap(m => m.payer_costs ?? []);

  const porCuota = new Map<number, { cuotas: number; sinInteres: boolean; recargoPct: number }>();
  for (const c of costos) {
    const cuotas = Number(c.installments ?? 0);
    if (cuotas < 1) continue;
    const recargo = Number(c.installment_rate ?? 0);
    const previa = porCuota.get(cuotas);
    // Entre tarjetas, la mejor: prometer la peor sería mentir al revés.
    if (!previa || recargo < previa.recargoPct) {
      porCuota.set(cuotas, { cuotas, sinInteres: recargo === 0, recargoPct: recargo });
    }
  }

  const opciones = [...porCuota.values()].sort((a, b) => a.cuotas - b.cuotas);

  return json({
    conectado: true,
    montoDeReferencia: monto,
    opciones,
    maxCuotas: opciones.length ? Math.max(...opciones.map(o => o.cuotas)) : 0,
    maxSinInteres: opciones.filter(o => o.sinInteres).reduce((m, o) => Math.max(m, o.cuotas), 0),
  });
});
