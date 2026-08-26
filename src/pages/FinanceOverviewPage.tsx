import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenCheck, Building2, FileClock, FileStack, Landmark, Loader2, ReceiptText, ShoppingCart } from 'lucide-react';
import { useOrg } from '@/lib/orgContext';
import { getFinanceCoreSnapshot, type FinanceCoreSnapshot } from '@/lib/financeProductDB';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import CostoDeCobrar from '@/components/finance/CostoDeCobrar';

function formatArs(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
}

export default function FinanceOverviewPage() {
  usePageTitle('Finance');
  const { activeOrg } = useOrg();
  const [snapshot, setSnapshot] = useState<FinanceCoreSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg?.id) return;
    let cancelled = false;
    getFinanceCoreSnapshot(activeOrg.id).then(
      data => { if (!cancelled) { setSnapshot(data); setError(null); } },
      cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudo leer el Business Core.'); },
    );
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ReceiptText}
        eyebrow="Gestiona Finance / Resumen"
        title="Finance"
        description={`Evidencia documental, obligaciones y asientos conectados al mismo Business Core de ${activeOrg?.name || 'la organización'}.`}
        actions={(
          <Button asChild variant="secondary" className="!border-teal-600/20 !bg-teal-600 !text-white shadow-[0_10px_22px_-14px_rgba(13,148,136,.8)] hover:!bg-teal-700">
            <Link to="/finance/documentos"><FileStack className="h-3.5 w-3.5" />Ver bandeja documental</Link>
          </Button>
        )}
      />

      {/* Cuanto le cuesta cobrar: va arriba porque decide precios, y hasta
          hoy el comercio no tenia donde verlo. */}
      <CostoDeCobrar orgId={activeOrg?.id} />

      <section className="rounded-[14px] border border-teal-500/20 bg-gradient-to-br from-teal-500/[0.08] via-card to-card p-5 sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-300">Finance MVP · Business Core compartido</p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">Documentos que terminan en datos revisables</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Finance no crea otra contabilidad: conecta cada comprobante con el proveedor, la compra, la obligación y el asiento.</p>
      </section>

      {error ? (
        <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      ) : !snapshot ? (
        <div className="flex items-center justify-center py-14 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Leyendo el Core compartido...</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Metric icon={Building2} label="Proveedores" value={snapshot.suppliersCount.toLocaleString('es-AR')} />
          <Metric icon={ShoppingCart} label="Órdenes abiertas" value={snapshot.openPurchaseOrders.toLocaleString('es-AR')} />
          <Metric icon={ReceiptText} label="Obligaciones" value={snapshot.openPayablesCount.toLocaleString('es-AR')} />
          <Metric icon={FileClock} label="Saldo pendiente" value={formatArs(snapshot.openPayablesArs)} wide />
          <Metric icon={Landmark} label="Asientos" value={snapshot.ledgerEntriesCount.toLocaleString('es-AR')} />
          <Metric icon={FileStack} label="OCR precursor" value={snapshot.precursorOcrDocuments.toLocaleString('es-AR')} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-[12px] border border-border/70 bg-card p-5">
          <div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-teal-500" /><h2 className="text-sm font-semibold">Contrato del MVP</h2></div>
          <div className="mt-4 space-y-3">
            {[
              ['1', 'Ingresar', 'Archivo privado y original inmutable.'],
              ['2', 'Extraer', 'Campos con confianza y proveedor intercambiable.'],
              ['3', 'Validar', 'CUIT, importes, impuestos, duplicados y esquema.'],
              ['4', 'Aprobar', 'Una persona confirma antes de crear compra u obligación.'],
            ].map(([step, title, detail]) => (
              <div key={step} className="flex gap-3 rounded-[8px] border border-border/50 bg-muted/15 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-[10px] font-bold text-teal-600 dark:text-teal-300">{step}</span>
                <div><p className="text-xs font-medium">{title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[12px] border border-amber-500/20 bg-amber-500/[0.04] p-5">
          <h2 className="text-sm font-semibold">Qué todavía no se promete</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">El OCR existente sólo prellena compras. No tiene cadena de custodia, deduplicación ni aprobación; por eso aparece como precursor y no como documentos procesados.</p>
          <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
            <li>• Ningún archivo mueve stock.</li>
            <li>• Ninguna extracción crea deuda automáticamente.</li>
            <li>• Ninguna confianza se reemplaza por un cero.</li>
            <li>• Ningún proveedor de IA será dependencia crítica.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, wide = false }: { icon: typeof Building2; label: string; value: string; wide?: boolean }) {
  return (
    <article className={`rounded-[10px] border border-border/70 bg-card p-3.5 ${wide ? 'col-span-2 lg:col-span-2' : ''}`}>
      <Icon className="h-3.5 w-3.5 text-teal-500" />
      <p className="mt-3 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums">{value}</p>
    </article>
  );
}
