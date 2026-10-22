/**
 * La operación completa de una venta: presupuesto, entrega, factura y cobro,
 * con un enlace a cada documento. Ver `src/lib/documentosDeVenta.ts`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, CircleDot, HelpCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { leerDocumentosDeVenta, pasosDeOperacion, type DocumentosDeVenta, type EstadoDePaso } from "@/lib/documentosDeVenta";
import { numeroDeRemito, ESTADOS_REMITO, type LineaVendida } from "@/lib/remitos";

const ars = (n: number) => n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
const dia = (iso: string) => fechaFiscalArgentina(iso.slice(0, 10));

const ICONO: Record<EstadoDePaso, { Icono: typeof Circle; clase: string; texto: string }> = {
  hecho: { Icono: CheckCircle2, clase: "text-emerald-600 dark:text-emerald-400", texto: "Listo" },
  parcial: { Icono: CircleDot, clase: "text-amber-600 dark:text-amber-400", texto: "A medias" },
  pendiente: { Icono: Circle, clase: "text-muted-foreground", texto: "Pendiente" },
  no_aplica: { Icono: CircleDashed, clase: "text-muted-foreground", texto: "No aplica" },
  desconocido: { Icono: HelpCircle, clase: "text-muted-foreground", texto: "Sin datos" },
};

export default function DocumentosDeLaVenta({ orgId, saleIds, saleTransactionId, lineas, total, version = 0 }: {
  orgId: string | null | undefined;
  /** Sube cuando otro diálogo de la ficha emitió un documento: se vuelve a leer. */
  version?: number;
  saleIds: string[];
  saleTransactionId: string | null;
  lineas: LineaVendida[];
  total: number;
}) {
  const [docs, setDocs] = useState<DocumentosDeVenta | null>(null);
  const [cargando, setCargando] = useState(true);
  const clave = saleIds.join(",");

  const leer = useCallback(async (vivo: { ok: boolean }) => {
    if (!orgId || !clave) return;
    setCargando(true);
    const d = await leerDocumentosDeVenta(orgId, { saleIds: clave.split(","), saleTransactionId });
    if (!vivo.ok) return;
    setDocs(d);
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, clave, saleTransactionId, version]);

  useEffect(() => {
    const vivo = { ok: true };
    void leer(vivo);
    return () => { vivo.ok = false; };
  }, [leer]);

  const pasos = useMemo(() => (docs ? pasosDeOperacion(docs, lineas, total) : []), [docs, lineas, total]);

  return (
    <section aria-labelledby="ticket-operacion-title" data-testid="documentos-de-la-venta">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="ticket-operacion-title" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Operación completa</h3>
        {docs && !cargando && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label="Actualizar la operación" onClick={() => void leer({ ok: true })}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {cargando && !docs ? (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-border/60 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Buscando presupuesto, remitos, facturas y cobros…</p>
      ) : docs && (
        <div className="space-y-3">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {pasos.map(p => {
              const { Icono, clase, texto } = ICONO[p.estado];
              return (
                <li key={p.id} className="rounded-lg border border-border/60 bg-card p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icono className={`h-4 w-4 shrink-0 ${clase}`} aria-hidden />{p.titulo}
                    <span className="sr-only">: {texto}</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{p.detalle}</p>
                </li>
              );
            })}
          </ol>

          {docs.faltantes.length > 0 && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">No se pudo leer {docs.faltantes.join(", ")}. Lo demás está al día.</span>
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => void leer({ ok: true })}>Reintentar</button>
            </p>
          )}

          <ul className="divide-y divide-border/50 rounded-lg border border-border/60 text-sm">
            {docs.presupuesto && (
              <Fila etiqueta="Presupuesto" valor={`N.º ${docs.presupuesto.numero}`} extra={`${dia(docs.presupuesto.fecha)} · ${ars(docs.presupuesto.total)}`}
                a={`/presupuestos?presupuesto=${docs.presupuesto.id}`} />
            )}
            {(docs.remitos ?? []).map(r => (
              <Fila key={r.id} etiqueta={`Remito ${r.letra}`} valor={numeroDeRemito(r.punto_venta, r.numero)} tachado={r.estado === "anulado"}
                extra={`${dia(r.fecha)} · ${ESTADOS_REMITO[r.estado].label}`} a={`/remitos?remito=${r.id}`} />
            ))}
            {(docs.facturas ?? []).map(f => (
              <Fila key={f.id} etiqueta={f.titulo} valor={f.numero} extra={`${f.fecha ? dia(f.fecha) : ""} · ${ars(f.total)} · ${f.autorizada ? "con CAE" : f.rechazada ? "rechazada" : "sin CAE"}`}
                a={`/facturas?invoice=${f.id}`} />
            ))}
            {(docs.cuenta?.pagos ?? []).map((p, i) => (
              <Fila key={`pago-${i}`} etiqueta="Cobro" valor={ars(p.monto)} extra={`${dia(p.fecha)} · ${p.medio}`} a="/deudas" />
            ))}
            {(docs.devoluciones ?? []).map((d, i) => (
              <Fila key={`dev-${i}`} etiqueta="Devolución" valor={`${d.cantidad} u. · ${ars(d.monto)}`} extra={dia(d.fecha)} a="/devoluciones" />
            ))}
            {!docs.presupuesto && !(docs.remitos ?? []).length && !(docs.facturas ?? []).length && !(docs.cuenta?.pagos ?? []).length && !(docs.devoluciones ?? []).length && (
              <li className="p-3 text-xs text-muted-foreground">Venta de mostrador: sin presupuesto, remito, factura ni cuenta corriente.</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}

function Fila({ etiqueta, valor, extra, a, tachado = false }: { etiqueta: string; valor: string; extra: string; a: string; tachado?: boolean }) {
  return (
    <li>
      <Link to={a} className="flex items-baseline gap-3 px-3 py-2 transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none">
        <span className="w-32 shrink-0 text-xs text-muted-foreground">{etiqueta}</span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-mono text-[13px] ${tachado ? "line-through text-muted-foreground" : ""}`}>{valor}</span>
          <span className="block truncate text-xs text-muted-foreground sm:hidden">{extra}</span>
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{extra}</span>
      </Link>
    </li>
  );
}
