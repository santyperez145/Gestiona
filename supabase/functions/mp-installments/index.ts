// Cuotas reales de MercadoPago para la ficha y el checkout de la tienda.
//
// En Argentina el comprador decide por la cuota antes que por el precio. Toda
// tienda de la competencia muestra "6 cuotas sin interés de $X" en la ficha;
// acá no había nada y la cuota recién aparecía dentro de MercadoPago, después
// de que el comprador ya se fue.
//
// ── Por qué se le pregunta a MercadoPago y no se configura a mano ─────────
//
// Porque las promociones de cuotas sin interés las contrata cada comercio con
// MercadoPago y cambian solas. Un campo "cantidad de cuotas" en el panel es una
// promesa que nadie verifica: si el comercio pone 12 y no las tiene contratadas,
// el comprador ve 12 en la ficha y en el checkout le aparecen con interés. Eso
// es peor que no mostrar nada.
//
// El endpoint `/v1/payment_methods/installments` devuelve exactamente lo que
// esa cuenta puede ofrecer para ese monto, con el recargo aplicado. Es el mismo
// que usa el checkout de MercadoPago, así que lo que se muestra acá es lo que
// se va a cobrar.
//
// ── Es un endpoint PÚBLICO ───────────────────────────────────────────────
//
// Lo llama el comprador anónimo, igual que `shipping-quote`. Por eso nunca
// recibe `org_id` del cliente —se resuelve por el slug— y **nunca devuelve la
// clave**: sale el listado de cuotas y nada más.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireEnv } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      // Las promociones no cambian de un minuto al otro y la ficha se mira
      // mucho. Sin caché, cada visita golpea a MercadoPago.
      "Cache-Control": "public, max-age=900",
    },
  });

/** Sin esto el checkout se cuelga esperando a MercadoPago. */
const MP_TIMEOUT_MS = 5000;

interface OpcionCuota {
  cuotas: number;
  /** Cuánto paga por cuota, ya con el recargo si lo hay. */
  monto: number;
  /** Total final. Con interés es mayor que el precio de lista. */
  total: number;
  /** `true` sólo si MercadoPago informa recargo cero. */
  sinInteres: boolean;
}

/**
 * Lo que devuelve MercadoPago por medio de pago. Se queda con las tarjetas de
 * crédito: débito y efectivo no tienen cuotas, y mezclarlos daría "1 cuota"
 * como si fuera una opción de financiación.
 */
interface MpMetodo {
  payment_type_id?: string;
  payer_costs?: Array<{
    installments?: number;
    installment_amount?: number;
    total_amount?: number;
    installment_rate?: number;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let slug = "";
  let amount = 0;
  try {
    const body = await req.json();
    slug = String(body?.slug ?? "").trim();
    amount = Number(body?.amount ?? 0);
  } catch {
    return json({ error: "Cuerpo inválido" }, 400);
  }

  if (!slug || !Number.isFinite(amount) || amount <= 0) {
    return json({ error: "Faltan slug o amount" }, 400);
  }

  const admin = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  // El org sale del slug, nunca del cliente: si lo mandara el navegador, se
  // podrían pedir las cuotas de otra organización.
  const { data: tienda } = await admin
    .from("ecommerce_stores")
    .select("org_id, payment_methods")
    .ilike("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (!tienda?.org_id) return json({ opciones: [], motivo: "tienda_no_encontrada" });

  // Si la tienda no cobra con MercadoPago, no hay cuotas que mostrar.
  if (!(tienda.payment_methods ?? []).includes("mercadopago")) {
    return json({ opciones: [], motivo: "mercadopago_no_habilitado" });
  }

  // La `public_key` es de la conexión OAuth del comercio. Se lee con
  // service_role porque `payment_connections` tiene RLS y cero policies, y no
  // sale de acá: sólo se usa para preguntarle a MercadoPago.
  const { data: conn } = await admin
    .from("payment_connections")
    .select("public_key")
    .eq("org_id", tienda.org_id)
    .eq("provider", "mercadopago")
    .maybeSingle();

  if (!conn?.public_key) {
    // Sin OAuth no hay forma de saber qué cuotas ofrece. Se devuelve vacío en
    // vez de inventar: la ficha simplemente no muestra la línea.
    return json({ opciones: [], motivo: "sin_conexion_oauth" });
  }

  // MercadoPago **exige** `payment_method_id` o `bin`: sin uno de los dos
  // responde 400 ("the payment_method_id or bin are required"). El `bin` son
  // los primeros dígitos de la tarjeta, que en una ficha de producto no
  // existen, así que se pregunta por marca.
  //
  // Estas cinco cubren prácticamente todo el crédito en Argentina. Se piden en
  // paralelo y con `allSettled`: si una marca falla o tarda, las otras igual
  // contestan y la ficha muestra cuotas.
  const MARCAS = ["visa", "master", "amex", "naranja", "cabal"];

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), MP_TIMEOUT_MS);

  const respuestas = await Promise.allSettled(MARCAS.map(async (marca) => {
    const url = "https://api.mercadopago.com/v1/payment_methods/installments" +
      `?public_key=${encodeURIComponent(conn.public_key)}` +
      `&amount=${encodeURIComponent(String(amount))}` +
      `&payment_method_id=${marca}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [] as MpMetodo[];
    return (await res.json()) as MpMetodo[];
  }));
  clearTimeout(t);

  const metodos: MpMetodo[] = respuestas
    .flatMap(r => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));

  if (metodos.length === 0) {
    // Que MercadoPago no conteste no puede romper la ficha: se muestra sin
    // cuotas, como antes.
    return json({ opciones: [], motivo: "mp_sin_respuesta" });
  }

  // Sólo crédito: débito y efectivo devuelven una única "cuota", que no es
  // financiación y confundiría.
  const costos = metodos
    .filter(m => m.payment_type_id === "credit_card")
    .flatMap(m => m.payer_costs ?? []);

  // Por cantidad de cuotas se queda la más barata: dos tarjetas pueden ofrecer
  // 6 cuotas con recargos distintos, y prometer la peor sería mentir al revés.
  const mejorPorCuota = new Map<number, OpcionCuota>();
  for (const c of costos) {
    const cuotas = Number(c.installments ?? 0);
    const monto = Number(c.installment_amount ?? 0);
    if (cuotas < 1 || monto <= 0) continue;
    const opcion: OpcionCuota = {
      cuotas,
      monto,
      total: Number(c.total_amount ?? monto * cuotas),
      // El recargo lo informa MercadoPago. No se deduce comparando totales:
      // el redondeo de centavos daría "con interés" a cuotas que no lo tienen.
      sinInteres: Number(c.installment_rate ?? 0) === 0,
    };
    const previa = mejorPorCuota.get(cuotas);
    if (!previa || opcion.monto < previa.monto) mejorPorCuota.set(cuotas, opcion);
  }

  const opciones = [...mejorPorCuota.values()].sort((a, b) => a.cuotas - b.cuotas);

  // Lo que la ficha necesita para una sola línea: la mejor cuota sin interés
  // —que es el gancho— y el máximo de cuotas disponible.
  const sinInteres = opciones.filter(o => o.sinInteres && o.cuotas > 1);
  const mejorSinInteres = sinInteres.length
    ? sinInteres.reduce((a, b) => (b.cuotas > a.cuotas ? b : a))
    : null;

  return json({
    opciones,
    mejorSinInteres,
    maxCuotas: opciones.length ? Math.max(...opciones.map(o => o.cuotas)) : 0,
  });
});
