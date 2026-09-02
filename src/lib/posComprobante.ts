/**
 * El POS cobra un ticket. La factura de ARCA es un paso aparte, y el papel
 * de 80 mm no es un comprobante fiscal.
 *
 * Tres trampas que este recorte cierra:
 * 1. El mostrador no tenía camino a ARCA. Ventas/Clientes sí, con
 *    `/facturas?from_sale=`. Quien cobra en caja tenía que salir del POS.
 * 2. El botón decía «Imprimir» y el HTML ya era 80 mm. Parecía que faltaba
 *    un driver de térmica, y no: sale por el diálogo del sistema.
 * 3. Una controladora fiscal (Hasar/Epson/Moretti) es **otro régimen**, no
 *    WSFE/CAE. Sin hardware homologado no se finge.
 *
 * La factura es opt-in y default off: la primera venta de un comercio nuevo
 * no puede trabarse en AFIP. Facturar no puede hacer fallar el cobro.
 */

export const POS_WANTS_ARCA_INVOICE_DEFAULT = false;

export type PosFacturaEstado = {
  ok?: boolean;
  invoiceId?: string;
  number?: string;
  tipo?: string;
  already?: boolean;
  autorizar?: boolean;
  cae?: string;
  afipStatus?: string;
  motivo?: string;
};

export function posSaleTransactionId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const id = (result as { transaction_id?: unknown }).transaction_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function posParseFacturarResult(data: unknown): PosFacturaEstado {
  if (!data || typeof data !== 'object') {
    return { ok: false, motivo: 'La base no devolvió el comprobante' };
  }
  const d = data as Record<string, unknown>;
  const invoiceId = typeof d.invoice_id === 'string' ? d.invoice_id : undefined;
  const number = typeof d.number === 'string' ? d.number : undefined;
  const tipo = typeof d.tipo === 'string' ? d.tipo : undefined;
  const motivo = typeof d.motivo === 'string' ? d.motivo : undefined;
  const ok = d.ok === true || (d.ok !== false && !!invoiceId);
  return {
    ok,
    invoiceId,
    number,
    tipo,
    already: d.already === true,
    autorizar: d.autorizar !== false,
    motivo,
  };
}

export function posDebeIntentarAutorizar(estado: PosFacturaEstado): boolean {
  return estado.ok === true && !!estado.invoiceId && estado.autorizar !== false;
}

export function posArcaInvoiceCopy() {
  return {
    checkboxLabel: 'También facturar en ARCA',
    hint: 'El ticket se cobra igual. La factura pide conexión con ARCA y no reemplaza el ticket.',
    receiptAction: 'Facturar en ARCA',
    authorizing: 'Autorizando en ARCA…',
    authorized: 'Factura autorizada',
    draft: 'Comprobante creado. Falta el CAE de ARCA.',
    missingIdentity: 'Para facturar hay que declarar la condición frente al IVA en AFIP.',
    offline: 'La factura en ARCA necesita conexión. El ticket se guarda igual.',
    notFiscalTicket: 'Este ticket no es un comprobante fiscal. La factura de ARCA es un paso aparte.',
    noTransaction: 'El ticket todavía no tiene id de transacción. Reintentá con conexión.',
  };
}

export function posReceiptInvoiceCopy(estado: PosFacturaEstado | null | undefined) {
  const copy = posArcaInvoiceCopy();
  if (!estado) return null;
  if (estado.cae) {
    return {
      tone: 'ok' as const,
      title: copy.authorized,
      detail: estado.number
        ? `${estado.number} · CAE ${estado.cae}`
        : `CAE ${estado.cae}`,
    };
  }
  if (estado.ok && estado.invoiceId) {
    return {
      tone: 'draft' as const,
      title: copy.draft,
      detail: [estado.number, estado.motivo].filter(Boolean).join(' · ') || undefined,
    };
  }
  if (estado.motivo) {
    return { tone: 'warn' as const, title: estado.motivo, detail: undefined };
  }
  return null;
}

export function posThermalPrintCopy() {
  return {
    label: 'Ticket 80 mm',
    hint: 'Sale por el diálogo de impresión del sistema. Si hay una térmica instalada, elegila ahí.',
  };
}

export function posFiscalControllerPolicy() {
  return {
    built: false as const,
    reason:
      'Gestiona emite por web service de ARCA (CAE). Una controladora fiscal es otro régimen y otro hardware; no se simula.',
  };
}
