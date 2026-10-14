import { supabase } from "@/integrations/supabase/client";
import { fetchPaymentStatus } from "@/lib/paymentStatus";

/**
 * Link de pago de un presupuesto (2026-10-14, funciones incoherentes). Antes
 * Presupuestos tenía dos botones: «Link de pago», que creaba un link nuevo en
 * cada sesión (varios links para el mismo presupuesto), y «Link MP», que cobraba
 * con la referencia `quote:<id>`, que el webhook no reconoce: el cliente pagaba
 * y no se registraba la venta ni el presupuesto quedaba vendido.
 *
 * Ahora hay uno solo y pasa por `payment_links` con referencia `link:<id>`: el
 * webhook registra la venta con su stock (registrar_venta_de_link) y marca el
 * presupuesto vendido. Si ya hay un link pendiente para el presupuesto, se
 * reutiliza.
 */
export interface PresupuestoParaLink {
  id: string;
  quote_number: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  items: unknown;
  total: number;
  notes?: string | null;
  valid_until?: string | null;
}

export async function linkDePagoDePresupuesto(orgId: string, q: PresupuestoParaLink, negocio: string): Promise<{ url: string; nuevo: boolean; conMercadoPago: boolean }> {
  const { data: existente, error: errLeer } = await supabase.from("payment_links")
    .select("id, mp_link, external_ref, total_ars")
    .eq("org_id", orgId).eq("quote_id", q.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (errLeer) throw errLeer;

  let link = existente as { id: string; mp_link: string | null; external_ref: string | null; total_ars: number } | null;
  let nuevo = false;
  // Un link pendiente con otro total (el presupuesto se editó) no sirve: se arma otro.
  if (link && Math.abs(Number(link.total_ars) - Number(q.total)) > 0.01) link = null;
  if (!link) {
    const id = crypto.randomUUID();
    const { data, error } = await supabase.from("payment_links").insert({
      id, org_id: orgId, quote_id: q.id, quote_number: q.quote_number,
      customer_name: q.customer_name, customer_phone: q.customer_phone || null, customer_email: q.customer_email || null,
      items: q.items as never, total_ars: q.total, status: "pending", notes: q.notes || null,
      expires_at: q.valid_until || null, external_ref: `link:${id}`,
    }).select("id, mp_link, external_ref, total_ars").single();
    if (error) throw error;
    link = data as typeof link;
    nuevo = true;
  }

  let conMercadoPago = !!link!.mp_link;
  if (!link!.mp_link) {
    const estado = await fetchPaymentStatus(orgId).catch(() => null);
    if (estado?.connected) {
      const { data: mp, error: mpErr } = await supabase.functions.invoke("mercadopago-link", {
        body: { orgId, title: `Presupuesto ${q.quote_number} — ${negocio}`, paymentLinkId: link!.id, externalRef: link!.external_ref },
      });
      // Sin Mercado Pago el link igual sirve (transferencia o efectivo desde la página de pago).
      if (mpErr || mp?.error) console.warn("[presupuesto] no se generó el cobro de Mercado Pago", mpErr ?? mp?.error);
      else if (mp?.url) {
        const { error: guardarErr } = await supabase.from("payment_links")
          .update({ mp_link: mp.url, mp_preference_id: mp.preferenceId || null }).eq("id", link!.id);
        if (guardarErr) console.warn("[presupuesto] no se guardó el link de Mercado Pago", guardarErr);
        else conMercadoPago = true;
      }
    }
  }
  return { url: `${window.location.origin}/pagar/${link!.id}`, nuevo, conMercadoPago };
}
