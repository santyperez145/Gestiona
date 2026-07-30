/**
 * Vocabulario de módulos de permisos — única fuente de verdad.
 *
 * Vive en un módulo puro (sin React ni Supabase) porque lo consumen tres cosas
 * que no pueden desincronizarse: la matriz de Admin → Permisos, el mapa
 * ruta → módulo que filtra la navegación, y `seed_default_permissions()` en la
 * base. Un módulo con filas en la base y sin toggle en la UI es un permiso que
 * nadie puede cambiar; un módulo en el mapa de rutas y no en la base es un
 * toggle que no hace nada.
 *
 * Al agregar un módulo acá hay que agregarlo también al array `modules` de
 * `seed_default_permissions()` (migración 20260730000026). El test
 * `moduleMap.test.ts` verifica que el mapa de rutas no referencie módulos
 * inexistentes.
 */

export const PERMISSION_MODULES = [
  'sales', 'pos', 'products', 'customers', 'crm', 'reports',
  'expenses', 'purchases', 'invoices', 'inventory', 'analytics',
  'marketing', 'support', 'settings', 'team', 'finance',
  'ecommerce', 'shipping', 'payments', 'influencers',
] as const;

export type PermissionModule = typeof PERMISSION_MODULES[number];

export const PERMISSION_MODULE_LABEL: Record<PermissionModule, string> = {
  sales: 'Ventas',
  pos: 'POS',
  products: 'Productos',
  customers: 'Clientes',
  crm: 'CRM',
  reports: 'Reportes',
  expenses: 'Gastos',
  purchases: 'Compras',
  invoices: 'Facturas',
  inventory: 'Inventario',
  analytics: 'Analytics',
  marketing: 'Marketing',
  support: 'Soporte',
  settings: 'Configuración',
  team: 'Equipo',
  finance: 'Finanzas',
  ecommerce: 'Tienda online',
  shipping: 'Envíos',
  payments: 'Cobros y comisiones',
  influencers: 'Influencers y canjes',
};

export function isPermissionModule(value: string): value is PermissionModule {
  return (PERMISSION_MODULES as readonly string[]).includes(value);
}
