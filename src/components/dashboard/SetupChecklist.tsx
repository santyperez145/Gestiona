import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Circle, ChevronDown, ChevronUp, Rocket, X } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  desc: string;
  done: boolean;
  href: string;
  actionLabel: string;
}

interface SetupChecklistProps {
  businessName: string;
  hasLogo: boolean;
  hasExchangeRate: boolean;
  hasProducts: boolean;
  hasSales: boolean;
  hasPurchases: boolean;
  hasCustomers: boolean;
  hasExchanges: boolean;
  hasTeam: boolean;
  organizationId?: string | null;
  /** Código de rubro del negocio (settings.industry_code). Ajusta qué pasos se muestran. */
  industryCode?: string | null;
}

const STORAGE_KEY = "gestiona.setup.dismissed";

function storageKey(organizationId?: string | null) {
  return `${STORAGE_KEY}.${organizationId || "default"}`;
}
function isDismissed(organizationId?: string | null): boolean {
  try { return localStorage.getItem(storageKey(organizationId)) === "1"; } catch { return false; }
}
function setDismissed(organizationId?: string | null) {
  try { localStorage.setItem(storageKey(organizationId), "1"); } catch { /* noop */ }
}

export default function SetupChecklist({
  businessName, hasLogo, hasExchangeRate, hasProducts, hasSales, hasPurchases,
  hasCustomers, hasExchanges, hasTeam, organizationId, industryCode,
}: SetupChecklistProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [dismissed, setLocalDismissed] = useState(() => isDismissed(organizationId));

  useEffect(() => {
    setLocalDismissed(isDismissed(organizationId));
    setShowAll(false);
  }, [organizationId]);

  // El tipo de cambio (costos en USD) importa sobre todo en rubros que importan
  // producto — perfumes, vapers, tecnología, cosmética. En alimentos/indumentaria
  // locales suele no aplicar, así que no lo mostramos como paso obligatorio.
  const usaCostosUSD = !industryCode || ["perfumes", "vapers", "tecnologia", "cosmetica"].includes(industryCode);

  const items: ChecklistItem[] = [
    {
      id: "biz",
      label: "Configurar nombre del negocio",
      desc: "Aparece en recibos, catálogos y emails enviados a clientes.",
      done: !!businessName && businessName !== "Mi Negocio" && businessName.length > 2,
      href: "/ajustes",
      actionLabel: "Ir a Ajustes",
    },
    {
      id: "logo",
      label: "Subir logo del negocio",
      desc: "Se muestra en el catálogo público, facturas y emails de marketing.",
      done: hasLogo,
      href: "/ajustes",
      actionLabel: "Subir logo",
    },
    ...(usaCostosUSD ? [{
      id: "tc",
      label: "Configurar tipo de cambio",
      desc: "El TC se usa para convertir costos en USD a ARS en todo el sistema.",
      done: hasExchangeRate,
      href: "/ajustes",
      actionLabel: "Configurar",
    }] : []),
    {
      id: "products",
      label: "Agregar el primer producto",
      desc: "El catálogo, el POS y los reportes dependen de tener productos cargados.",
      done: hasProducts,
      href: "/productos",
      actionLabel: "Ir a Productos",
    },
    {
      id: "purchase",
      label: "Registrar la primera compra",
      desc: "Las compras actualizan el stock y permiten calcular el costo real de cada producto.",
      done: hasPurchases,
      href: "/compras",
      actionLabel: "Ir a Compras",
    },
    {
      id: "sale",
      label: "Registrar la primera venta",
      desc: "Una vez que tenés productos, registrá tu primera venta para ver el sistema completo.",
      done: hasSales,
      href: "/caja",
      actionLabel: "Abrir POS",
    },
    {
      id: "customer",
      label: "Cargar tu primer cliente",
      desc: "La base de clientes habilita CRM, fidelidad, deudas y campañas de marketing.",
      done: hasCustomers,
      href: "/clientes",
      actionLabel: "Ir a Clientes",
    },
    {
      id: "exchange",
      label: "Registrar tu primer canje con influencer",
      desc: "Entregá producto a un influencer y seguí el alcance, el contenido y el ROI que genera.",
      done: hasExchanges,
      href: "/canjes",
      actionLabel: "Ir a Canjes",
    },
    {
      id: "team",
      label: "Invitar a tu equipo",
      desc: "Sumá vendedores con permisos por rol para que trabajen en el sistema con vos.",
      done: hasTeam,
      href: "/equipo",
      actionLabel: "Invitar equipo",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total;
  const nextItem = items.find((item) => !item.done);
  const visibleItems = showAll ? items : items.filter((item) => !item.done).slice(0, 3);

  // Hide if all done + dismissed, or manually dismissed
  if (dismissed) return null;
  if (allDone) return null;

  return (
    <div className="mb-5 rounded-[10px] border border-primary/20 bg-card shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Rocket className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Configuración inicial</h3>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-[4px] bg-primary/15 text-primary">
              {doneCount}/{total}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-1.5 w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label={collapsed ? "Mostrar configuracion inicial" : "Ocultar configuracion inicial"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Cerrar configuracion inicial"
            onClick={() => { setLocalDismissed(true); setDismissed(organizationId); }}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Cerrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && nextItem && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-[8px] border border-primary/20 bg-primary/[0.06] p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary/80">Siguiente paso</p>
            <p className="mt-1 text-[13px] font-semibold leading-tight">{nextItem.label}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{nextItem.desc}</p>
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

      {/* Items */}
      {!collapsed && (
        <div className="divide-y divide-border/40">
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-3 px-4 py-3 transition-colors ${item.done ? "opacity-50" : "hover:bg-muted/30"}`}
            >
              <div className="mt-0.5 shrink-0">
                {item.done
                  ? <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 w-[18px] h-[18px]" />
                  : <Circle className="w-[18px] h-[18px] text-muted-foreground/40" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-medium leading-tight ${item.done ? "line-through text-muted-foreground" : ""}`}>
                  {item.label}
                </p>
                {!item.done && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                )}
              </div>
              {!item.done && (
                <Link
                  to={item.href}
                  className="shrink-0 text-[11px] font-medium text-primary hover:underline whitespace-nowrap mt-0.5"
                >
                  {item.actionLabel} →
                </Link>
              )}
            </div>
          ))}
          <div className="flex justify-center border-t border-border/40 px-4 py-2">
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showAll ? "Ocultar pasos completados" : `Ver todos los pasos (${total})`}
              {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-2.5 bg-muted/20 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground">
            {pct}% completado · Estos pasos garantizan que el sistema funcione correctamente desde el primer día.
          </p>
        </div>
      )}
    </div>
  );
}
