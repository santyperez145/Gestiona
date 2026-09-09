import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenCheck, Building2, FileClock, FileStack, Landmark, Loader2, ReceiptText, ShoppingCart, Wallet, ArrowUpRight, Target } from 'lucide-react';
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
  const currentBudgetPeriod = useMemo(() => {
    const now = new Date();
    return {
      key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      label: now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
    };
  }, []);
  const budgetExecution = snapshot && snapshot.monthlyBudgetArs > 0
    ? Math.min(100, (snapshot.monthlyExpenseArs / snapshot.monthlyBudgetArs) * 100)
    : 0;

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
        console.error('FinanceOverview / resumen:', cause);
        setError('No pudimos actualizar el resumen financiero. Reintentá en unos segundos.');
      },
    );
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ReceiptText}
        eyebrow="Finance · Control de gasto"
        title="Resumen"
        description={`Gastos, documentos, conciliación y resultados para ${activeOrg?.name || 'tu organización'}, en una sola superficie financiera.`}
        actions={(
          <Button asChild className="bg-teal-700 text-white hover:bg-teal-800">
            <Link to="/finance/documentos"><FileStack className="h-3.5 w-3.5" />Ver bandeja</Link>
          </Button>
        )}
      />

      <section className="finance-overview-hero border border-border bg-card p-5 sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Operación conectada</p>
        <h2 className="mt-2 max-w-xl text-xl font-bold tracking-tight sm:text-2xl">Documentos que terminan en datos revisables</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Cada comprobante se vincula con proveedor, compra, obligación y movimiento contable.
          Gastos, banco y contabilidad se operan dentro de Finance. Compras y proveedores conservan su fuente en el Core operativo.
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
              cause => {
                console.error('FinanceOverview / reintento:', cause);
                setError('No pudimos actualizar el resumen financiero. Reintentá en unos segundos.');
              },
            );
          }}
        />
      ) : !snapshot ? (
        <div className="flex items-center justify-center py-14 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Actualizando indicadores...</div>
      ) : (
        <div className="finance-metric-ledger grid grid-cols-2 gap-px overflow-hidden border border-border bg-border lg:grid-cols-6">
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

      {snapshot && (
        <section className="border border-border bg-card" aria-labelledby="finance-budget-pulse-title">
          <div className="flex flex-col justify-between gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-teal-700 text-white">
                <Target className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Budget Pulse</p>
                <h2 id="finance-budget-pulse-title" className="mt-0.5 text-sm font-semibold capitalize">{currentBudgetPeriod.label}</h2>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={`/finance/gastos?vista=presupuesto&periodo=${currentBudgetPeriod.key}`}>
                Abrir presupuesto <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="grid divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            {[
              ['Asignado', formatArs(snapshot.monthlyBudgetArs)],
              ['Ejecutado', formatArs(snapshot.monthlyExpenseArs)],
              ['Disponible', formatArs(snapshot.monthlyBudgetAvailableArs)],
              ['Categorías excedidas', snapshot.overBudgetCategories.toLocaleString('es-AR')],
            ].map(([label, value], index) => (
              <div key={label} className="p-4 sm:px-5">
                <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
                <p className={`mt-1 truncate font-mono text-base font-semibold ${
                  (index === 2 && snapshot.monthlyBudgetAvailableArs < 0)
                    || (index === 3 && snapshot.overBudgetCategories > 0)
                    ? 'text-destructive'
                    : ''
                }`}>{value}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Ejecución del plan</span>
              <span className="font-mono">{snapshot.monthlyBudgetArs > 0 ? `${budgetExecution.toFixed(0)}%` : 'Sin plan asignado'}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden bg-muted">
              <div
                className={`h-full transition-[width] duration-300 ${snapshot.monthlyExpenseArs > snapshot.monthlyBudgetArs && snapshot.monthlyBudgetArs > 0 ? 'bg-destructive' : 'bg-teal-600'}`}
                style={{ width: `${budgetExecution}%` }}
              />
            </div>
          </div>
        </section>
      )}

      <section className="border border-border bg-card p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:text-teal-300">Foco</p>
        <h2 className="mt-1 text-sm font-semibold">Hasta cinco movimientos con evidencia</h2>
        <p className="mt-1 text-xs text-muted-foreground">Solo prioridades accionables. Cada ítem abre la cola exacta.</p>
        {foco.length > 0 ? (
          <ol className="mt-4 divide-y divide-border border border-border">
            {foco.map((item, i) => (
              <li key={`${item.to}-${item.label}`}>
                <Link
                  to={item.to}
                  className="flex items-start gap-3 bg-background px-3 py-2.5 hover:bg-teal-500/[0.05]"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center bg-teal-700 text-[10px] font-bold text-white">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : snapshot ? (
          <p className="mt-4 border border-border bg-muted/10 px-3 py-3 text-xs text-muted-foreground">
            Nada urgente ahora. Cuando llegue un documento o una obligación, aparece acá.
          </p>
        ) : null}
      </section>

      <section className="border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-600 dark:text-teal-300">Operación central · sin duplicar</p>
            <h2 className="mt-1 text-sm font-semibold">Un recorrido financiero, una sola fuente por proceso</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Finance concentra gasto, conciliación, liquidez y contabilidad. Compras y proveedores
              siguen conectados al inventario para no partir la operación en dos.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            to="/finance/gastos"
            className="group flex items-start gap-3 border border-border bg-background p-3 hover:border-teal-700/35 hover:bg-teal-500/[0.04]"
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
            className="group flex items-start gap-3 border border-border bg-background p-3 hover:border-teal-700/35 hover:bg-teal-500/[0.04]"
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
            to="/finance/libro"
            className="group flex items-start gap-3 border border-border bg-background p-3 hover:border-teal-700/35 hover:bg-teal-500/[0.04]"
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
            to="/finance/banco"
            className="group flex items-start gap-3 border border-border bg-background p-3 hover:border-teal-700/35 hover:bg-teal-500/[0.04]"
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
        <section className="border border-border bg-card p-5">
          <div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-teal-700 dark:text-teal-300" /><h2 className="text-sm font-semibold">Flujo de trabajo</h2></div>
          <div className="mt-4 space-y-2">
            {[
              ['1', 'Ingresar', 'Archivo privado y original inmutable.'],
              ['2', 'Extraer', 'Campos con confianza y proveedor intercambiable.'],
              ['3', 'Validar', 'CUIT, importes, impuestos, duplicados y esquema.'],
              ['4', 'Aprobar', 'Una persona confirma antes de crear compra u obligación.'],
            ].map(([step, title, detail]) => (
              <div key={step} className="flex gap-3 border border-border bg-background p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-teal-700 text-[10px] font-bold text-white">{step}</span>
                <div><p className="text-xs font-medium">{title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="border border-border bg-card p-5">
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
  const className = `bg-card p-3.5 ${
    wide ? 'col-span-2 lg:col-span-2' : ''
  } ${
    attention ? 'shadow-[inset_0_2px_0_0_hsl(38_92%_50%)]' : ''
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
