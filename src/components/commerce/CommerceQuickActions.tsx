/**
 * CommerceQuickActions — Acciones rápidas para el dashboard de Commerce
 *
 * Diseño moderno con botones de acceso rápido a funciones principales
 */
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LucideIcon, Plus, ShoppingCart, Package, Users, TrendingUp, Settings } from "lucide-react";
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
    icon: ShoppingCart,
    path: "/caja",
    color: "primary",
    description: "Registrar venta en POS",
  },
  {
    label: "Nuevo Producto",
    icon: Package,
    path: "/productos",
    color: "success",
    description: "Agregar al catálogo",
  },
  {
    label: "Nuevo Cliente",
    icon: Users,
    path: "/clientes",
    color: "secondary",
    description: "Crear cliente",
  },
  {
    label: "Ver Reportes",
    icon: TrendingUp,
    path: "/reportes",
    color: "warning",
    description: "Análisis de negocio",
  },
];

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
          <Plus className="h-4 w-4 text-primary" />
          Acciones Rápidas
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action) => (
            <Button
              key={action.path}
              asChild
              className={`h-auto flex-col gap-2 py-4 ${colorClasses[action.color]}`}
            >
              <Link to={action.path}>
                <action.icon className="h-5 w-5" />
                <div className="text-center">
                  <p className="text-xs font-semibold">{action.label}</p>
                  {action.description && (
                    <p className="text-[10px] opacity-80 mt-0.5">{action.description}</p>
                  )}
                </div>
              </Link>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
