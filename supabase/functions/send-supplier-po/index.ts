/**
 * send-supplier-po — Sends a purchase order email to a supplier.
 *
 * Body: {
 *   orgId: string
 *   supplierEmail: string
 *   supplierName: string
 *   businessName: string
 *   productName: string
 *   quantity: number
 *   unitCostUSD: number
 *   totalUSD: number
 *   scheduledDate?: string   // ISO date, e.g. "2026-06-15"
 *   notes?: string
 *   exchangeRate?: number
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { remitenteDe } from "../_shared/remitente.ts";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ── Auth check ──────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) {
    return new Response(JSON.stringify({ error: "Token inválido o expirado" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const {
      orgId,
      supplierEmail,
      supplierName,
      businessName,
      productName,
      quantity,
      unitCostUSD,
      totalUSD,
      scheduledDate,
      notes,
      exchangeRate,
    } = await req.json();

    if (!supplierEmail || !productName || !orgId) {
      return new Response(
        JSON.stringify({ error: "Faltan parámetros: supplierEmail, productName, orgId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const smtpCfg = await smtpDeOrganizacion(orgId);
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    if (!smtpCfg && !resendKey) {
      return new Response(
        JSON.stringify({ error: "No hay proveedor de email configurado. Configurá SMTP en Ajustes." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build PO HTML ────────────────────────────────────────
    const fmtUSD = (n: number) =>
      new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

    const today = new Date().toLocaleDateString("es-AR", {
      day: "2-digit", month: "long", year: "numeric",
    });
    const scheduledStr = scheduledDate
      ? new Date(scheduledDate).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
      : null;

    const poNumber = `PO-${Date.now().toString().slice(-6)}`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pedido de Compra — ${businessName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #f0f0f4; color: #1a1a2e; padding: 24px; }
  .container { max-width: 620px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .header { background: #1a1a2e; padding: 28px 36px; }
  .header h1 { color: #d4a843; font-size: 20px; margin-bottom: 4px; }
  .header p { color: rgba(255,255,255,0.6); font-size: 12px; }
  .body { padding: 28px 36px; }
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 13px; color: #666; }
  .meta-row strong { color: #1a1a2e; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
  th { background: #1a1a2e; color: #d4a843; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }
  tr:nth-child(even) td { background: #fafafa; }
  .total-row td { border-top: 2px solid #d4a843; font-weight: 700; font-size: 14px; }
  .total-row td:last-child { color: #d4a843; }
  .notes-box { background: #fffbeb; border-left: 3px solid #d4a843; padding: 12px 14px; border-radius: 0 6px 6px 0; font-size: 13px; color: #555; margin-bottom: 20px; }
  .dates-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .date-card { background: #f9f9fb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  .date-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 4px; }
  .date-value { font-size: 14px; font-weight: 600; color: #1a1a2e; }
  .footer { background: #f9f9fb; padding: 18px 36px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #e5e7eb; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${businessName}</h1>
    <p>Pedido de Compra N° ${poNumber} · Emitido el ${today}</p>
  </div>
  <div class="body">
    <div class="meta-row">
      <div><div style="font-size:10px;text-transform:uppercase;color:#aaa;margin-bottom:2px">Proveedor</div><strong>${supplierName || "—"}</strong></div>
      <div style="text-align:right"><div style="font-size:10px;text-transform:uppercase;color:#aaa;margin-bottom:2px">Número de Pedido</div><strong>${poNumber}</strong></div>
    </div>

    ${scheduledStr ? `
    <div class="dates-grid">
      <div class="date-card"><div class="date-label">Fecha de emisión</div><div class="date-value">${today}</div></div>
      <div class="date-card"><div class="date-label">Entrega estimada</div><div class="date-value">${scheduledStr}</div></div>
    </div>` : ""}

    <div class="section-title">Detalle del pedido</div>
    <table>
      <thead><tr><th>Producto</th><th style="text-align:right">Cant.</th><th style="text-align:right">Precio Unit.</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>
        <tr>
          <td>${productName}</td>
          <td style="text-align:right">${quantity}</td>
          <td style="text-align:right">${fmtUSD(Number(unitCostUSD || 0))}</td>
          <td style="text-align:right">${fmtUSD(Number(totalUSD || 0))}</td>
        </tr>
        <tr class="total-row">
          <td colspan="3"><strong>Total del pedido</strong></td>
          <td style="text-align:right"><strong>${fmtUSD(Number(totalUSD || 0))}</strong></td>
        </tr>
      </tbody>
    </table>

    ${notes ? `<div class="notes-box"><strong>Notas:</strong> ${notes}</div>` : ""}

    <p style="font-size:13px;color:#666;line-height:1.6">
      Por favor confirmá la recepción de este pedido respondiendo este correo.
      Ante cualquier consulta no dudes en contactarnos.
    </p>
    <br>
    <p style="font-size:13px;color:#1a1a2e;font-weight:600">Muchas gracias,<br>${businessName}</p>
  </div>
  <div class="footer">
    Este pedido de compra fue generado automáticamente por ${businessName} via Nerqia.<br>
    ${exchangeRate ? `TC referencia: $${Number(exchangeRate).toLocaleString("es-AR")} ARS/USD` : ""}
  </div>
</div>
</body>
</html>`;

    // ── Send ─────────────────────────────────────────────────
    const result = await sendEmail(
      smtpCfg,
      resendKey,
      (await remitenteDe("pedidos")).from,
      {
        to: supplierEmail,
        subject: `Pedido de Compra N° ${poNumber} — ${productName} (${quantity} u.)`,
        html,
      },
    );

    if (!result.ok) {
      console.error("send-supplier-po error:", result.error);
      return new Response(JSON.stringify({ error: result.error || "Error al enviar email" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`send-supplier-po: to=${supplierEmail} provider=${result.provider}`);
    return new Response(JSON.stringify({ success: true, poNumber, provider: result.provider }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-supplier-po error:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
