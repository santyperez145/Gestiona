export interface PlanOffer {
  code?: string;
  name: string;
  price_ars_monthly: number | null;
  price_ars_yearly: number | null;
  max_products: number | null;
  max_sales_per_month?: number | null;
  max_users: number | null;
  ai_enabled: boolean;
  ai_monthly_credits?: number | null;
  backups_enabled?: boolean;
  custom_branding?: boolean;
}

export function planPrice(plan: PlanOffer, yearly = false): number | null {
  const value = yearly ? plan.price_ars_yearly : plan.price_ars_monthly;
  return value != null && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : null;
}

export function annualSaving(plan: PlanOffer): number | null {
  const monthly = planPrice(plan);
  const yearly = planPrice(plan, true);
  if (monthly == null || monthly <= 0 || yearly == null || yearly <= 0)
    return null;
  return Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 100));
}

export function planQuantity(value: number | null | undefined): string {
  return value == null ? "Sin límite de plan" : value.toLocaleString("es-AR");
}

export function planAI(plan: PlanOffer): string {
  if (!plan.ai_enabled) return "No incluida";
  if (plan.ai_monthly_credits === undefined) return "Consultar cupo";
  const quota =
    plan.ai_monthly_credits === null
      ? "Sin tope mensual"
      : `${planQuantity(plan.ai_monthly_credits)} acciones/mes`;
  return plan.code === "trial"
    ? `${quota} durante la prueba de 14 días`
    : quota;
}

export function limitesDelPlan(plan: PlanOffer): string[] {
  return [
    plan.max_products == null
      ? "Productos ilimitados"
      : `Hasta ${planQuantity(plan.max_products)} productos`,
    plan.max_sales_per_month == null
      ? "Ventas ilimitadas"
      : `${planQuantity(plan.max_sales_per_month)} ventas/mes`,
    plan.max_users == null
      ? "Usuarios ilimitados"
      : `Hasta ${planQuantity(plan.max_users)} usuarios`,
    ...(plan.ai_enabled ? [planAI(plan)] : []),
  ];
}

export const PLAN_COMPARISON = [
  {
    id: "commerce",
    label: "Tienda y ventas",
    rows: [
      {
        label: "Productos",
        value: (p: PlanOffer) => planQuantity(p.max_products),
      },
      {
        label: "Ventas por mes",
        value: (p: PlanOffer) => planQuantity(p.max_sales_per_month),
      },
      {
        label: "Usuarios del equipo",
        value: (p: PlanOffer) => planQuantity(p.max_users),
      },
      {
        label: "Tienda, variantes, carrito y pedidos",
        value: () => "Incluido",
      },
      { label: "Importación Excel y CSV por lotes", value: () => "Incluido" },
      {
        label: "Búsqueda, filtros y acciones masivas",
        value: () => "Incluido",
      },
      { label: "Exportación de productos y clientes", value: () => "Incluido" },
      { label: "Proveedores de pago", value: () => "Conectá tu cuenta" },
      { label: "Envíos personalizados y retiro", value: () => "Incluido" },
    ],
  },
  {
    id: "marketing",
    label: "Diseño y marketing",
    rows: [
      {
        label: "Editor visual y páginas de la tienda",
        value: () => "Incluido",
      },
      { label: "SEO de tienda y productos", value: () => "Incluido" },
      { label: "Cupones y promociones", value: () => "Incluido" },
      { label: "Recuperación de carritos", value: () => "Canal configurado" },
      { label: "Dominio propio", value: () => "Dominio y DNS propios" },
      {
        label: "Marca propia sin identificación de Nerqia",
        value: (p: PlanOffer) =>
          !p.custom_branding
            ? "No incluido"
            : p.code === "trial"
              ? "Durante la prueba"
              : "Incluido",
      },
    ],
  },
  {
    id: "operations",
    label: "Gestión y seguridad",
    rows: [
      { label: "Stock, compras y venta de mostrador", value: () => "Incluido" },
      { label: "Listas de precios para el mostrador", value: () => "Incluido" },
      { label: "Permisos diferenciados del equipo", value: () => "Incluido" },
      { label: "Verificación en dos pasos", value: () => "Incluido" },
      { label: "Centro de ayuda y tickets", value: () => "Incluido" },
      { label: "Inteligencia artificial", value: (p: PlanOffer) => planAI(p) },
      {
        label: "Copias de seguridad automáticas del comercio",
        value: (p: PlanOffer) =>
          !p.backups_enabled
            ? "No incluido"
            : p.code === "trial"
              ? "Durante la prueba"
              : "Incluido",
      },
    ],
  },
];
