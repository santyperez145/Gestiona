import type { SaleTicketDetail } from "@/lib/saleTicketDetail";

export function escapePrintHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const money = (value: number) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
}).format(value);

export function buildSaleReceiptHtml(detail: SaleTicketDetail, businessName: string): string {
  const rows = detail.lines.map((line) => `
    <tr>
      <td>${escapePrintHtml(line.product_name || "Producto")}</td>
      <td class="qty">${Number(line.quantity || 0)}</td>
      <td class="amount">${escapePrintHtml(money(Number(line.total_ars || 0)))}</td>
    </tr>`).join("");
  const payment = detail.paymentMethods.length
    ? detail.paymentMethods.map(escapePrintHtml).join(" + ")
    : "Sin medio declarado";

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket ${escapePrintHtml(detail.code)}</title>
  <style>
    @page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0;color:#111;font:11px/1.35 Arial,sans-serif}
    h1,p{margin:0}.brand{text-align:center;font-size:16px;font-weight:700}.meta{text-align:center;color:#555;margin-top:2px}
    .rule{border-top:1px dashed #777;margin:7px 0}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}
    td:first-child{padding-right:4px}.qty{width:10mm;text-align:center}.amount{width:24mm;text-align:right;font-variant-numeric:tabular-nums}
    .row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.total{font-size:14px;font-weight:700}
    .notice{margin-top:9px;padding-top:7px;border-top:1px dashed #777;text-align:center;font-size:9px;font-weight:700}
  </style></head><body>
    <h1 class="brand">${escapePrintHtml(businessName)}</h1>
    <p class="meta">Ticket #${escapePrintHtml(detail.code)}</p>
    <p class="meta">${escapePrintHtml(detail.date ? new Date(detail.date).toLocaleString("es-AR") : "Fecha no disponible")}</p>
    ${detail.customerName ? `<p class="meta">Cliente: ${escapePrintHtml(detail.customerName)}</p>` : ""}
    <div class="rule"></div><table><tbody>${rows}</tbody></table><div class="rule"></div>
    <div class="row total"><span>Total</span><span>${escapePrintHtml(money(detail.totalArs))}</span></div>
    <div class="row"><span>Pago</span><span>${payment}</span></div>
    <div class="row"><span>Estado</span><span>${detail.allPaid ? "Cobrado" : detail.partiallyPaid ? "Cobro parcial" : "Pendiente"}</span></div>
    <p class="notice">RECIBO COMERCIAL NO FISCAL<br>La factura electrónica se emite por separado.</p>
  </body></html>`;
}

export function printSaleReceipt(detail: SaleTicketDetail, businessName: string): void {
  const popup = window.open("", "_blank", "width=420,height=680");
  if (!popup) throw new Error("Permití las ventanas emergentes para imprimir el ticket.");
  popup.document.write(buildSaleReceiptHtml(detail, businessName));
  popup.document.close();
  popup.focus();
  popup.addEventListener("afterprint", () => popup.close(), { once: true });
  window.setTimeout(() => popup.print(), 150);
}
