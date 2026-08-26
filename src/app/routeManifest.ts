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
 * `App.tsx` todavía declara sus `<Route>` a mano; el test
 * `routeManifest.test.ts` verifica que no se separen. Generar el router desde
 * este archivo es el paso siguiente, y se hace con las guardas ya puestas —
 * no antes.
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
import type { PermissionModule } from "@/lib/permissionModules";

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
  roles: NavRole[];
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

export const ROUTES: RouteDefinition[] = [
  { id: "inicio", path: "/", module: null, openReason: "Inicio: sin dashboard no hay desde dónde entrar a nada.", aliases: [{ path: "/landing", redirectTo: "/" }, { path: "/recomendaciones-ia", redirectTo: "/" }], status: "canonical", nav: { label: "Inicio", icon: LayoutDashboard, roles: AMBOS, group: "diario", keywords: ["dashboard", "resumen", "home", "panel"] } },
  { id: "caja", path: "/caja", module: "pos", status: "canonical", nav: { label: "Vender", icon: ScanLine, roles: AMBOS, group: "diario", keywords: ["pos", "caja", "mostrador", "cobrar", "ticket", "punto de venta"] } },
  { id: "ventas", path: "/ventas", module: "sales", status: "canonical", nav: { label: "Ventas", icon: DollarSign, roles: AMBOS, group: "diario", keywords: ["facturación", "vendido", "pedidos"] } },
  { id: "productos", path: "/productos", module: "products", status: "canonical", nav: { label: "Productos", icon: Package, roles: SOLO_ADMIN, group: "diario", keywords: ["stock", "catálogo", "precios", "artículos", "mercadería"] } },
  { id: "clientes", path: "/clientes", module: "customers", status: "canonical", nav: { label: "Clientes", icon: Users, roles: AMBOS, group: "diario", keywords: ["crm", "compradores", "contactos", "fichas"] } },
  { id: "tienda_online", path: "/tienda-online", module: "ecommerce", status: "canonical", nav: { label: "Tienda online", icon: ShoppingBag, roles: SOLO_ADMIN, group: "diario", keywords: ["ecommerce", "web", "vitrina", "storefront", "pedidos online"] } },
  { id: "tareas", path: "/tareas", module: null, openReason: "Tareas del propio usuario, no datos del negocio.", status: "canonical", nav: { label: "Tareas", icon: CheckSquare, roles: AMBOS, group: "trabajo", keywords: ["pendientes", "to do", "kanban"] } },
  { id: "seguimiento", path: "/seguimiento", module: "customers", status: "canonical", nav: { label: "Seguimientos", icon: Bell, roles: AMBOS, group: "trabajo", keywords: ["recordatorios", "follow up", "llamar"] } },
  { id: "calendario", path: "/calendario", module: null, openReason: "Agenda propia del usuario.", status: "canonical", nav: { label: "Calendario", icon: Calendar, roles: AMBOS, group: "trabajo", keywords: ["agenda", "fechas", "turnos"] } },
  { id: "compras", path: "/compras", module: "purchases", status: "canonical", nav: { label: "Compras", icon: ShoppingCart, roles: SOLO_ADMIN, group: "compras", keywords: ["importación", "ingreso de mercadería", "proveedor"] } },
  { id: "ordenes_compra", path: "/ordenes-compra", module: "purchases", aliases: [{ path: "/cotizaciones-proveedor", redirectTo: "/ordenes-compra" }, { path: "/solicitudes-compra", redirectTo: "/ordenes-compra" }], status: "canonical", nav: { label: "Órdenes de compra", icon: ClipboardList, roles: SOLO_ADMIN, group: "compras", keywords: ["oc", "pedido a proveedor", "recepción"] } },
  { id: "proveedores", path: "/proveedores", module: "purchases", status: "canonical", nav: { label: "Proveedores", icon: Truck, roles: SOLO_ADMIN, group: "compras", keywords: ["suppliers", "a quién le compro"] } },
  { id: "restock", path: "/restock", module: "inventory", status: "canonical", nav: { label: "Reposición automática", icon: RefreshCw, roles: SOLO_ADMIN, group: "compras", keywords: ["restock", "qué reponer", "sugerencias de compra"] } },
  { id: "kardex", path: "/kardex", module: "inventory", aliases: [{ path: "/toma-fisica", redirectTo: "/kardex" }], status: "canonical", nav: { label: "Movimientos de stock", icon: History, roles: SOLO_ADMIN, group: "compras", keywords: ["kardex", "historial de stock", "entradas y salidas", "ajustes"] } },
  { id: "transferencias", path: "/transferencias", module: "inventory", status: "canonical", nav: { label: "Transferencias", icon: ArrowRightLeft, roles: SOLO_ADMIN, group: "compras", keywords: ["mover stock", "entre sucursales", "depósitos"] } },
  { id: "sucursales", path: "/sucursales", module: "inventory", aliases: [{ path: "/franquicias", redirectTo: "/sucursales" }, { path: "/multi-deposito", redirectTo: "/sucursales" }], status: "canonical", nav: { label: "Sucursales y depósitos", icon: Warehouse, roles: SOLO_ADMIN, group: "compras", keywords: ["locales", "puntos de venta", "almacén", "multi tienda"] } },
  { id: "lotes", path: "/lotes", module: "inventory", status: "canonical", nav: { label: "Lotes y vencimientos", icon: ScanBarcode, roles: SOLO_ADMIN, group: "compras", keywords: ["batch", "caducidad", "trazabilidad"] } },
  { id: "bundles", path: "/bundles", module: "products", status: "canonical", nav: { label: "Combos y kits", icon: Layers, roles: SOLO_ADMIN, group: "compras", keywords: ["bundles", "packs", "promo pack"] } },
  { id: "listas_precios", path: "/listas-precios", module: "products", status: "canonical", nav: { label: "Listas de precios", icon: Tag, roles: SOLO_ADMIN, group: "compras", keywords: ["mayorista", "minorista", "precio por cliente"] } },
  { id: "valuacion_inventario", path: "/valuacion-inventario", module: "inventory", aliases: [{ path: "/inventario-aging", redirectTo: "/valuacion-inventario" }], status: "canonical", nav: { label: "Valuación de inventario", icon: Layers, roles: SOLO_ADMIN, group: "compras", keywords: ["cuánto vale el stock", "fifo", "costo promedio"] } },
  { id: "inventario_inteligente", path: "/inventario-inteligente", module: "inventory", status: "canonical", nav: { label: "Inventario con IA", icon: Brain, roles: SOLO_ADMIN, group: "compras", keywords: ["sugerencias", "optimizar stock"] } },
  { id: "forecast_inventario", path: "/forecast-inventario", module: "inventory", status: "canonical", nav: { label: "Proyección de stock", icon: TrendingUp, roles: SOLO_ADMIN, group: "compras", keywords: ["forecast", "cuánto voy a necesitar", "quiebre de stock"] } },
  { id: "deudas", path: "/deudas", module: "sales", status: "canonical", nav: { label: "Deudas", icon: AlertCircle, roles: SOLO_ADMIN, group: "cobranzas", keywords: ["me deben", "cuentas por cobrar", "fiado", "moroso"] } },
  { id: "cuotas", path: "/cuotas", module: "sales", status: "canonical", nav: { label: "Cuotas", icon: CreditCard, roles: SOLO_ADMIN, group: "cobranzas", keywords: ["financiación", "plan de pago", "vencimientos"] } },
  { id: "presupuestos", path: "/presupuestos", module: "sales", status: "canonical", nav: { label: "Presupuestos", icon: ClipboardList, roles: SOLO_ADMIN, group: "cobranzas", keywords: ["cotización", "quotes", "proforma"] } },
  { id: "facturas", path: "/facturas", module: "invoices", status: "canonical", nav: { label: "Facturas", icon: FileText, roles: SOLO_ADMIN, group: "cobranzas", keywords: ["comprobantes", "invoices"] } },
  { id: "devoluciones", path: "/devoluciones", module: "sales", aliases: [{ path: "/devoluciones-rma", redirectTo: "/devoluciones" }], status: "canonical", nav: { label: "Devoluciones", icon: RotateCcw, roles: SOLO_ADMIN, group: "cobranzas", keywords: ["cambios", "rma", "reembolso"] } },
  { id: "envios", path: "/envios", module: "shipping", status: "canonical", nav: { label: "Envíos", icon: Truck, roles: AMBOS, group: "cobranzas", keywords: ["seguimiento", "tracking", "despacho", "correo", "andreani"] } },
  { id: "links_de_pago", path: "/links-de-pago", module: "payments", status: "canonical", nav: { label: "Links de pago", icon: Link2, roles: SOLO_ADMIN, group: "cobranzas", keywords: ["cobrar a distancia", "link mercadopago"] } },
  { id: "mi_plan", path: "/mi-plan", module: "settings", status: "canonical", nav: { label: "Mi plan", icon: CreditCard, roles: SOLO_ADMIN, group: "sistema", keywords: ["suscripcion", "plan", "pagar", "mercadopago", "facturacion", "abono"] } },
  { id: "billetera", path: "/billetera", module: "finance", status: "canonical", nav: { label: "Billetera", icon: Wallet, roles: SOLO_ADMIN, group: "finanzas", keywords: ["saldo", "plata", "retirar", "retiro", "cobros", "disponible", "acreditado", "cbu"] } },
  { id: "gastos", path: "/gastos", module: "expenses", status: "canonical", nav: { label: "Gastos", icon: Wallet, roles: SOLO_ADMIN, group: "finanzas", keywords: ["egresos", "pagos", "costos fijos"] } },
  { id: "cash_flow", path: "/cash-flow", module: "finance", status: "canonical", nav: { label: "Flujo de caja", icon: BarChart3, roles: SOLO_ADMIN, group: "finanzas", keywords: ["cash flow", "proyección de plata", "liquidez"] } },
  { id: "pl_dashboard", path: "/pl-dashboard", module: "finance", aliases: [{ path: "/escenarios-financieros", redirectTo: "/pl-dashboard" }], status: "canonical", nav: { label: "Ganancias y pérdidas", icon: TrendingUp, roles: SOLO_ADMIN, group: "finanzas", keywords: ["p&l", "pl", "resultado", "rentabilidad", "estado de resultados"] } },
  { id: "banco", path: "/banco", module: "finance", status: "canonical", nav: { label: "Banco y conciliación", icon: Landmark, roles: SOLO_ADMIN, group: "finanzas", keywords: ["conciliar", "extracto", "movimientos bancarios"] } },
  { id: "movimientos", path: "/movimientos", module: "payments", status: "canonical", nav: { label: "Movimientos operativos", icon: BookOpen, roles: SOLO_ADMIN, group: "finanzas", keywords: ["libro mayor", "movimientos", "caja", "asientos", "financial movements"] } },
  { id: "cheques", path: "/cheques", module: "finance", status: "canonical", nav: { label: "Cheques", icon: FileText, roles: SOLO_ADMIN, group: "finanzas", keywords: ["echeq", "valores", "cartera"] } },
  { id: "comisiones", path: "/comisiones", module: "finance", status: "canonical", nav: { label: "Comisiones", icon: Receipt, roles: SOLO_ADMIN, group: "finanzas", keywords: ["vendedores", "aranceles", "mercadopago"] } },
  { id: "impuestos", path: "/impuestos", module: "finance", status: "canonical", nav: { label: "Impuestos", icon: Scale, roles: SOLO_ADMIN, group: "finanzas", keywords: ["iva", "ingresos brutos", "retenciones", "arca"] } },
  { id: "afip", path: "/afip", module: "invoices", status: "canonical", nav: { label: "AFIP y factura electrónica", icon: Shield, roles: SOLO_ADMIN, group: "finanzas", keywords: ["arca", "cae", "facturar", "wsfe", "monotributo"] } },
  { id: "multi_divisa", path: "/multi-divisa", module: "finance", aliases: [{ path: "/tipo-cambio", redirectTo: "/multi-divisa" }], status: "canonical", nav: { label: "Multi-divisa", icon: DollarSign, roles: SOLO_ADMIN, group: "finanzas", keywords: ["dólar", "tipo de cambio", "fx", "cotización"] } },
  { id: "suscripciones", path: "/suscripciones", module: "finance", status: "canonical", nav: { label: "Suscripciones", icon: CreditCard, roles: SOLO_ADMIN, group: "finanzas", keywords: ["abonos", "cobro recurrente", "membresías"] } },
  { id: "marketing", path: "/marketing", module: "marketing", aliases: [{ path: "/automatizaciones", redirectTo: "/marketing" }, { path: "/combos-banners", redirectTo: "/marketing" }, { path: "/marca-ia", redirectTo: "/marketing" }, { path: "/templates", redirectTo: "/marketing" }], status: "canonical", nav: { label: "Campañas", icon: Megaphone, roles: SOLO_ADMIN, group: "marketing", keywords: ["marketing", "publicidad", "anuncios"] } },
  { id: "cupones", path: "/cupones", module: "marketing", status: "canonical", nav: { label: "Cupones", icon: Tag, roles: SOLO_ADMIN, group: "marketing", keywords: ["descuentos", "códigos", "promo"] } },
  { id: "promociones", path: "/promociones", module: "marketing", status: "canonical", nav: { label: "Promociones", icon: Zap, roles: SOLO_ADMIN, group: "marketing", keywords: ["ofertas", "flash sale", "2x1", "liquidación"] } },
  { id: "email_campaigns", path: "/email-campaigns", module: "marketing", aliases: [{ path: "/secuencias-email", redirectTo: "/email-campaigns" }], status: "canonical", nav: { label: "Email", icon: Mail, roles: SOLO_ADMIN, group: "marketing", keywords: ["newsletter", "mailing", "correo masivo"] } },
  { id: "whatsapp_campaigns", path: "/whatsapp-campaigns", module: "marketing", status: "canonical", nav: { label: "WhatsApp", icon: MessageCircle, roles: SOLO_ADMIN, group: "marketing", keywords: ["difusión", "wsp", "mensajes masivos"] } },
  { id: "fidelidad", path: "/fidelidad", module: "marketing", aliases: [{ path: "/fidelidad-avanzada", redirectTo: "/fidelidad" }], status: "canonical", nav: { label: "Fidelidad", icon: Star, roles: SOLO_ADMIN, group: "marketing", keywords: ["puntos", "recompensas", "loyalty", "clientes frecuentes"] } },
  { id: "canjes", path: "/canjes", module: "influencers", aliases: [{ path: "/liquidaciones", redirectTo: "/canjes" }], status: "canonical", nav: { label: "Canjes con influencers", icon: Gift, roles: SOLO_ADMIN, group: "marketing", keywords: ["regalos", "colaboraciones", "prensa"] } },
  { id: "influencers", path: "/influencers", module: "influencers", status: "canonical", nav: { label: "Influencers", icon: Users2, roles: SOLO_ADMIN, group: "marketing", keywords: ["creadores", "instagram", "tiktok"] } },
  { id: "afiliados", path: "/afiliados", module: "marketing", status: "canonical", nav: { label: "Afiliados", icon: UserPlus, roles: SOLO_ADMIN, group: "marketing", keywords: ["comisión por venta", "partners"] } },
  { id: "referidos", path: "/referidos", module: "marketing", status: "canonical", nav: { label: "Referidos", icon: Trophy, roles: SOLO_ADMIN, group: "marketing", keywords: ["recomendaciones", "traé un amigo"] } },
  { id: "planner_social", path: "/planner-social", module: "marketing", status: "canonical", nav: { label: "Planner de redes", icon: Share2, roles: SOLO_ADMIN, group: "marketing", keywords: ["calendario de contenido", "posteos", "instagram"] } },
  { id: "catalogo", path: "/catalogo", module: "marketing", status: "canonical", nav: { label: "Catálogo por WhatsApp", icon: BookOpen, roles: SOLO_ADMIN, group: "marketing", keywords: ["lista de precios", "compartir productos", "pdf"] } },
  { id: "reportes", path: "/reportes", module: "reports", status: "canonical", nav: { label: "Reportes", icon: TrendingUp, roles: SOLO_ADMIN, group: "reportes", keywords: ["informes", "exportar", "excel"] } },
  { id: "analytics", path: "/analytics", module: "analytics", aliases: [{ path: "/analytics-ia", redirectTo: "/analytics" }], status: "canonical", nav: { label: "Analytics", icon: BarChart3, roles: SOLO_ADMIN, group: "reportes", keywords: ["métricas", "estadísticas", "gráficos"] } },
  { id: "kpi_dashboard", path: "/kpi-dashboard", module: "analytics", status: "canonical", nav: { label: "KPIs", icon: LineChart, roles: SOLO_ADMIN, group: "reportes", keywords: ["indicadores", "objetivos", "metas"] } },
  { id: "bi_reportes", path: "/bi-reportes", module: "reports", status: "canonical", nav: { label: "Reportes avanzados", icon: BarChart3, roles: SOLO_ADMIN, group: "reportes", keywords: ["bi", "business intelligence", "cohortes", "drilldown"] } },
  { id: "forecast", path: "/forecast", module: "analytics", status: "canonical", nav: { label: "Proyección de ventas", icon: TrendingUp, roles: SOLO_ADMIN, group: "reportes", keywords: ["forecast", "cuánto voy a vender", "pronóstico"] } },
  { id: "rfm", path: "/rfm", module: "customers", aliases: [{ path: "/lead-scoring", redirectTo: "/rfm" }, { path: "/segmentos", redirectTo: "/rfm" }], status: "canonical", nav: { label: "Segmentación de clientes", icon: Users, roles: SOLO_ADMIN, group: "reportes", keywords: ["rfm", "quién compra más", "recencia", "segmentos"] } },
  { id: "crm_avanzado", path: "/crm-avanzado", module: "crm", aliases: [{ path: "/pipeline", redirectTo: "/crm-avanzado" }], status: "canonical", nav: { label: "Pipeline de ventas", icon: Kanban, roles: SOLO_ADMIN, group: "reportes", keywords: ["embudo", "oportunidades", "negocios", "crm avanzado"] } },
  { id: "ia", path: "/ia", module: "analytics", status: "canonical", nav: { label: "Insights con IA", icon: Sparkles, roles: SOLO_ADMIN, group: "reportes", keywords: ["inteligencia artificial", "sugerencias", "análisis"] } },
  { id: "chat_ia", path: "/chat-ia", module: "analytics", aliases: [{ path: "/chat-ia-avanzado", redirectTo: "/chat-ia" }], status: "canonical", nav: { label: "Asistente IA", icon: Brain, roles: SOLO_ADMIN, group: "sistema", keywords: ["chat", "preguntar", "copiloto"] } },
  { id: "alertas", path: "/alertas", module: null, openReason: "Avisos derivados de otros modulos: ocultarlos dejaria al usuario sin enterarse de lo que si puede ver.", aliases: [{ path: "/alertas-inteligentes", redirectTo: "/alertas" }], status: "canonical", nav: { label: "Alertas", icon: AlertTriangle, roles: SOLO_ADMIN, group: "sistema", keywords: ["avisos", "notificaciones", "reglas"] } },
  { id: "integraciones", path: "/integraciones", module: "settings", aliases: [{ path: "/api-keys", redirectTo: "/integraciones?tab=apikeys" }, { path: "/webhooks", redirectTo: "/integraciones?tab=webhooks" }], status: "canonical", nav: { label: "Integraciones", icon: Plug, roles: SOLO_ADMIN, group: "sistema", keywords: ["api", "mercadolibre", "mercadopago", "conectar", "webhooks"] } },
  { id: "equipo", path: "/equipo", module: "team", status: "canonical", nav: { label: "Equipo", icon: Users, roles: SOLO_ADMIN, group: "sistema", keywords: ["usuarios", "permisos", "empleados", "invitar"] } },
  { id: "ajustes", path: "/ajustes", module: "settings", status: "canonical", nav: { label: "Ajustes", icon: Settings, roles: SOLO_ADMIN, group: "sistema", keywords: ["configuración", "preferencias", "datos del negocio"] } },
  { id: "perfil", path: "/perfil", module: null, openReason: "Perfil del propio usuario.", status: "canonical", nav: { label: "Mi perfil", icon: UserCircle, roles: AMBOS, group: "sistema", keywords: ["cuenta", "contraseña", "2fa"] } },
  { id: "admin", path: "/admin", module: "settings", aliases: [{ path: "/actividad", redirectTo: "/admin?tab=activity" }, { path: "/auditoria", redirectTo: "/admin?tab=audit" }], status: "canonical", nav: { label: "Admin", icon: Crown, roles: SOLO_ADMIN, group: "sistema", keywords: ["administración", "organización", "suscripción"] } },
  { id: "calidad_datos", path: "/calidad-datos", module: "products", status: "canonical", nav: { label: "Calidad de datos", icon: ScanSearch, roles: SOLO_ADMIN, group: "sistema", keywords: ["identidad", "sku", "ean", "duplicados", "completitud", "data quality"] } },
  { id: "libro", path: "/libro", module: "finance", status: "canonical", nav: { label: "Libro mayor", icon: BookOpen, roles: SOLO_ADMIN, group: "finanzas", keywords: ["ledger", "asientos", "contabilidad", "resultado", "libro"] } },
];

/**
 * Rutas públicas. Van aparte porque no tienen módulo de permisos ni sidebar:
 * las abre alguien sin sesión.
 */
export const PUBLIC_ROUTES: RouteDefinition[] = [
  {
    id: "precios",
    path: "/precios",
    module: null,
    openReason: "Pagina publica de precios: la abre alguien sin sesion.",
    // `/pricing` renderizaba la MISMA pagina en paralelo. Dos URLs canonicas
    // para lo mismo parten el SEO y la telemetria; ahora una redirige.
    aliases: [{ path: "/pricing", redirectTo: "/precios" }],
    status: "canonical",
  },
  { id: "login", path: "/login", module: null,
    openReason: "Entrada al sistema: la abre alguien que todavia no tiene sesion.",
    status: "canonical" },
  { id: "reset_password", path: "/reset-password", module: null,
    openReason: "Recuperar la clave no puede exigir estar adentro.",
    status: "canonical" },
  { id: "onboarding", path: "/onboarding", module: null,
    openReason: "Corre antes de que la organizacion tenga permisos configurados.",
    status: "canonical" },
  { id: "privacidad", path: "/privacidad", module: null,
    openReason: "Texto legal publico: la ley pide que sea accesible sin cuenta.",
    status: "canonical" },
  { id: "terminos", path: "/terminos", module: null,
    openReason: "Texto legal publico: la ley pide que sea accesible sin cuenta.",
    status: "canonical" },
  { id: "estado", path: "/estado", module: null,
    openReason: "Estado del servicio: si hay una caida tiene que verse sin sesion.",
    status: "canonical" },
];

/**
 * Rutas de negocio alcanzables por URL que **no** salen en el sidebar. Van
 * declaradas igual: sin entrada acá no tendrian modulo de permisos, que es
 * como estuvieron hasta el 2026-08-26.
 */
export const INTERNAL_ROUTES: RouteDefinition[] = [
  { id: "caja_turno", path: "/caja/turno", module: "pos", status: "internal" },
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
