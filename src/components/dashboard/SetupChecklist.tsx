import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Rocket, X } from "lucide-react";

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
}

const STORAGE_KEY = "gestiona.setup.dismissed";

function isDismissed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}
function setDismissed() {
  try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* noop */ }
}

export default function SetupChecklist({
  businessName, hasLogo, hasExchangeRate, hasProducts, hasSales, hasPurchases,
}: SetupChecklistProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setLocalDismissed] = useState(isDismissed);

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
    {
      id: "tc",
      label: "Configurar tipo de cambio",
      desc: "El TC se usa para convertir costos en USD a ARS en todo el sistema.",
      done: hasExchangeRate,
      href: "/ajustes",
      actionLabel: "Configurar",
    },
    {
      id: "products",
      label: "Agregar el primer producto",
      desc: "El catálogo, el POS y los reportes dependen de tener productos cargados.",
      done: hasProducts,
      href: "/productos",
      actionLabel: "Ir a Productos",
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
      id: "purchase",
      label: "Registrar la primera compra",
      desc: "Las compras actualizan el stock y permiten calcular el costo real de cada producto.",
      done: hasPurchases,
      href: "/compras",
      actionLabel: "Ir a Compras",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total;

  // Hide if all done + dismissed, or manually dismissed
  if (dismissed) return null;
  if (allDone) return null;

  return (
    <div className="mb-5 rounded-[10px] border border-primary/20 bg-[hsl(228_24%_7%)] shadow-card overflow-hidden">
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
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => { setLocalDismissed(true); setDismissed(); }}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Cerrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Items */}
      {!collapsed && (
        <div className="divide-y divide-border/40">
          {items.map((item) => (
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
