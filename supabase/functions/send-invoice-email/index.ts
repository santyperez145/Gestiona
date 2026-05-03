import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to, subject, invoiceNumber, customerName, orgName, totalARS, dueDate, pdfBase64, notes } = await req.json();

    if (!to || !subject || !invoiceNumber) {
      return new Response(JSON.stringify({ error: "Faltan parámetros requeridos: to, subject, invoiceNumber" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dueDateStr = dueDate
      ? new Date(dueDate).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })
      : null;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Factura ${invoiceNumber}</title>
<style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .header { background: #1a1a2e; padding: 32px 40px; }
  .header h1 { color: #d4a843; margin: 0 0 4px; font-size: 22px; }
  .header p { color: #aab; margin: 0; font-size: 13px; }
  .body { padding: 32px 40px; }
  .greeting { font-size: 16px; margin-bottom: 16px; }
  .detail-row { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding: 10px 0; font-size: 14px; }
  .detail-row:last-child { border-bottom: none; }
  .label { color: #888; }
  .value { font-weight: 600; color: #222; }
  .total-row .value { font-size: 18px; color: #d4a843; }
  .notes-box { background: #f9f9f9; border-left: 3px solid #d4a843; padding: 12px 16px; margin: 20px 0; font-size: 13px; color: #555; border-radius: 0 6px 6px 0; }
  .footer { background: #f9f9f9; padding: 20px 40px; text-align: center; font-size: 12px; color: #999; }
  .btn { display: inline-block; background: #d4a843; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${orgName || "Sistema de Gestión"}</h1>
    <p>Comprobante de pago</p>
  </div>
  <div class="body">
    <p class="greeting">Hola <strong>${customerName || "cliente"}</strong>,</p>
    <p>Adjuntamos el detalle de tu factura <strong>N° ${invoiceNumber}</strong>:</p>
    <div>
      <div class="detail-row"><span class="label">Número</span><span class="value">${invoiceNumber}</span></div>
      ${totalARS ? `<div class="detail-row total-row"><span class="label">Total</span><span class="value">${totalARS}</span></div>` : ""}
      ${dueDateStr ? `<div class="detail-row"><span class="label">Vencimiento</span><span class="value">${dueDateStr}</span></div>` : ""}
    </div>
    ${notes ? `<div class="notes-box">${notes}</div>` : ""}
    ${pdfBase64 ? `<p style="font-size:13px; color:#666;">Se adjunta el PDF de la factura a este correo.</p>` : ""}
    <p style="font-size:13px; color:#888; margin-top:24px;">Ante cualquier consulta, no dudes en contactarnos.</p>
  </div>
  <div class="footer">
    Este correo fue generado automáticamente por ${orgName || "el sistema de gestión"}.<br>
    Por favor no respondas este mensaje.
  </div>
</div>
</body>
</html>`;

    const attachments = pdfBase64
      ? [{ filename: `factura-${invoiceNumber}.pdf`, content: pdfBase64, type: "application/pdf", disposition: "attachment" }]
      : [];

    const payload: any = {
      from: "facturas@gestiona.app",
      to: [to],
      subject,
      html,
    };
    if (attachments.length > 0) payload.attachments = attachments;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Resend error:", data);
      return new Response(JSON.stringify({ error: data.message || "Error al enviar email" }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: data.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-invoice-email error:", err);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
