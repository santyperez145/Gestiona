/**
 * Route Manifest — la fuente única de rutas, permisos y navegación.
 *
 * ── El problema que resuelve, medido ──────────────────────────────────────
 *
 * Las rutas vivían repartidas entre `App.tsx`, `navigation.ts`, `moduleMap.ts`,
 * el Command Palette y los tests. Eso ya divergió, y el 2026-08-26 se midió
 * cuánto: de los **70 destinos del sidebar, 29 no tenían ningún módulo de
 * permisos**.
 *
 * La causa era un fallback silencioso. `moduleForRoute(path, section)` caía a
 * `SECTION_MODULE[section]`, cuyas claves eran las secciones viejas
 * —`principal`, `inventario`, `ventas`, `analytics`, `admin`— mientras la
 * navegación ya usaba `diario`, `trabajo`, `compras`, `cobranzas`, `reportes`
 * y `sistema`. **Coincidían 2 de 8.** Para los otros seis grupos el fallback
 * devolvía `""`, que significa "sin restricción".
 *
 * O sea que apagar un módulo en Admin → Permisos no hacía nada para
 * `/ventas`, `/ajustes`, `/kardex`, `/deudas`, `/analytics` y 24 rutas más.
 * Es exactamente el bug que el docstring de `moduleMap.ts` decía haber
 * arreglado: renombrar los grupos del sidebar lo reintrodujo en silencio.
 *
 * ── La regla que lo evita ─────────────────────────────────────────────────
 *
 * **Cada ruta declara su módulo, y `null` exige un motivo escrito.** No hay
 * fallback por sección: una ruta nueva sin `module` no compila, y una abierta
 * sin `openReason` hace fallar el test. Abrir una ruta pasa a ser una decisión
 * con nombre y explicación, nunca un olvido.
 *
 * ⚠️ Alcance honesto, el mismo que declara `ModuleGuard`: esto es una barrera
 * de interfaz. El límite de seguridad real sigue siendo la RLS por
 * organización. Sirve para separar responsabilidades dentro de un equipo, no
 * para contener a un atacante.
 *
 * ── Qué se deriva de acá ──────────────────────────────────────────────────
 *
 *   sidebar · buscador · módulo de permisos · redirects de alias
 *
 * ── El segundo lugar donde ya había divergido ─────────────────────────────
 *
 * Al generar el router desde acá apareció la misma falla en otra forma: el
 * reparto admin/vendedor estaba **a la vez** en este archivo y en un
 * `{isAdmin && (...)}` de `App.tsx`. Medido: **5 rutas divergían** —`/tareas`,
 * `/seguimiento`, `/calendario`, `/envios` y `/perfil`—. El sidebar se las
 * mostraba a un vendedor y el router no las montaba, así que el clic caía en
 * el `path="*"` y lo rebotaba al dashboard. Incluido su propio perfil.
 *
 * Por eso `roles` vive al nivel de la ruta y no dentro de `nav`: gobierna las
 * dos cosas, y una sola decisión no puede estar escrita dos veces.
 *
 * ── Lo que `App.tsx` todavía declara a mano ───────────────────────────────
 *
 * Sólo lo que este archivo no modela: las rutas con parámetros
 * (`/tienda/:slug/*`, `/pagar/:linkId`), los montajes de superficie
 * (`/platform/*`, `/finance/*`) y `/login`, que no es lazy porque es la
 * primera pantalla. `routeManifest.test.ts` falla si aparece cualquier otra.
 */
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle, AlertTriangle, ArrowRightLeft, BarChart3, Bell, BookOpen,
  Brain, Calendar, CheckSquare, ClipboardList, CreditCard, Crown,
  DollarSign, FileText, Gift, History, Kanban, Landmark,
  Layers, LayoutDashboard, LineChart, Link2, Mail, Megaphone,
  MessageCircle, Package, Plug, Receipt, RefreshCw, RotateCcw,
  Scale, ScanBarcode, ScanLine, ScanSearch, Settings, Share2,
  Shield, ShoppingBag, ShoppingCart, Sparkles, Star, Tag,
  TrendingUp, Trophy, Truck, UserCircle, UserPlus, Users,
  Users2, Wallet, Warehouse, Zap,
} from "lucide-react";
import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import type { PermissionModule } from "@/lib/permissionModules";

/** Una página cargada bajo demanda. */
export type LazyPage = LazyExoticComponent<ComponentType<Record<string, never>>>;

export type NavRole = "admin" | "vendedor" | "viewer";

export type NavGroupId =
  | "diario" | "trabajo" | "compras" | "cobranzas"
  | "finanzas" | "marketing" | "reportes" | "sistema";

/**
 * `canonical` es la URL real de la pantalla. `alias` no aparece acá como
 * entrada propia: vive en `aliases` de su canónica, para que sea imposible
 * tener un alias que apunte a algo que no existe.
 */
export type RouteStatus = "canonical" | "deprecated" | "internal";

export interface RouteAlias {
  /** La URL vieja, la que sigue en un bookmark o en un mail. */
  path: string;
  /**
   * A dónde va. Puede llevar query —`/admin?tab=audit`— porque varios alias
   * apuntaban a una tab concreta y quedarse con la ruta pelada los mandaba a
   * otra pantalla.
   */
  redirectTo: string;
}

export interface RouteNav {
  /** Cómo lo llamaría quien usa el sistema, no cómo se llama la tabla. */
  label: string;
  icon: LucideIcon;
  group: NavGroupId;
  /**
   * Términos extra para el buscador: la jerga vieja, sinónimos y lo que
   * escribiría alguien que no conoce el sistema. Es lo que hace que renombrar
   * no rompa a quien ya sabía dónde estaba todo.
   */
  keywords?: string[];
}

export interface RouteDefinition {
  /** Estable y único. Es la clave de telemetría; no se renombra al mover la URL. */
  id: string;
  path: string;
  /**
   * Quién puede entrar. Vive acá y no en `nav` porque gobierna **dos** cosas
   * que estaban separadas: si el destino aparece en el sidebar y si la ruta se
   * monta en el router.
   *
   * Estaban en dos lugares —este archivo y el `{isAdmin && ...}` de
   * `App.tsx`— y divergieron en 5 rutas: `/tareas`, `/seguimiento`,
   * `/calendario`, `/envios` y `/perfil` figuraban para vendedor en el menú y
   * no se montaban, así que el clic rebotaba al dashboard. Incluido su propio
   * perfil.
   */
  roles: NavRole[];
  /**
   * La página. Se declara acá para que la ruta y lo que renderiza no puedan
   * separarse; `App.tsx` sólo recorre esta lista.
   */
  component?: LazyPage;
  /**
   * Módulo de permisos que exige la ruta, o `null` si es deliberadamente
   * abierta. **Obligatorio**: no hay fallback por sección, que es lo que dejó
   * 29 destinos sin restringir.
   */
  module: PermissionModule | null;
  /** Por qué está abierta. Obligatorio cuando `module` es null; lo exige el test. */
  openReason?: string;
  /** URLs viejas que redirigen acá. Un alias nunca es una entrada propia. */
  aliases?: RouteAlias[];
  status: RouteStatus;
  /** Ausente = alcanzable por URL y buscador, pero no listada en el sidebar. */
  nav?: RouteNav;
}

const AMBOS: NavRole[] = ["admin", "vendedor"];
const SOLO_ADMIN: NavRole[] = ["admin"];
/**
 * Rutas públicas: se renderizan fuera de `ProtectedRoutes`, así que no hay rol
 * que las gobierne. Se declara igual para que el tipo cierre y para no
 * mantener una lista paralela de "las que no tienen roles".
 */
const PUBLICO: NavRole[] = [];

export const ROUTES: RouteDefinition[] = [
  { id: "inicio", path: "/", roles: AMBOS, component: lazy(() => import("@/pages/Dashboard")), module: null, openReason: "Inicio: sin dashboard no hay desde dónde entrar a nada.", aliases: [{ path: "/landing", redirectTo: "/" }, { path: "/recomendaciones-ia", redirectTo: "/" }], status: "canonical", nav: { label: "Inicio", icon: LayoutDashboard, group: "diario", keywords: ["dashboard", "resumen", "home", "panel"] } },
  { id: "tienda_online", path: "/tienda-online", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/EcommerceStorePage")), module: "ecommerce", status: "canonical", nav: { label: "Tienda online", icon: ShoppingBag, group: "diario", keywords: ["ecommerce", "web", "vitrina", "storefront", "pedidos online", "commerce"] } },
  { id: "caja", path: "/caja", roles: AMBOS, component: lazy(() => import("@/pages/POSPage")), module: "pos", status: "canonical", nav: { label: "Vender", icon: ScanLine, group: "diario", keywords: ["pos", "caja", "mostrador", "cobrar", "ticket", "punto de venta"] } },
  { id: "ventas", path: "/ventas", roles: AMBOS, component: lazy(() => import("@/pages/SalesPage")), module: "sales", status: "canonical", nav: { label: "Ventas", icon: DollarSign, group: "diario", keywords: ["facturación", "vendido", "pedidos"] } },
  { id: "productos", path: "/productos", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/ProductsPage")), module: "products", status: "canonical", nav: { label: "Productos", icon: Package, group: "diario", keywords: ["stock", "catálogo", "precios", "artículos", "mercadería"] } },
  {
    id: "clientes", path: "/clientes", roles: AMBOS,
    component: lazy(() => import("@/pages/CustomersPage")), module: "customers",
    // Consolidación 2026-08-27: /seguimiento, /rfm y /crm-avanzado eran páginas
    // propias con el mismo dominio. Sus modelos medían 0 filas (crm_contacts,
    // crm_activities, crm_followups, tasks, deals — medido ese día) y su
    // contenido pasó a vistas de este workspace. El gate por rol de las que
    // eran SOLO_ADMIN vive ahora dentro de CustomersPage (isAdmin).
    aliases: [
      { path: "/seguimiento", redirectTo: "/clientes?vista=seguimientos" },
      { path: "/crm-avanzado", redirectTo: "/clientes?vista=pipeline" },
      { path: "/pipeline", redirectTo: "/clientes?vista=pipeline" },
      { path: "/rfm", redirectTo: "/clientes?vista=segmentos" },
      { path: "/segmentos", redirectTo: "/clientes?vista=segmentos" },
      { path: "/lead-scoring", redirectTo: "/clientes?vista=segmentos" },
    ],
    status: "canonical",
    nav: { label: "Clientes", icon: Users, group: "diario", keywords: ["crm", "compradores", "contactos", "fichas", "rfm", "segmentos", "pipeline", "embudo", "oportunidades", "seguimientos", "recordatorios", "follow up"] },
  },
  { id: "tareas", path: "/tareas", roles: AMBOS, component: lazy(() => import("@/pages/TasksPage")), module: null, openReason: "Tareas del propio usuario, no datos del negocio.", status: "canonical", nav: { label: "Tareas", icon: CheckSquare, group: "trabajo", keywords: ["pendientes", "to do", "kanban"] } },
  { id: "calendario", path: "/calendario", roles: AMBOS, component: lazy(() => import("@/pages/CalendarPage")), module: null, openReason: "Agenda propia del usuario.", status: "canonical", nav: { label: "Calendario", icon: Calendar, group: "trabajo", keywords: ["agenda", "fechas", "turnos"] } },
  { id: "compras", path: "/compras", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/PurchasesPage")), module: "purchases", status: "canonical", nav: { label: "Compras", icon: ShoppingCart, group: "compras", keywords: ["importación", "ingreso de mercadería", "proveedor"] } },
  { id: "ordenes_compra", path: "/ordenes-compra", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/PurchaseOrdersPage")), module: "purchases", aliases: [{ path: "/cotizaciones-proveedor", redirectTo: "/ordenes-compra" }, { path: "/solicitudes-compra", redirectTo: "/ordenes-compra" }], status: "canonical", nav: { label: "Órdenes de compra", icon: ClipboardList, group: "compras", keywords: ["oc", "pedido a proveedor", "recepción"] } },
  { id: "proveedores", path: "/proveedores", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/ProveedoresPage")), module: "purchases", status: "canonical", nav: { label: "Proveedores", icon: Truck, group: "compras", keywords: ["suppliers", "a quién le compro"] } },
  {
    id: "planificacion_inventario", path: "/planificacion", roles: SOLO_ADMIN,
    component: lazy(() => import("@/pages/InventoryPlanningPage")), module: "inventory",
    // Consolidación 2026-08-27: Reposición, Proyección e Inventario con IA eran
    // tres páginas con tres implementaciones de velocidad/safety stock/punto de
    // reposición — tres respuestas posibles para la misma pregunta. Ahora son
    // vistas de un workspace; unificar el cálculo es INV-001 y va aparte.
    aliases: [
      { path: "/restock", redirectTo: "/planificacion?vista=reposicion" },
      { path: "/forecast-inventario", redirectTo: "/planificacion?vista=forecast" },
      { path: "/inventario-inteligente", redirectTo: "/planificacion?vista=analisis" },
    ],
    status: "canonical",
    nav: { label: "Planificación", icon: RefreshCw, group: "compras", keywords: ["restock", "qué reponer", "sugerencias de compra", "forecast", "cuánto voy a necesitar", "quiebre de stock", "abc", "rotación", "optimizar stock"] },
  },
  { id: "kardex", path: "/kardex", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/KardexPage")), module: "inventory", aliases: [{ path: "/toma-fisica", redirectTo: "/kardex" }], status: "canonical", nav: { label: "Movimientos de stock", icon: History, group: "compras", keywords: ["kardex", "historial de stock", "entradas y salidas", "ajustes"] } },
  { id: "transferencias", path: "/transferencias", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/InventoryTransfersPage")), module: "inventory", status: "canonical", nav: { label: "Transferencias", icon: ArrowRightLeft, group: "compras", keywords: ["mover stock", "entre sucursales", "depósitos"] } },
  { id: "sucursales", path: "/sucursales", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/LocationsPage")), module: "inventory", aliases: [{ path: "/franquicias", redirectTo: "/sucursales" }, { path: "/multi-deposito", redirectTo: "/sucursales" }], status: "canonical", nav: { label: "Sucursales y depósitos", icon: Warehouse, group: "compras", keywords: ["locales", "puntos de venta", "almacén", "multi tienda"] } },
  { id: "lotes", path: "/lotes", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/BatchLotPage")), module: "inventory", status: "canonical", nav: { label: "Lotes y vencimientos", icon: ScanBarcode, group: "compras", keywords: ["batch", "caducidad", "trazabilidad"] } },
  { id: "bundles", path: "/bundles", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/ProductBundlesPage")), module: "products", status: "canonical", nav: { label: "Combos y kits", icon: Layers, group: "compras", keywords: ["bundles", "packs", "promo pack"] } },
  { id: "listas_precios", path: "/listas-precios", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/PriceListsPage")), module: "products", status: "canonical", nav: { label: "Listas de precios", icon: Tag, group: "compras", keywords: ["mayorista", "minorista", "precio por cliente"] } },
  { id: "valuacion_inventario", path: "/valuacion-inventario", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/InventoryValuationPage")), module: "inventory", aliases: [{ path: "/inventario-aging", redirectTo: "/valuacion-inventario" }], status: "canonical", nav: { label: "Valuación de inventario", icon: Layers, group: "compras", keywords: ["cuánto vale el stock", "fifo", "costo promedio"] } },
  { id: "deudas", path: "/deudas", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/DebtsPage")), module: "sales", status: "canonical", nav: { label: "Deudas", icon: AlertCircle, group: "cobranzas", keywords: ["me deben", "cuentas por cobrar", "fiado", "moroso"] } },
  { id: "cuotas", path: "/cuotas", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/CuotasPage")), module: "sales", status: "canonical", nav: { label: "Cuotas", icon: CreditCard, group: "cobranzas", keywords: ["financiación", "plan de pago", "vencimientos"] } },
  { id: "presupuestos", path: "/presupuestos", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/PresupuestosPage")), module: "sales", status: "canonical", nav: { label: "Presupuestos", icon: ClipboardList, group: "cobranzas", keywords: ["cotización", "quotes", "proforma"] } },
  { id: "facturas", path: "/facturas", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/InvoicesPage")), module: "invoices", status: "canonical", nav: { label: "Facturas", icon: FileText, group: "cobranzas", keywords: ["comprobantes", "invoices"] } },
  { id: "devoluciones", path: "/devoluciones", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/DevolucionesPage")), module: "sales", aliases: [{ path: "/devoluciones-rma", redirectTo: "/devoluciones" }], status: "canonical", nav: { label: "Devoluciones", icon: RotateCcw, group: "cobranzas", keywords: ["cambios", "rma", "reembolso"] } },
  { id: "envios", path: "/envios", roles: AMBOS, component: lazy(() => import("@/pages/DeliveryTrackingPage")), module: "shipping", status: "canonical", nav: { label: "Envíos", icon: Truck, group: "cobranzas", keywords: ["seguimiento", "tracking", "despacho", "correo", "andreani"] } },
  { id: "links_de_pago", path: "/links-de-pago", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/PaymentLinksPage")), module: "payments", status: "canonical", nav: { label: "Links de pago", icon: Link2, group: "cobranzas", keywords: ["cobrar a distancia", "link mercadopago"] } },
  { id: "mi_plan", path: "/mi-plan", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/MiPlanPage")), module: "settings", status: "canonical", nav: { label: "Mi plan", icon: CreditCard, group: "sistema", keywords: ["suscripcion", "plan", "pagar", "mercadopago", "facturacion", "abono"] } },
  { id: "billetera", path: "/billetera", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/WalletPage")), module: "finance", status: "canonical", nav: { label: "Billetera", icon: Wallet, group: "finanzas", keywords: ["saldo", "plata", "retirar", "retiro", "cobros", "disponible", "acreditado", "cbu"] } },
  { id: "gastos", path: "/gastos", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/ExpensesPage")), module: "expenses", status: "canonical", nav: { label: "Gastos", icon: Wallet, group: "finanzas", keywords: ["egresos", "pagos", "costos fijos"] } },
  { id: "cash_flow", path: "/cash-flow", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/CashFlowPage")), module: "finance", status: "canonical", nav: { label: "Flujo de caja", icon: BarChart3, group: "finanzas", keywords: ["cash flow", "proyección de plata", "liquidez"] } },
  { id: "pl_dashboard", path: "/pl-dashboard", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/PLDashboardPage")), module: "finance", aliases: [{ path: "/escenarios-financieros", redirectTo: "/pl-dashboard" }], status: "canonical", nav: { label: "Ganancias y pérdidas", icon: TrendingUp, group: "finanzas", keywords: ["p&l", "pl", "resultado", "rentabilidad", "estado de resultados"] } },
  { id: "banco", path: "/banco", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/BankReconciliationPage")), module: "finance", status: "canonical", nav: { label: "Banco y conciliación", icon: Landmark, group: "finanzas", keywords: ["conciliar", "extracto", "movimientos bancarios"] } },
  { id: "movimientos", path: "/movimientos", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/FinancialMovementsPage")), module: "payments", status: "canonical", nav: { label: "Movimientos operativos", icon: BookOpen, group: "finanzas", keywords: ["libro mayor", "movimientos", "caja", "asientos", "financial movements"] } },
  { id: "cheques", path: "/cheques", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/ChequesPage")), module: "finance", status: "canonical", nav: { label: "Cheques", icon: FileText, group: "finanzas", keywords: ["echeq", "valores", "cartera"] } },
  { id: "comisiones", path: "/comisiones", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/SellerCommissionsPage")), module: "finance", status: "canonical", nav: { label: "Comisiones", icon: Receipt, group: "finanzas", keywords: ["vendedores", "aranceles", "mercadopago"] } },
  { id: "impuestos", path: "/impuestos", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/TaxManagementPage")), module: "finance", status: "canonical", nav: { label: "Impuestos", icon: Scale, group: "finanzas", keywords: ["iva", "ingresos brutos", "retenciones", "arca"] } },
  { id: "afip", path: "/afip", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/AFIPPage")), module: "invoices", status: "canonical", nav: { label: "AFIP y factura electrónica", icon: Shield, group: "finanzas", keywords: ["arca", "cae", "facturar", "wsfe", "monotributo"] } },
  { id: "multi_divisa", path: "/multi-divisa", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/MultiCurrencyPage")), module: "finance", aliases: [{ path: "/tipo-cambio", redirectTo: "/multi-divisa" }], status: "canonical", nav: { label: "Multi-divisa", icon: DollarSign, group: "finanzas", keywords: ["dólar", "tipo de cambio", "fx", "cotización"] } },
  { id: "suscripciones", path: "/suscripciones", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/SubscriptionsPage")), module: "finance", status: "canonical", nav: { label: "Suscripciones", icon: CreditCard, group: "finanzas", keywords: ["abonos", "cobro recurrente", "membresías"] } },
  { id: "marketing", path: "/marketing", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/MarketingPage")), module: "marketing", aliases: [{ path: "/automatizaciones", redirectTo: "/marketing?vista=automations" }, { path: "/combos-banners", redirectTo: "/marketing?vista=combos" }, { path: "/marca-ia", redirectTo: "/marketing?vista=brand" }, { path: "/templates", redirectTo: "/marketing?vista=templates" },
    // Consolidación 2026-08-27: desde MKT-001 el planner y Publicaciones
    // muestran la MISMA tabla (social_posts). Dos páginas para una autoridad
    // eran el duplicado; el planner es ahora la vista ?vista=planner.
    { path: "/planner-social", redirectTo: "/marketing?vista=planner" }], status: "canonical", nav: { label: "Campañas", icon: Megaphone, group: "marketing", keywords: ["marketing", "publicidad", "anuncios", "planner", "calendario de contenido", "posteos", "instagram", "redes"] } },
  { id: "cupones", path: "/cupones", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/CouponsPage")), module: "marketing", status: "canonical", nav: { label: "Cupones", icon: Tag, group: "marketing", keywords: ["descuentos", "códigos", "promo"] } },
  { id: "promociones", path: "/promociones", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/PromotionsPage")), module: "marketing", status: "canonical", nav: { label: "Promociones", icon: Zap, group: "marketing", keywords: ["ofertas", "flash sale", "2x1", "liquidación"] } },
  { id: "email_campaigns", path: "/email-campaigns", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/EmailCampaignsPage")), module: "marketing", aliases: [{ path: "/secuencias-email", redirectTo: "/email-campaigns" }], status: "canonical", nav: { label: "Email", icon: Mail, group: "marketing", keywords: ["newsletter", "mailing", "correo masivo"] } },
  { id: "whatsapp_campaigns", path: "/whatsapp-campaigns", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/WhatsAppCampaignsPage")), module: "marketing", status: "canonical", nav: { label: "WhatsApp", icon: MessageCircle, group: "marketing", keywords: ["difusión", "wsp", "mensajes masivos"] } },
  { id: "fidelidad", path: "/fidelidad", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/LoyaltyAdvancedPage")), module: "marketing", aliases: [{ path: "/fidelidad-avanzada", redirectTo: "/fidelidad" }], status: "canonical", nav: { label: "Fidelidad", icon: Star, group: "marketing", keywords: ["puntos", "recompensas", "loyalty", "clientes frecuentes"] } },
  { id: "canjes", path: "/canjes", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/InfluencerExchangesPage")), module: "influencers", aliases: [{ path: "/liquidaciones", redirectTo: "/canjes" }], status: "canonical", nav: { label: "Canjes con influencers", icon: Gift, group: "marketing", keywords: ["regalos", "colaboraciones", "prensa"] } },
  { id: "influencers", path: "/influencers", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/InfluencersPage")), module: "influencers", status: "canonical", nav: { label: "Influencers", icon: Users2, group: "marketing", keywords: ["creadores", "instagram", "tiktok"] } },
  { id: "afiliados", path: "/afiliados", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/AffiliateProgramPage")), module: "marketing", status: "canonical", nav: { label: "Afiliados", icon: UserPlus, group: "marketing", keywords: ["comisión por venta", "partners"] } },
  { id: "referidos", path: "/referidos", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/ReferralsPage")), module: "marketing", status: "canonical", nav: { label: "Referidos", icon: Trophy, group: "marketing", keywords: ["recomendaciones", "traé un amigo"] } },
  { id: "catalogo", path: "/catalogo", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/CatalogPage")), module: "marketing", status: "canonical", nav: { label: "Catálogo por WhatsApp", icon: BookOpen, group: "marketing", keywords: ["lista de precios", "compartir productos", "pdf"] } },
  { id: "reportes", path: "/reportes", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/ReportsPage")), module: "reports", status: "canonical", nav: { label: "Reportes", icon: TrendingUp, group: "reportes", keywords: ["informes", "exportar", "excel"] } },
  {
    id: "analytics", path: "/analytics", roles: SOLO_ADMIN,
    component: lazy(() => import("@/pages/AnalyticsPage")), module: "analytics",
    // Consolidación 2026-08-27: KPIs, Reportes avanzados y Proyección de ventas
    // eran páginas propias compitiendo por ser el centro analítico. Ahora son
    // vistas de este workspace; el KPI Registry (ANA-001) va aparte.
    aliases: [
      { path: "/analytics-ia", redirectTo: "/analytics" },
      { path: "/kpi-dashboard", redirectTo: "/analytics?vista=tableros" },
      { path: "/bi-reportes", redirectTo: "/analytics?vista=cohortes" },
      { path: "/forecast", redirectTo: "/analytics?vista=pronostico" },
    ],
    status: "canonical",
    nav: { label: "Analytics", icon: BarChart3, group: "reportes", keywords: ["métricas", "estadísticas", "gráficos", "kpis", "indicadores", "objetivos", "metas", "bi", "business intelligence", "cohortes", "drilldown", "forecast", "pronóstico", "cuánto voy a vender"] },
  },
  {
    id: "ia", path: "/ia", roles: SOLO_ADMIN,
    component: lazy(() => import("@/pages/IntelligencePage")), module: "analytics",
    // Consolidación 2026-08-27: Insights y Asistente eran dos páginas de IA
    // genéricas con entrada propia. Los copilotos de dominio viven en su
    // dominio; lo transversal vive acá.
    aliases: [
      { path: "/chat-ia", redirectTo: "/ia?vista=asistente" },
      { path: "/chat-ia-avanzado", redirectTo: "/ia?vista=asistente" },
    ],
    status: "canonical",
    nav: { label: "Inteligencia", icon: Sparkles, group: "reportes", keywords: ["inteligencia artificial", "sugerencias", "análisis", "chat", "preguntar", "copiloto", "asistente"] },
  },
  { id: "alertas", path: "/alertas", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/SmartAlertsPage")), module: null, openReason: "Avisos derivados de otros modulos: ocultarlos dejaria al usuario sin enterarse de lo que si puede ver.", aliases: [{ path: "/alertas-inteligentes", redirectTo: "/alertas" }], status: "canonical", nav: { label: "Alertas", icon: AlertTriangle, group: "sistema", keywords: ["avisos", "notificaciones", "reglas"] } },
  { id: "integraciones", path: "/integraciones", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/IntegrationsPage")), module: "settings", aliases: [{ path: "/api-keys", redirectTo: "/integraciones?tab=apikeys" }, { path: "/webhooks", redirectTo: "/integraciones?tab=webhooks" }], status: "canonical", nav: { label: "Integraciones", icon: Plug, group: "sistema", keywords: ["api", "mercadolibre", "mercadopago", "conectar", "webhooks"] } },
  { id: "equipo", path: "/equipo", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/TeamPage")), module: "team", status: "canonical", nav: { label: "Equipo", icon: Users, group: "sistema", keywords: ["usuarios", "permisos", "empleados", "invitar"] } },
  { id: "ajustes", path: "/ajustes", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/SettingsPage")), module: "settings", status: "canonical", nav: { label: "Ajustes", icon: Settings, group: "sistema", keywords: ["configuración", "preferencias", "datos del negocio"] } },
  { id: "perfil", path: "/perfil", roles: AMBOS, component: lazy(() => import("@/pages/ProfilePage")), module: null, openReason: "Perfil del propio usuario.", status: "canonical", nav: { label: "Mi perfil", icon: UserCircle, group: "sistema", keywords: ["cuenta", "contraseña", "2fa"] } },
  { id: "admin", path: "/admin", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/AdminPage")), module: "settings", aliases: [{ path: "/actividad", redirectTo: "/admin?tab=activity" }, { path: "/auditoria", redirectTo: "/admin?tab=audit" }], status: "canonical", nav: { label: "Admin", icon: Crown, group: "sistema", keywords: ["administración", "organización", "suscripción"] } },
  { id: "calidad_datos", path: "/calidad-datos", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/DataQualityPage")), module: "products", status: "canonical", nav: { label: "Calidad de datos", icon: ScanSearch, group: "sistema", keywords: ["identidad", "sku", "ean", "duplicados", "completitud", "data quality"] } },
  { id: "libro", path: "/libro", roles: SOLO_ADMIN, component: lazy(() => import("@/pages/LibroPage")), module: "finance", status: "canonical", nav: { label: "Libro mayor", icon: BookOpen, group: "finanzas", keywords: ["ledger", "asientos", "contabilidad", "resultado", "libro"] } },
];

/**
 * Rutas públicas. Van aparte porque no tienen módulo de permisos ni sidebar:
 * las abre alguien sin sesión.
 */
export const PUBLIC_ROUTES: RouteDefinition[] = [
  {
    id: "precios",
    path: "/precios",
    roles: PUBLICO,
    component: lazy(() => import("@/pages/PricingPage")),
    module: null,
    openReason: "Pagina publica de precios: la abre alguien sin sesion.",
    // `/pricing` renderizaba la MISMA pagina en paralelo. Dos URLs canonicas
    // para lo mismo parten el SEO y la telemetria; ahora una redirige.
    aliases: [{ path: "/pricing", redirectTo: "/precios" }],
    status: "canonical",
  },
  { id: "login", path: "/login", roles: PUBLICO, module: null,
    openReason: "Entrada al sistema: la abre alguien que todavia no tiene sesion.",
    status: "canonical" },
  { id: "reset_password", path: "/reset-password", roles: PUBLICO, module: null,
    component: lazy(() => import("@/pages/ResetPasswordPage")),
    openReason: "Recuperar la clave no puede exigir estar adentro.",
    status: "canonical" },
  { id: "privacidad", path: "/privacidad", roles: PUBLICO, module: null,
    component: lazy(() => import("@/pages/PrivacyPage")),
    openReason: "Texto legal publico: la ley pide que sea accesible sin cuenta.",
    status: "canonical" },
  { id: "terminos", path: "/terminos", roles: PUBLICO, module: null,
    component: lazy(() => import("@/pages/TermsPage")),
    openReason: "Texto legal publico: la ley pide que sea accesible sin cuenta.",
    status: "canonical" },
  { id: "estado", path: "/estado", roles: PUBLICO, module: null,
    component: lazy(() => import("@/pages/ServiceStatusPage")),
    openReason: "Estado del servicio: si hay una caida tiene que verse sin sesion.",
    status: "canonical" },
];

/**
 * Rutas de negocio alcanzables por URL que **no** salen en el sidebar. Van
 * declaradas igual: sin entrada acá no tendrian modulo de permisos, que es
 * como estuvieron hasta el 2026-08-26.
 */
export const INTERNAL_ROUTES: RouteDefinition[] = [
  { id: "caja_turno", path: "/caja/turno", roles: AMBOS,
    component: lazy(() => import("@/pages/CashSessionPage")),
    module: "pos", status: "internal" },
  { id: "onboarding", path: "/onboarding", roles: AMBOS,
    component: lazy(() => import("@/pages/OnboardingPage")),
    module: null,
    openReason: "Corre antes de que la organizacion tenga permisos configurados.",
    status: "internal" },
];

const TODAS = [...ROUTES, ...INTERNAL_ROUTES, ...PUBLIC_ROUTES];

/** Módulo de permisos de una ruta. Sin fallback: lo que no está, no existe. */
export function moduleForPath(path: string): PermissionModule | "" {
  const ruta = TODAS.find(r => r.path === path);
  return ruta?.module ?? "";
}

/** `{ alias → canónica }`, para generar los redirects en un solo lugar. */
export function aliasRedirects(): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const ruta of TODAS) {
    for (const alias of ruta.aliases ?? []) mapa[alias.path] = alias.redirectTo;
  }
  return mapa;
}

/** Todas las rutas declaradas, incluidas las que no salen en el sidebar. */
export function allRoutes(): RouteDefinition[] {
  return TODAS;
}

/** Las rutas que el sidebar muestra, en el orden declarado. */
export function navRoutes(): RouteDefinition[] {
  return ROUTES.filter(r => r.nav && r.status === "canonical");
}

/**
 * Las rutas que monta `ProtectedRoutes`, ya filtradas por rol.
 *
 * El filtro vive acá y no en un `{isAdmin && ...}` del router porque estaban en
 * los dos lados y divergieron: `/tareas`, `/seguimiento`, `/calendario`,
 * `/envios` y `/perfil` figuraban en el menú de un vendedor y no se montaban,
 * así que el clic lo rebotaba al dashboard.
 */
export function businessRoutes(role: NavRole): RouteDefinition[] {
  return [...ROUTES, ...INTERNAL_ROUTES]
    .filter(r => r.component && r.roles.includes(role));
}

/** Los alias de negocio, como pares `[url vieja, destino]`. */
export function businessAliases(): Array<[string, string]> {
  return [...ROUTES, ...INTERNAL_ROUTES]
    .flatMap(r => (r.aliases ?? []).map(a => [a.path, a.redirectTo] as [string, string]));
}

/** Las rutas públicas con página propia. */
export function publicPages(): RouteDefinition[] {
  return PUBLIC_ROUTES.filter(r => r.component);
}

/** Los alias públicos, como pares `[url vieja, destino]`. */
export function publicAliases(): Array<[string, string]> {
  return PUBLIC_ROUTES
    .flatMap(r => (r.aliases ?? []).map(a => [a.path, a.redirectTo] as [string, string]));
}
