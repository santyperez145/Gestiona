import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp,
  Circle, CircleAlert, MonitorSmartphone, Rocket, Store, X,
} from 'lucide-react';
import {
  activationGoalLabel,
  type ActivationGoal,
  type ActivationReadiness,
} from '@/lib/activationReadiness';

interface SetupChecklistProps {
  readiness: ActivationReadiness | null;
  organizationId?: string | null;
  measurementError?: string | null;
  canChangeGoal?: boolean;
  changingGoal?: boolean;
  onGoalChange?: (goal: Exclude<ActivationGoal, 'explore'>) => void;
}

const STORAGE_KEY = 'gestiona.activation.dismissed.v1';

function storageKey(organizationId?: string | null) {
  return `${STORAGE_KEY}.${organizationId || 'default'}`;
}

function isDismissed(organizationId?: string | null): boolean {
  try { return localStorage.getItem(storageKey(organizationId)) === '1'; } catch { return false; }
}

function setDismissed(organizationId?: string | null) {
  try { localStorage.setItem(storageKey(organizationId), '1'); } catch { /* localStorage puede estar bloqueado */ }
}

export default function SetupChecklist({
  readiness,
  organizationId,
  measurementError,
  canChangeGoal = false,
  changingGoal = false,
  onGoalChange,
}: SetupChecklistProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [dismissed, setLocalDismissed] = useState(() => isDismissed(organizationId));

  useEffect(() => {
    setLocalDismissed(isDismissed(organizationId));
    setShowAll(false);
  }, [organizationId]);

  if (dismissed) return null;

  if (!readiness) {
    return (
      <section className="mb-5 rounded-[10px] border border-amber-500/25 bg-card p-4 shadow-card" aria-label="Ruta a la primera venta">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">No pudimos medir la activación</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {measurementError || 'La ruta queda sin estado hasta poder leer las señales del negocio; no asumimos que está lista.'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const visibleItems = showAll
    ? readiness.milestones
    : readiness.milestones.filter(item => !item.done).slice(0, 4);
  const nextItem = readiness.next;
  const goalLabel = activationGoalLabel(readiness.selectedGoal);

  return (
    <section className="mb-5 overflow-hidden rounded-[10px] border border-primary/20 bg-card shadow-card" aria-label="Ruta a la primera venta">
      <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${readiness.complete ? 'bg-emerald-500/10' : 'bg-primary/10'}`}>
          {readiness.complete
            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            : <Rocket className="h-4 w-4 text-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Ruta a la primera venta</h3>
            <span className="rounded-[4px] bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              {readiness.doneCount}/{readiness.total}
            </span>
            <span className="rounded-[4px] border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {goalLabel}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-500 ${readiness.complete ? 'bg-emerald-500' : 'bg-primary'}`}
              style={{ width: `${readiness.progress}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={collapsed ? 'Mostrar ruta de activación' : 'Ocultar ruta de activación'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(value => !value)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Cerrar ruta de activación"
            onClick={() => { setLocalDismissed(true); setDismissed(organizationId); }}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Cerrar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className="border-b border-border/50 px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Canal de entrada</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  La tienda es la puerta; POS comparte el mismo stock y los mismos clientes.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!canChangeGoal || changingGoal}
                  onClick={() => onGoalChange?.('online')}
                  className={`flex items-center justify-center gap-1.5 rounded-[7px] border px-3 py-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${readiness.selectedGoal === 'online' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/60 hover:bg-muted/30'}`}
                >
                  <Store className="h-3.5 w-3.5" /> Tienda
                </button>
                <button
                  type="button"
                  disabled={!canChangeGoal || changingGoal}
                  onClick={() => onGoalChange?.('pos')}
                  className={`flex items-center justify-center gap-1.5 rounded-[7px] border px-3 py-2 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${readiness.selectedGoal === 'pos' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/60 hover:bg-muted/30'}`}
                >
                  <MonitorSmartphone className="h-3.5 w-3.5" /> POS
                </button>
              </div>
            </div>
            {!canChangeGoal && (
              <p className="mt-2 text-[10px] text-muted-foreground">Sólo owner o admin puede cambiar el canal objetivo.</p>
            )}
          </div>

          {readiness.needsGoalChoice && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-[8px] border border-blue-500/25 bg-blue-500/[0.06] p-3">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
              <div>
                <p className="text-[12px] font-semibold">Elegí tienda online o POS para medir un resultado real</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Explorar el sistema no cuenta como activación ni como una primera venta.</p>
              </div>
            </div>
          )}

          {!readiness.needsGoalChoice && nextItem && (
            <div className="mx-4 mt-3 flex items-center gap-3 rounded-[8px] border border-primary/20 bg-primary/[0.06] p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/80">Siguiente paso verificable</p>
                <p className="mt-1 text-[13px] font-semibold leading-tight">{nextItem.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{nextItem.detail}</p>
              </div>
              <Link
                to={nextItem.href}
                className="flex shrink-0 items-center gap-1 rounded-[6px] bg-primary px-2.5 py-2 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <span className="hidden sm:inline">{nextItem.actionLabel}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {readiness.complete && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-[8px] border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <p className="text-[12px] font-semibold">Canal activado con evidencia</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">La ruta tiene catálogo, stock, operación fiscal y una primera venta atribuida.</p>
              </div>
            </div>
          )}

          <div className="mt-3 divide-y divide-border/40 border-t border-border/40">
            {visibleItems.map(item => (
              <div key={item.id} className={`flex items-start gap-3 px-4 py-3 ${item.done ? 'opacity-55' : 'hover:bg-muted/30'}`}>
                <div className="mt-0.5 shrink-0">
                  {item.done
                    ? <CheckCircle2 className="h-[18px] w-[18px] text-emerald-400" />
                    : item.owner === 'platform'
                      ? <AlertTriangle className="h-[18px] w-[18px] text-amber-400" />
                      : <Circle className="h-[18px] w-[18px] text-muted-foreground/40" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`text-[13px] font-medium leading-tight ${item.done ? 'line-through text-muted-foreground' : ''}`}>{item.label}</p>
                    {!item.done && item.owner !== 'merchant' && (
                      <span className="rounded-[4px] border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                        {item.owner === 'platform' ? 'Depende de Nerqia' : 'Validación compartida'}
                      </span>
                    )}
                  </div>
                  {!item.done && <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>}
                </div>
                {!item.done && !readiness.needsGoalChoice && (
                  <Link to={item.href} className="mt-0.5 shrink-0 whitespace-nowrap text-[11px] font-medium text-primary hover:underline">
                    {item.actionLabel} →
                  </Link>
                )}
              </div>
            ))}
            <div className="flex justify-center border-t border-border/40 px-4 py-2">
              <button
                type="button"
                onClick={() => setShowAll(value => !value)}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showAll ? 'Ver sólo pendientes' : `Ver los ${readiness.total} hitos`}
                {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <footer className="border-t border-border/40 bg-muted/20 px-4 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {readiness.progress}% · Logo, clientes, equipo y canjes mejoran el uso, pero no falsean esta medición de activación.
            </p>
          </footer>
        </>
      )}
    </section>
  );
}
