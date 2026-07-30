import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, Lightbulb, ArrowRight } from 'lucide-react';
import type { StoreReadiness, ReadinessCheck } from '@/lib/storeReadiness';
import { readinessSummary } from '@/lib/storeReadiness';

/**
 * Qué le falta a la tienda para vender.
 *
 * Ordena por lo que duele: primero lo que impide comprar, después lo que sale
 * mal cobrado, al final lo que sólo se ve mejor. Cada ítem dice qué le pasa al
 * comprador si no se resuelve, no sólo qué campo está vacío.
 */

const STYLE: Record<string, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  blocker:    { icon: XCircle,       cls: 'text-destructive',  label: 'Impide vender' },
  warning:    { icon: AlertTriangle, cls: 'text-yellow-500',   label: 'Conviene resolver' },
  suggestion: { icon: Lightbulb,     cls: 'text-blue-400',     label: 'Mejora' },
};

const ORDEN = { blocker: 0, warning: 1, suggestion: 2 } as const;

export default function StoreReadinessPanel({ readiness }: { readiness: StoreReadiness }) {
  const pendientes = readiness.checks
    .filter(c => !c.done)
    .sort((a, b) => ORDEN[a.severity] - ORDEN[b.severity]);

  const listos = readiness.checks.filter(c => c.done);

  const barColor = readiness.blockers.length > 0
    ? 'bg-destructive'
    : readiness.warnings.length > 0
      ? 'bg-yellow-500'
      : 'bg-emerald-500';

  return (
    <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">Estado de tu tienda</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{readinessSummary(readiness)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold font-mono">{readiness.score}%</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {listos.length}/{readiness.checks.length} listo
          </p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${readiness.score}%` }} />
      </div>

      {pendientes.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Tu tienda está lista para recibir pedidos.
        </div>
      ) : (
        <div className="space-y-2">
          {pendientes.map(c => <CheckRow key={c.id} check={c} />)}
        </div>
      )}

      {listos.length > 0 && pendientes.length > 0 && (
        <details className="group">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1">
            <span className="group-open:hidden">Ver {listos.length} ya resueltos</span>
            <span className="hidden group-open:inline">Ocultar resueltos</span>
          </summary>
          <div className="mt-2 space-y-1.5">
            {listos.map(c => (
              <div key={c.id} className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70 shrink-0 mt-px" />
                <div className="min-w-0">
                  <span className="text-muted-foreground">{c.title}</span>
                  {c.detail && (
                    <span className="text-muted-foreground/60"> — {c.detail}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  const st = STYLE[check.severity];
  const Icon = st.icon;

  return (
    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/20 border border-border/40">
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${st.cls}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium">{check.title}</p>
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded ${st.cls} bg-current/10`}>
            {st.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{check.detail}</p>
      </div>
      {check.actionHref && (
        <Link
          to={check.actionHref}
          className="text-[11px] font-medium text-primary hover:underline shrink-0 flex items-center gap-0.5 mt-0.5"
        >
          {check.actionLabel ?? 'Resolver'} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
