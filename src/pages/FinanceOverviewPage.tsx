import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenCheck, Building2, FileClock, FileStack, Landmark, Loader2, ReceiptText, ShoppingCart, Wallet, ArrowUpRight } from 'lucide-react';
import { useOrg } from '@/lib/orgContext';
import {
  financeFocoFromSnapshot,
  financeMetricHref,
  getFinanceCoreSnapshot,
  type FinanceCoreSnapshot,
} from '@/lib/financeProductDB';
import { filterFinanceInbox } from '@/lib/financeDocumentInbox';
import { getFinanceDocuments } from '@/lib/financeDocumentUpload';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';

function formatArs(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
}

export default function FinanceOverviewPage() {
  usePageTitle('Finance');
  const { activeOrg } = useOrg();
  const [snapshot, setSnapshot] = useState<FinanceCoreSnapshot | null>(null);
  const [nextReviewDocumentId, setNextReviewDocumentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focoOpts = useMemo(() => ({ nextReviewDocumentId }), [nextReviewDocumentId]);
  const foco = useMemo(
    () => (snapshot ? financeFocoFromSnapshot(snapshot, focoOpts) : []),
    [snapshot, focoOpts],
  );

  useEffect(() => {
    if (!activeOrg?.id) return;
    let cancelled = false;
    getFinanceCoreSnapshot(activeOrg.id).then(
      async (data) => {
        if (cancelled) return;
        setSnapshot(data);
        setError(null);
        if (data.precursorOcrDocuments <= 0) {
          setNextReviewDocumentId(null);
          return;
        }
        try {
          const docs = await getFinanceDocuments(activeOrg.id);
          if (cancelled) return;
          const next = filterFinanceInbox(docs, 'revisar')[0]?.id ?? null;
          setNextReviewDocumentId(next);
        } catch (cause) {
          console.error('FinanceOverview / próximo documento:', cause);
          if (!cancelled) setNextReviewDocumentId(null);
        }
      },
      cause => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'No pudimos cargar el resumen financiero.');
      },
    );
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ReceiptText}
        eyebrow="Finance"
        title="Resumen"
        description={`Pendientes documentales y puentes al Core para ${activeOrg?.name || 'tu organización'}.`}
        actions={(
          <Button asChild variant="secondary" className="!border-teal-600/20 !bg-teal-600 !text-white shadow-[0_10px_22px_-14px_rgba(13,148,136,.8)] hover:!bg-teal-700">
            <Link to="/finance/documentos"><FileStack className="h-3.5 w-3.5" />Ver bandeja</Link>
          </Button>
        )}
      />

      <section className="rounded-[14px] border border-teal-500/20 bg-gradient-to-br from-teal-500/[0.08] via-card to-card p-5 sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-600 dark:text-teal-300">Operación conectada</p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">Documentos que terminan en datos revisables</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Cada comprobante se vincula con proveedor, compra, obligación y movimiento contable.
          Compras y gastos se operan en el Core: acá no se duplican pantallas.
        </p>
      </section>

      {error ? (
        <WorkspaceState
          kind="error-recoverable"
          title="No pudimos cargar el resumen"
          description={error}
          actionLabel="Reintentar"
          onAction={() => {
            if (!activeOrg?.id) return;
            setSnapshot(null);
            setError(null);
            getFinanceCoreSnapshot(activeOrg.id).then(
              data => { setSnapshot(data); setError(null); },
              cause => { setError(cause instanceof Error ? cause.message : 'No pudimos cargar el resumen financiero.'); },
            );
          }}
        />
      ) : !snapshot ? (
        <div className="flex items-center justify-center py-14 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Actualizando indicadores...</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Metric
            icon={Building2}
            label="Proveedores"
            value={snapshot.suppliersCount.toLocaleString('es-AR')}
            href={financeMetricHref('suppliersCount', snapshot)}
          />
          <Metric
            icon={ShoppingCart}
            label="Órdenes abiertas"
            value={snapshot.openPurchaseOrders.toLocaleString('es-AR')}
            href={financeMetricHref('openPurchaseOrders', snapshot)}
            attention={snapshot.openPurchaseOrders > 0}
          />
          <Metric
            icon={ReceiptText}
            label="Obligaciones"
            value={snapshot.openPayablesCount.toLocaleString('es-AR')}
            href={financeMetricHref('openPayablesCount', snapshot)}
            attention={snapshot.openPayablesCount > 0}
          />
          <Metric
            icon={FileClock}
            label="Saldo pendiente"
            value={formatArs(snapshot.openPayablesArs)}
            wide
            href={financeMetricHref('openPayablesArs', snapshot)}
            attention={snapshot.openPayablesArs > 0}
          />
          <Metric
            icon={Landmark}
            label="Asientos"
            value={snapshot.ledgerEntriesCount.toLocaleString('es-AR')}
            href={financeMetricHref('ledgerEntriesCount', snapshot)}
          />
          <Metric
            icon={FileStack}
            label="Documentos por revisar"
            value={snapshot.precursorOcrDocuments.toLocaleString('es-AR')}
            href={financeMetricHref('precursorOcrDocuments', snapshot, focoOpts)}
            attention={snapshot.precursorOcrDocuments > 0}
          />
        </div>
      )}

      <section className="rounded-[12px] border border-teal-500/20 bg-card p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-600 dark:text-teal-300">Foco</p>
        <h2 className="mt-1 text-sm font-semibold">Hasta cinco movimientos con evidencia</h2>
        <p className="mt-1 text-xs text-muted-foreground">Solo prioridades accionables. Cada ítem abre la cola exacta.</p>
        {foco.length > 0 ? (
          <ol className="mt-4 space-y-2">
            {foco.map((item, i) => (
              <li key={`${item.to}-${item.label}`}>
                <Link
                  to={item.to}
                  className="flex items-start gap-3 rounded-[8px] border border-border/60 bg-muted/15 px-3 py-2.5 hover:border-teal-500/30 hover:bg-teal-500/[0.06]"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-[10px] font-bold text-teal-700 dark:text-teal-300">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : snapshot ? (
          <p className="mt-4 rounded-[8px] border border-border/50 bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
            Nada urgente ahora. Cuando llegue un documento o una obligación, aparece acá.
          </p>
        ) : null}
      </section>

      <section className="rounded-[12px] border border-border/70 bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-600 dark:text-teal-300">Operación central · sin duplicar</p>
            <h2 className="mt-1 text-sm font-semibold">Operar gastos y compras donde ya viven</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Finance ordena evidencia y aprobaciones. Compras, gastos, banco y libro
              mantienen su operación principal y acá accedés directo sin repetir pantallas.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            to="/gastos"
            className="group flex items-start gap-3 rounded-[8px] border border-border/60 bg-muted/20 p-3 transition-colors hover:border-teal-500/30 hover:bg-teal-500/[0.06]"
          >
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-xs font-medium">
                Gastos
                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Egresos del negocio</span>
            </span>
          </Link>

          <Link
            to="/ordenes-compra"
            className="group flex items-start gap-3 rounded-[8px] border border-border/60 bg-muted/20 p-3 transition-colors hover:border-teal-500/30 hover:bg-teal-500/[0.06]"
          >
            <ShoppingCart className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-xs font-medium">
                Órdenes de compra
                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Proveedor y recepción</span>
            </span>
          </Link>

          <Link
            to="/libro"
            className="group flex items-start gap-3 rounded-[8px] border border-border/60 bg-muted/20 p-3 transition-colors hover:border-teal-500/30 hover:bg-teal-500/[0.06]"
          >
            <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-xs font-medium">
                Libro mayor
                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Movimientos contables</span>
            </span>
          </Link>

          <Link
            to="/banco"
            className="group flex items-start gap-3 rounded-[8px] border border-border/60 bg-muted/20 p-3 transition-colors hover:border-teal-500/30 hover:bg-teal-500/[0.06]"
          >
            <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-xs font-medium">
                Banco
                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">Conciliación</span>
            </span>
          </Link>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-[12px] border border-border/70 bg-card p-5">
          <div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-teal-500" /><h2 className="text-sm font-semibold">Flujo de trabajo</h2></div>
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
          <h2 className="text-sm font-semibold">Alcance actual</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">La carga asistida hoy ayuda a precompletar compras. La validación final siempre requiere revisión humana antes de impactar la operación.</p>
          <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
            <li>• Cada documento se revisa antes de confirmarse.</li>
            <li>• La información sugerida no reemplaza la validación del equipo.</li>
            <li>• Ningún dato incompleto se guarda como definitivo.</li>
            <li>• La automatización se activa por etapas, con evidencia.</li>
            <li>• Funciones avanzadas se habilitan cuando estén listas para operar.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  wide = false,
  href,
  attention = false,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  wide?: boolean;
  href?: string | null;
  attention?: boolean;
}) {
  const className = `rounded-[10px] border bg-card p-3.5 transition-colors ${
    wide ? 'col-span-2 lg:col-span-2' : ''
  } ${
    attention
      ? 'border-amber-500/35 hover:border-amber-500/50'
      : 'border-border/70 hover:border-teal-500/30'
  } ${href ? 'block hover:bg-teal-500/[0.04]' : ''}`;

  const body = (
    <>
      <Icon className={`h-3.5 w-3.5 ${attention ? 'text-amber-600 dark:text-amber-400' : 'text-teal-500'}`} />
      <p className="mt-3 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums">{value}</p>
    </>
  );

  if (href) {
    return <Link to={href} className={className}>{body}</Link>;
  }
  return <article className={className}>{body}</article>;
}
