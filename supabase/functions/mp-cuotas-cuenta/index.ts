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
import { getMpCredentials } from "../_shared/mpToken.ts";

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
  const cred = await getMpCredentials(admin, orgId);
  if (!cred) {
    // No es un error: es que todavía no conectó MercadoPago.
    return json({ conectado: false, opciones: [] });
  }

  // El endpoint devuelve lo que la cuenta del vendedor ofrece de verdad, ya con
  // sus costos de financiación aplicados. Es la única fuente honesta: cualquier
  // lista escrita por nosotros quedaría vieja el día que el comercio la cambie.
  let metodos: Array<{ payment_type_id?: string; payer_costs?: PayerCost[] }> = [];
  try {
    const res = await fetch(
      "https://api.mercadopago.com/v1/payment_methods/installments"
      + `?amount=${encodeURIComponent(String(monto))}&locale=es-AR`,
      { headers: { Authorization: `Bearer ${cred.accessToken}` } },
    );
    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      console.error("MercadoPago rechazó la consulta de cuotas", res.status, detalle.slice(0, 400));
      return json({
        conectado: true, opciones: [],
        problema: "MercadoPago no contestó qué cuotas ofrece tu cuenta. Probá de nuevo en unos minutos.",
      });
    }
    metodos = await res.json();
  } catch (e) {
    console.error("error consultando cuotas", e);
    return json({ conectado: true, opciones: [], problema: "No se pudo consultar a MercadoPago." });
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
