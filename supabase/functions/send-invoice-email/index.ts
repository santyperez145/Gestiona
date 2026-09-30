/** Transactional documents are resolved from persisted rows, never composed by the browser. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { remitenteDe } from "../_shared/remitente.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rateLimiter.ts";
import { sendEmail, smtpDeOrganizacion } from "../_shared/smtpSender.ts";
import { emailFailure } from "../_shared/emailErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
const json = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

type DocumentKind = "invoice" | "quote" | "pos_receipt";
type Line = { description: string; quantity: number; total: number };
type EmailDocument = {
  kind: DocumentKind;
  title: string;
  number: string;
  customerName: string;
  recipient: string;
  total: number;
  currency: string;
  dueDate: string | null;
  notes: string | null;
  lines: Line[];
  fiscalNotice: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido", code: "METHOD_NOT_ALLOWED" }, 405);
  if (checkRateLimit(req, "send-invoice-email", { max: 30, windowMs: 60_000 })) return rateLimitResponse();

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Iniciá sesión para enviar el comprobante", code: "UNAUTHENTICATED" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user?.id) return json({ error: "La sesión venció. Volvé a iniciar sesión", code: "INVALID_SESSION" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { orgId, documentType, documentId, to } = await req.json();
    if (!UUID.test(String(orgId ?? "")) || !UUID.test(String(documentId ?? "")) ||
      !["invoice", "quote", "pos_receipt"].includes(documentType)) {
      return json({ error: "Elegí un comprobante válido para enviar", code: "INVALID_DOCUMENT" }, 400);
    }

    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userRes.user.id)
      .in("role", ["owner", "admin", "vendedor"])
      .maybeSingle();
    if (membershipError) {
      console.error("send-invoice-email membership:", membershipError);
      return json({ error: "No se pudo verificar tu permiso", code: "PERMISSION_CHECK_FAILED" }, 500);
    }
    if (!membership) return json({ error: "No tenés permiso para enviar comprobantes de esta organización", code: "FORBIDDEN" }, 403);

    const { data: org, error: orgError } = await admin.from("organizations")
      .select("name").eq("id", orgId).single();
    if (orgError || !org) return json({ error: "No encontramos la organización", code: "ORG_NOT_FOUND" }, 404);

    let document: EmailDocument;
    if (documentType === "invoice") {
      const { data: invoice, error } = await admin.from("invoices")
        .select("number, customer_name, customer_email, total, currency, due_date, notes, status, tipo_comprobante, cae")
        .eq("org_id", orgId).eq("id", documentId).maybeSingle();
      if (error) throw error;
      if (!invoice) return json({ error: "No encontramos la factura", code: "DOCUMENT_NOT_FOUND" }, 404);
      if (["canceled", "cancelled"].includes(invoice.status)) {
        return json({ error: "Una factura anulada no se puede enviar", code: "DOCUMENT_CANCELED" }, 409);
      }
      if (invoice.tipo_comprobante != null && !invoice.cae) {
        return json({ error: "Autorizá este comprobante en ARCA antes de enviarlo", code: "INVOICE_NOT_AUTHORIZED" }, 409);
      }
      const { data: items, error: itemsError } = await admin.from("invoice_items")
        .select("description, quantity, total").eq("invoice_id", documentId).order("id");
      if (itemsError) throw itemsError;
      const isCredit = [3, 8, 13].includes(Number(invoice.tipo_comprobante));
      document = {
        kind: "invoice",
        title: isCredit ? "Nota de crédito" : invoice.cae ? "Factura" : "Comprobante comercial",
        number: invoice.number,
        customerName: invoice.customer_name,
        recipient: String(invoice.customer_email ?? "").trim().toLowerCase(),
        total: Number(invoice.total),
        currency: invoice.currency === "USD" ? "USD" : "ARS",
        dueDate: invoice.due_date,
        notes: invoice.notes,
        lines: (items ?? []).map((item) => ({ description: item.description, quantity: Number(item.quantity), total: Number(item.total) })),
        fiscalNotice: invoice.cae ? `CAE ${invoice.cae}` : "Documento comercial, no válido como factura fiscal.",
      };
    } else if (documentType === "quote") {
      const { data: quote, error } = await admin.from("quotes")
        .select("quote_number, customer_name, customer_email, total, valid_until, notes, items, status")
        .eq("org_id", orgId).eq("id", documentId).maybeSingle();
      if (error) throw error;
      if (!quote) return json({ error: "No encontramos el presupuesto", code: "DOCUMENT_NOT_FOUND" }, 404);
      if (["rejected", "expired", "canceled"].includes(quote.status)) {
        return json({ error: "Este presupuesto ya no está vigente", code: "DOCUMENT_CANCELED" }, 409);
      }
      const rows = Array.isArray(quote.items) ? quote.items : [];
      document = {
        kind: "quote",
        title: "Presupuesto",
        number: quote.quote_number,
        customerName: quote.customer_name,
        recipient: String(quote.customer_email ?? "").trim().toLowerCase(),
        total: Number(quote.total),
        currency: "ARS",
        dueDate: quote.valid_until,
        notes: quote.notes,
        lines: rows.filter((item: unknown) => item !== null && typeof item === "object")
          .map((item: object) => {
            const row = item as Record<string, unknown>;
            return {
              description: String(row.description ?? "Producto"),
              quantity: Number(row.qty ?? 1),
              total: Number(row.total ?? 0),
            };
          }),
        fiscalNotice: "Presupuesto sujeto a aceptación. No es una factura ni acredita un pago.",
      };
    } else {
      const recipient = String(to ?? "").trim().toLowerCase();
      if (recipient.length > 320 || !EMAIL.test(recipient)) {
        return json({ error: "Ingresá un correo válido para el recibo", code: "INVALID_RECIPIENT" }, 400);
      }
      const { data: transaction, error: txError } = await admin.from("sale_transactions")
        .select("id, source").eq("org_id", orgId).eq("id", documentId).maybeSingle();
      if (txError) throw txError;
      if (!transaction || transaction.source !== "pos") {
        return json({ error: "No encontramos el ticket sincronizado", code: "DOCUMENT_NOT_FOUND" }, 404);
      }
      const { data: sales, error: salesError } = await admin.from("sales")
        .select("product_name, quantity, total_ars, customer_name, paid")
        .eq("org_id", orgId).eq("sale_transaction_id", documentId).order("id");
      if (salesError) throw salesError;
      if (!sales?.length) return json({ error: "El ticket todavía no tiene renglones confirmados", code: "SALE_NOT_READY" }, 409);
      if (sales.some((sale) => !sale.paid)) {
        return json({ error: "El cobro todavía no está confirmado. No podemos enviar un recibo de pago", code: "PAYMENT_NOT_CONFIRMED" }, 409);
      }
      document = {
        kind: "pos_receipt",
        title: "Recibo de venta",
        number: `POS-${transaction.id.slice(0, 8).toUpperCase()}`,
        customerName: sales[0].customer_name || "cliente",
        recipient,
        total: sales.reduce((sum, sale) => sum + Number(sale.total_ars), 0),
        currency: "ARS",
        dueDate: null,
        notes: null,
        lines: sales.map((sale) => ({ description: sale.product_name, quantity: Number(sale.quantity), total: Number(sale.total_ars) })),
        fiscalNotice: "Recibo comercial de pago. La factura fiscal, si corresponde, se emite por separado.",
      };
    }

    if (!EMAIL.test(document.recipient) || document.recipient.length > 320) {
      return json({ error: "El comprobante no tiene un correo de cliente válido", code: "DOCUMENT_EMAIL_MISSING" }, 409);
    }
    if (!Number.isFinite(document.total) || document.total < 0 ||
      document.lines.some((line) => !Number.isFinite(line.total) || !Number.isFinite(line.quantity))) {
      return json({ error: "El comprobante tiene importes inválidos", code: "DOCUMENT_AMOUNT_INVALID" }, 409);
    }

    const money = (amount: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: document.currency }).format(amount);
    const dueDate = document.dueDate ? new Date(`${document.dueDate}T12:00:00Z`).toLocaleDateString("es-AR", { timeZone: "UTC" }) : null;
    const rows = document.lines.map((line) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">${esc(line.description)} × ${esc(line.quantity)}</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right">${esc(money(line.total))}</td></tr>`).join("");
    const html = `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f5f7fa;color:#18212d;margin:0;padding:24px">
<div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e5e7eb;padding:28px">
<h1 style="font-size:20px;margin:0 0 8px">${esc(org.name)}</h1><p style="color:#475569;margin:0 0 24px">${esc(document.title)} ${esc(document.number)}</p>
<p>Hola ${esc(document.customerName)}, compartimos el detalle de tu ${esc(document.title.toLowerCase())}.</p>
${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` : ""}
<p style="font-size:18px;font-weight:700;text-align:right">Total: ${esc(money(document.total))}</p>
${dueDate ? `<p>Vencimiento: ${esc(dueDate)}</p>` : ""}
${document.notes ? `<p style="white-space:pre-wrap">${esc(document.notes.slice(0, 2000))}</p>` : ""}
<p style="font-size:12px;color:#475569;border-top:1px solid #e5e7eb;padding-top:16px">${esc(document.fiscalNotice)}</p>
</div></body></html>`;
    const smtpCfg = await smtpDeOrganizacion(orgId);
    const resendFrom = (await remitenteDe("facturas")).from;
    const result = await sendEmail(
      smtpCfg,
      Deno.env.get("RESEND_API_KEY") ?? "",
      resendFrom,
      { to: document.recipient, subject: `${document.title} ${document.number} - ${org.name}`, html },
      { org_id: orgId, document_number: document.number, message_type: "transactional" },
    );
    if (!result.ok) return json(emailFailure(result, "merchant", "send-invoice-email"), 502);

    console.log(`send-invoice-email: kind=${document.kind} document=${documentId} provider=${result.provider}`);
    return json({ success: true });
  } catch (err) {
    console.error("send-invoice-email error:", err);
    return json({ error: "No se pudo enviar el comprobante. Intentá de nuevo o contactá a soporte", code: "DOCUMENT_EMAIL_FAILED" }, 500);
  }
});
