import { supabase } from "@/integrations/supabase/client";

export interface PosReceiptSnapshot {
  id: string;
  date: string;
  businessName: string;
  customer: string;
  paid: boolean;
  lines: Array<{ name: string; quantity: number; total: number; method: string }>;
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);
const money = (value: number) => new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", minimumFractionDigits: 2,
}).format(value);
const methodLabel = (value: string) => ({ efectivo: "Efectivo", transferencia: "Transferencia",
  debito: "Débito", credito: "Crédito", qr: "QR Mercado Pago", mayorista: "Mayorista",
  fiado: "Cuenta corriente" } as Record<string, string>)[value] || value;

export function posReceiptHtml(receipt: PosReceiptSnapshot): string {
  if (!receipt.id || !receipt.lines.length || !Number.isFinite(new Date(receipt.date).getTime())
    || receipt.lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0
      || !Number.isFinite(line.total) || line.total < 0)) {
    throw new Error("El ticket guardado tiene datos incompletos. Revisá la venta antes de imprimir.");
  }
  const totalCents = receipt.lines.reduce((sum, line) => sum + Math.round(line.total * 100), 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error("No se pudo verificar el total del ticket.");
  const total = totalCents / 100;
  const methods = [...new Set(receipt.lines.map((line) => methodLabel(line.method)))].join(" / ");
  const date = new Date(receipt.date).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket POS</title>
    <style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0;color:#000;background:#fff;font:12px monospace}h1{font-size:16px}h1,p{text-align:center;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}td{padding:4px 0;overflow-wrap:anywhere}td:first-child{width:52%}td:nth-child(2){width:14%;text-align:center}td:last-child{width:34%;text-align:right}.total{border-top:1px dashed;font-weight:bold;font-size:15px}.notice{font-size:10px}</style></head><body>
    <h1>${escape(receipt.businessName)}</h1><p>RECIBO COMERCIAL</p><p>${escape(date)}</p>
    <p class="notice">POS-${escape(receipt.id)}</p>
    ${receipt.customer ? `<p>Cliente: ${escape(receipt.customer)}</p>` : ""}
    <table><tbody>${receipt.lines.map((line) => `<tr><td>${escape(line.name)}</td><td>${line.quantity}</td><td>${money(line.total)}</td></tr>`).join("")}
    <tr class="total"><td colspan="2">TOTAL</td><td>${money(total)}</td></tr></tbody></table>
    <p>${receipt.paid ? "COBRO REGISTRADO" : "PAGO PENDIENTE O PARCIAL"}</p><p>${escape(methods)}</p>
    <p class="notice">Importes finales con los descuentos registrados en la venta.</p>
    <p class="notice">No es un comprobante fiscal. La factura ARCA se emite por separado.</p>
    <p>¡Gracias por tu compra!</p></body></html>`;
}

/** Isolated document, no popup dependency or remote content. Opens OS dialog. */
export async function printReceiptHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Impresión de ticket";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    Object.assign(frame.style, { position: "fixed", left: "-10000px", width: "320px", height: "1px", border: "0" });
    let started = false;
    let cleanupTimer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(cleanupTimer); frame.remove(); };
    const loadTimer = setTimeout(() => {
      if (!started) { cleanup(); reject(new Error("La impresión no respondió. Podés reintentar sin repetir la venta.")); }
    }, 10_000);
    frame.onload = () => {
      if (started) return;
      started = true;
      clearTimeout(loadTimer);
      const target = frame.contentWindow;
      if (!target) { cleanup(); reject(new Error("No se pudo abrir la impresión. El cobro sigue registrado.")); return; }
      target.addEventListener("afterprint", cleanup, { once: true });
      cleanupTimer = setTimeout(cleanup, 60_000);
      try { target.focus(); target.print(); resolve(); }
      catch (cause) {
        cleanup();
        console.error("[POS] print dialog failed:", cause);
        reject(new Error("No se pudo abrir la impresión. Revisá la impresora y reintentá; no vuelvas a cobrar."));
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export async function loadPosReceipt(orgId: string, transactionId: string, businessName: string): Promise<PosReceiptSnapshot> {
  const { data: transaction, error: transactionError } = await supabase.from("sale_transactions")
    .select("id, occurred_at, source").eq("org_id", orgId).eq("id", transactionId).maybeSingle();
  if (transactionError || !transaction || transaction.source !== "pos") {
    console.error("[POS] receipt transaction lookup:", transactionError);
    throw new Error("No se pudo consultar el ticket guardado. Revisá tus permisos o reintentá con conexión.");
  }
  const { data: lines, error: linesError } = await supabase.from("sales")
    .select("product_name, quantity, total_ars, customer_name, paid, payment_method")
    .eq("org_id", orgId).eq("sale_transaction_id", transactionId).order("id").limit(501);
  if (linesError || !lines?.length || lines.length > 500) {
    console.error("[POS] receipt lines lookup:", linesError);
    throw new Error("No se pudo cargar el ticket completo. No se imprimió un recibo parcial.");
  }
  return {
    id: transaction.id, date: transaction.occurred_at, businessName,
    customer: lines[0].customer_name || "", paid: lines.every((line) => line.paid === true),
    lines: lines.map((line) => ({ name: line.product_name, quantity: Number(line.quantity),
      total: line.total_ars == null ? Number.NaN : Number(line.total_ars), method: line.payment_method || "Medio no informado" })),
  };
}

const pending = new Map<string, Promise<void>>();
export function printPosReceiptById(orgId: string, transactionId: string, businessName: string, requirePaid = false): Promise<void> {
  const key = `${orgId}:${transactionId}:${requirePaid}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    const receipt = await loadPosReceipt(orgId, transactionId, businessName);
    if (requirePaid && !receipt.paid) throw new Error("El ticket no tiene el cobro completo registrado. No se imprimió automáticamente.");
    await printReceiptHtml(posReceiptHtml(receipt));
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

export const posAutoPrintKey = (orgId: string, userId: string) => `nerqia:pos:auto-print:v1:${orgId}:${userId}`;
