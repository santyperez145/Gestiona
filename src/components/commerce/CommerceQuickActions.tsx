/**
 * CommerceQuickActions — Acciones rápidas contextuales del Commerce OS.
 *
 * El orden no es decorativo: primero lo que ya cobró y espera salida
 * (despachar), después el dinero pendiente (cobros), y recién entonces la
 * navegación. Cada acción muestra el estado del negocio, no sólo el destino.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LucideIcon, Zap } from "lucide-react";
import { Link } from "react-router-dom";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  path: string;
  color: "primary" | "secondary" | "success" | "warning" | "destructive";
  description?: string;
}

interface CommerceQuickActionsProps {
  actions?: QuickAction[];
}

const defaultActions: QuickAction[] = [
  {
    label: "Nueva Venta",
    icon: Zap,
    path: "/caja",
    color: "primary",
    description: "Registrar venta en POS",
  },
  {
    label: "Nuevo Producto",
    icon: Zap,
    path: "/productos",
    color: "success",
    description: "Agregar al catálogo",
  },
  {
    label: "Nuevo Cliente",
    icon: Zap,
    path: "/clientes",
    color: "secondary",
    description: "Crear cliente",
  },
  {
    label: "Ver Reportes",
    icon: Zap,
    path: "/reportes",
    color: "warning",
    description: "Análisis de negocio",
  },
];

/** Badges operativos: la acción lleva el número si hay trabajo esperando. */
function extraerBadge(label: string): { texto: string; restante: string } | null {
  const m = label.match(/^(.+?) \((\d+)\)$/);
  return m ? { texto: m[1], restante: m[2] } : null;
}

export default function CommerceQuickActions({ actions = defaultActions }: CommerceQuickActionsProps) {
  const colorClasses = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/90",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    warning: "bg-amber-600 text-white hover:bg-amber-700",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  };

  return (
    <Card className="border-border/50 shadow-lg">
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Acciones rápidas
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {actions.map((action) => {
            const badge = extraerBadge(action.label);
            return (
              <Button
                key={action.path + action.label}
                asChild
                className={`h-auto flex-col gap-1.5 py-4 relative ${colorClasses[action.color]}`}
              >
                <Link to={action.path} title={action.description}>
                  <action.icon className="h-5 w-5" aria-hidden="true" />
                  <div className="text-center">
                    <p className="text-xs font-semibold flex items-center justify-center gap-1.5">
                      {badge ? badge.texto : action.label}
                      {badge && (
                        <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-white/25 px-1 text-[10px] font-bold tabular-nums">
                          {badge.restante}
                        </span>
                      )}
                    </p>
                    {action.description && (
                      <p className="text-[10px] opacity-80 mt-0.5">{action.description}</p>
                    )}
                  </div>
                </Link>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}