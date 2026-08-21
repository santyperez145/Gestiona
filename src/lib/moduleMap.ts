/**
 * Mapa ruta → módulo de permisos.
 *
 * `role_permissions` tiene 16 módulos con toggles en Admin → Permisos, pero
 * hasta ahora solo 4 páginas los consultaban: se podía apagar "Ventas" o
 * "Configuración" y no pasaba nada. Este mapa conecta cada ruta del sidebar
 * con su módulo, para filtrar la navegación y bloquear el acceso directo por
 * URL.
 *
 * Resolución: primero una coincidencia exacta de ruta, si no el módulo por
 * defecto de la sección del sidebar. Una sección sin módulo (`principal`)
 * queda siempre visible: es el Dashboard y las tareas del día.
 */

/** Módulo por defecto según la sección del sidebar. */
export const SECTION_MODULE: Record<string, string> = {
  principal: "",
  inventario: "inventory",
  ventas: "sales",
  finanzas: "finance",
  marketing: "marketing",
  analytics: "analytics",
  // La tienda online dejó de ser "marketing": tiene su propio módulo desde que
  // hay pedidos, envíos y cobros propios que un vendedor puede ver pero no configurar.
  ecommerce: "ecommerce",
  admin: "settings",
};

/** Rutas cuyo módulo no coincide con el de su sección. */
export const ROUTE_MODULE: Record<string, string> = {
  "/caja": "pos",
  "/pos": "pos",
  "/productos": "products",
  "/calidad-datos": "products",
  "/compras": "purchases",
  "/ordenes-compra": "purchases",
  "/clientes": "customers",
  "/rfm": "customers",
  "/crm-avanzado": "crm",
  "/gastos": "expenses",
  "/facturas": "invoices",
  "/afip": "invoices",
  "/reportes": "reports",
  "/bi-reportes": "reports",
  "/equipo": "team",
  "/configuracion": "settings",
  "/integraciones": "settings",
  "/admin": "settings",
  "/envios": "shipping",
  "/tienda-online": "ecommerce",
  "/links-de-pago": "payments",
  "/movimientos": "payments",
  "/canjes": "influencers",
  "/influencers": "influencers",
};

/**
 * Devuelve el módulo de permisos de una ruta, o "" si no está restringida.
 */
export function moduleForRoute(path: string, section?: string): string {
  const exact = ROUTE_MODULE[path];
  if (exact !== undefined) return exact;
  if (section && SECTION_MODULE[section] !== undefined) return SECTION_MODULE[section];
  return "";
}
