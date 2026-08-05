/**
 * Arquitectura de navegación — fuente única.
 *
 * ── El problema que resuelve ──────────────────────────────────────────────
 *
 * El sidebar tenía **67 destinos en 8 secciones, todas abiertas**, y todos con
 * el mismo peso visual. Eso no es una navegación: es un índice. Mirando los
 * datos reales de la organización, diez módulos sostienen el negocio entero
 * —productos (60 filas), ventas (34), clientes (26), canjes (14), órdenes de la
 * tienda (6), deudas, gastos, cupones— y **veinticuatro estaban en cero**:
 * compras, presupuestos, caja, tareas, listas de precios, promociones,
 * fidelidad, campañas, cheques, banco, multi-divisa, lotes, transferencias…
 *
 * Darle a "Multi-Divisa FX" el mismo tamaño que a "Productos" enseña a ignorar
 * el sidebar entero. Y cuando el usuario deja de leer el menú, la única salida
 * que le queda es buscar — que es justamente lo que no existía.
 *
 * ── Las tres decisiones ───────────────────────────────────────────────────
 *
 * **1. Jerarquía por uso, no por catálogo.** Seis destinos `diario` quedan
 * siempre a la vista, sin encabezado. El resto vive en grupos que arrancan
 * cerrados salvo el que contiene la página actual.
 *
 * **2. Lenguaje de tarea, no de jerga.** "Kardex" pasa a "Movimientos de
 * stock"; "Libro Mayor" a "Libro mayor" dentro de Finanzas; "RFM" a
 * "Segmentación de clientes". El comercio piensa "¿cuánto stock tengo?", no
 * "Kardex".
 *
 * **3. Renombrar sólo es seguro si el buscador conoce el nombre viejo.** Por eso
 * cada item lleva `keywords` con la jerga anterior y con cómo lo diría alguien
 * que no conoce el sistema. Quien escriba "kardex", "P&L" o "pos" llega igual.
 *
 * Ningún destino se eliminó: los 67 siguen alcanzables, y todos por el buscador.
 */
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, ScanLine, DollarSign, Package, Users, ShoppingBag,
  ShoppingCart, ClipboardList, Truck, RefreshCw, History, ArrowRightLeft,
  Warehouse, ScanBarcode, Layers, Tag, Brain, TrendingUp,
  AlertCircle, CreditCard, FileText, RotateCcw, Link2,
  Wallet, Landmark, BookOpen, Receipt, BarChart3, Scale, Shield,
  Megaphone, Gift, Users2, Mail, MessageCircle, Share2, Zap, UserPlus,
  Trophy, Star, LineChart, Sparkles, Kanban,
  CheckSquare, Bell, Calendar,
  AlertTriangle, Plug, Settings, UserCircle, Crown,
} from "lucide-react";

/**
 * Los mismos roles que `AppRole`. `viewer` se incluye para que el tipo cierre,
 * pero **ningún item lo lista** — que es como estaba antes de esta
 * reorganización, y significa que hoy un usuario con rol `viewer` ve el sidebar
 * vacío. No se cambió acá a propósito: qué puede ver un viewer es una decisión
 * de permisos, no de navegación.
 */
export type NavRole = "admin" | "vendedor" | "viewer";

export interface NavItem {
  to: string;
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

export type NavGroupId =
  | "diario" | "trabajo" | "compras" | "cobranzas"
  | "finanzas" | "marketing" | "reportes" | "sistema";

export interface NavGroup {
  id: NavGroupId;
  /** Vacío = sin encabezado; los items se muestran sueltos arriba de todo. */
  label: string;
  /** Ayuda de una línea, para el buscador y la vista de todas las herramientas. */
  hint: string;
}

export const NAV_GROUPS: NavGroup[] = [
  { id: "diario",    label: "",            hint: "Lo de todos los días" },
  { id: "trabajo",   label: "Mi trabajo",  hint: "Tareas, seguimientos y calendario" },
  { id: "compras",   label: "Compras y stock", hint: "Reponer, mover y controlar la mercadería" },
  { id: "cobranzas", label: "Cobranzas",   hint: "Lo que falta cobrar y los documentos de venta" },
  { id: "finanzas",  label: "Finanzas",    hint: "Plata que entra, plata que sale e impuestos" },
  { id: "marketing", label: "Marketing",   hint: "Traer y retener compradores" },
  { id: "reportes",  label: "Reportes",    hint: "Ver cómo viene el negocio" },
  { id: "sistema",   label: "Sistema",     hint: "Configuración, equipo e integraciones" },
];

const AMBOS: NavRole[] = ["admin", "vendedor"];
const SOLO_ADMIN: NavRole[] = ["admin"];

export const NAV_ITEMS: NavItem[] = [
  // ── Diario: lo que se toca todos los días ────────────────────────────────
  // Son los seis módulos con datos reales más el POS. Van sin encabezado y
  // siempre visibles: si hay que abrir un grupo para vender, el menú estorba.
  { to: "/", label: "Inicio", icon: LayoutDashboard, roles: AMBOS, group: "diario",
    keywords: ["dashboard", "resumen", "home", "panel"] },
  { to: "/caja", label: "Vender", icon: ScanLine, roles: AMBOS, group: "diario",
    keywords: ["pos", "caja", "mostrador", "cobrar", "ticket", "punto de venta"] },
  { to: "/ventas", label: "Ventas", icon: DollarSign, roles: AMBOS, group: "diario",
    keywords: ["facturación", "vendido", "pedidos"] },
  { to: "/productos", label: "Productos", icon: Package, roles: SOLO_ADMIN, group: "diario",
    keywords: ["stock", "catálogo", "precios", "artículos", "mercadería"] },
  { to: "/clientes", label: "Clientes", icon: Users, roles: AMBOS, group: "diario",
    keywords: ["crm", "compradores", "contactos", "fichas"] },
  { to: "/tienda-online", label: "Tienda online", icon: ShoppingBag, roles: SOLO_ADMIN, group: "diario",
    keywords: ["ecommerce", "web", "vitrina", "storefront", "pedidos online"] },

  // ── Mi trabajo ───────────────────────────────────────────────────────────
  { to: "/tareas", label: "Tareas", icon: CheckSquare, roles: AMBOS, group: "trabajo",
    keywords: ["pendientes", "to do", "kanban"] },
  { to: "/seguimiento", label: "Seguimientos", icon: Bell, roles: AMBOS, group: "trabajo",
    keywords: ["recordatorios", "follow up", "llamar"] },
  { to: "/calendario", label: "Calendario", icon: Calendar, roles: AMBOS, group: "trabajo",
    keywords: ["agenda", "fechas", "turnos"] },

  // ── Compras y stock ──────────────────────────────────────────────────────
  { to: "/compras", label: "Compras", icon: ShoppingCart, roles: SOLO_ADMIN, group: "compras",
    keywords: ["importación", "ingreso de mercadería", "proveedor"] },
  { to: "/ordenes-compra", label: "Órdenes de compra", icon: ClipboardList, roles: SOLO_ADMIN, group: "compras",
    keywords: ["oc", "pedido a proveedor", "recepción"] },
  { to: "/proveedores", label: "Proveedores", icon: Truck, roles: SOLO_ADMIN, group: "compras",
    keywords: ["suppliers", "a quién le compro"] },
  { to: "/restock", label: "Reposición automática", icon: RefreshCw, roles: SOLO_ADMIN, group: "compras",
    keywords: ["restock", "qué reponer", "sugerencias de compra"] },
  { to: "/kardex", label: "Movimientos de stock", icon: History, roles: SOLO_ADMIN, group: "compras",
    keywords: ["kardex", "historial de stock", "entradas y salidas", "ajustes"] },
  { to: "/transferencias", label: "Transferencias", icon: ArrowRightLeft, roles: SOLO_ADMIN, group: "compras",
    keywords: ["mover stock", "entre sucursales", "depósitos"] },
  { to: "/sucursales", label: "Sucursales y depósitos", icon: Warehouse, roles: SOLO_ADMIN, group: "compras",
    keywords: ["locales", "puntos de venta", "almacén", "multi tienda"] },
  { to: "/lotes", label: "Lotes y vencimientos", icon: ScanBarcode, roles: SOLO_ADMIN, group: "compras",
    keywords: ["batch", "caducidad", "trazabilidad"] },
  { to: "/bundles", label: "Combos y kits", icon: Layers, roles: SOLO_ADMIN, group: "compras",
    keywords: ["bundles", "packs", "promo pack"] },
  { to: "/listas-precios", label: "Listas de precios", icon: Tag, roles: SOLO_ADMIN, group: "compras",
    keywords: ["mayorista", "minorista", "precio por cliente"] },
  { to: "/valuacion-inventario", label: "Valuación de inventario", icon: Layers, roles: SOLO_ADMIN, group: "compras",
    keywords: ["cuánto vale el stock", "fifo", "costo promedio"] },
  { to: "/inventario-inteligente", label: "Inventario con IA", icon: Brain, roles: SOLO_ADMIN, group: "compras",
    keywords: ["sugerencias", "optimizar stock"] },
  { to: "/forecast-inventario", label: "Proyección de stock", icon: TrendingUp, roles: SOLO_ADMIN, group: "compras",
    keywords: ["forecast", "cuánto voy a necesitar", "quiebre de stock"] },

  // ── Cobranzas ────────────────────────────────────────────────────────────
  { to: "/deudas", label: "Deudas", icon: AlertCircle, roles: SOLO_ADMIN, group: "cobranzas",
    keywords: ["me deben", "cuentas por cobrar", "fiado", "moroso"] },
  { to: "/cuotas", label: "Cuotas", icon: CreditCard, roles: SOLO_ADMIN, group: "cobranzas",
    keywords: ["financiación", "plan de pago", "vencimientos"] },
  { to: "/presupuestos", label: "Presupuestos", icon: ClipboardList, roles: SOLO_ADMIN, group: "cobranzas",
    keywords: ["cotización", "quotes", "proforma"] },
  { to: "/facturas", label: "Facturas", icon: FileText, roles: SOLO_ADMIN, group: "cobranzas",
    keywords: ["comprobantes", "invoices"] },
  { to: "/devoluciones", label: "Devoluciones", icon: RotateCcw, roles: SOLO_ADMIN, group: "cobranzas",
    keywords: ["cambios", "rma", "reembolso"] },
  { to: "/envios", label: "Envíos", icon: Truck, roles: AMBOS, group: "cobranzas",
    keywords: ["seguimiento", "tracking", "despacho", "correo", "andreani"] },
  { to: "/links-de-pago", label: "Links de pago", icon: Link2, roles: SOLO_ADMIN, group: "cobranzas",
    keywords: ["cobrar a distancia", "link mercadopago"] },

  // ── Finanzas ─────────────────────────────────────────────────────────────
  { to: "/gastos", label: "Gastos", icon: Wallet, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["egresos", "pagos", "costos fijos"] },
  { to: "/cash-flow", label: "Flujo de caja", icon: BarChart3, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["cash flow", "proyección de plata", "liquidez"] },
  { to: "/pl-dashboard", label: "Ganancias y pérdidas", icon: TrendingUp, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["p&l", "pl", "resultado", "rentabilidad", "estado de resultados"] },
  { to: "/banco", label: "Banco y conciliación", icon: Landmark, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["conciliar", "extracto", "movimientos bancarios"] },
  { to: "/movimientos", label: "Libro mayor", icon: BookOpen, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["contabilidad", "asientos", "ledger"] },
  { to: "/cheques", label: "Cheques", icon: FileText, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["echeq", "valores", "cartera"] },
  { to: "/comisiones", label: "Comisiones", icon: Receipt, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["vendedores", "aranceles", "mercadopago"] },
  { to: "/impuestos", label: "Impuestos", icon: Scale, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["iva", "ingresos brutos", "retenciones", "arca"] },
  { to: "/afip", label: "AFIP y factura electrónica", icon: Shield, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["arca", "cae", "facturar", "wsfe", "monotributo"] },
  { to: "/multi-divisa", label: "Multi-divisa", icon: DollarSign, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["dólar", "tipo de cambio", "fx", "cotización"] },
  { to: "/suscripciones", label: "Suscripciones", icon: CreditCard, roles: SOLO_ADMIN, group: "finanzas",
    keywords: ["abonos", "cobro recurrente", "membresías"] },

  // ── Marketing ────────────────────────────────────────────────────────────
  { to: "/marketing", label: "Campañas", icon: Megaphone, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["marketing", "publicidad", "anuncios"] },
  { to: "/cupones", label: "Cupones", icon: Tag, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["descuentos", "códigos", "promo"] },
  { to: "/promociones", label: "Promociones", icon: Zap, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["ofertas", "flash sale", "2x1", "liquidación"] },
  { to: "/email-campaigns", label: "Email", icon: Mail, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["newsletter", "mailing", "correo masivo"] },
  { to: "/whatsapp-campaigns", label: "WhatsApp", icon: MessageCircle, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["difusión", "wsp", "mensajes masivos"] },
  { to: "/fidelidad", label: "Fidelidad", icon: Star, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["puntos", "recompensas", "loyalty", "clientes frecuentes"] },
  { to: "/canjes", label: "Canjes con influencers", icon: Gift, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["regalos", "colaboraciones", "prensa"] },
  { to: "/influencers", label: "Influencers", icon: Users2, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["creadores", "instagram", "tiktok"] },
  { to: "/afiliados", label: "Afiliados", icon: UserPlus, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["comisión por venta", "partners"] },
  { to: "/referidos", label: "Referidos", icon: Trophy, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["recomendaciones", "traé un amigo"] },
  { to: "/planner-social", label: "Planner de redes", icon: Share2, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["calendario de contenido", "posteos", "instagram"] },
  { to: "/catalogo", label: "Catálogo por WhatsApp", icon: BookOpen, roles: SOLO_ADMIN, group: "marketing",
    keywords: ["lista de precios", "compartir productos", "pdf"] },

  // ── Reportes ─────────────────────────────────────────────────────────────
  { to: "/reportes", label: "Reportes", icon: TrendingUp, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["informes", "exportar", "excel"] },
  { to: "/analytics", label: "Analytics", icon: BarChart3, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["métricas", "estadísticas", "gráficos"] },
  { to: "/kpi-dashboard", label: "KPIs", icon: LineChart, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["indicadores", "objetivos", "metas"] },
  { to: "/bi-reportes", label: "Reportes avanzados", icon: BarChart3, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["bi", "business intelligence", "cohortes", "drilldown"] },
  { to: "/forecast", label: "Proyección de ventas", icon: TrendingUp, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["forecast", "cuánto voy a vender", "pronóstico"] },
  { to: "/rfm", label: "Segmentación de clientes", icon: Users, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["rfm", "quién compra más", "recencia", "segmentos"] },
  { to: "/crm-avanzado", label: "Pipeline de ventas", icon: Kanban, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["embudo", "oportunidades", "negocios", "crm avanzado"] },
  { to: "/ia", label: "Insights con IA", icon: Sparkles, roles: SOLO_ADMIN, group: "reportes",
    keywords: ["inteligencia artificial", "sugerencias", "análisis"] },

  // ── Sistema ──────────────────────────────────────────────────────────────
  { to: "/chat-ia", label: "Asistente IA", icon: Brain, roles: SOLO_ADMIN, group: "sistema",
    keywords: ["chat", "preguntar", "copiloto"] },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle, roles: SOLO_ADMIN, group: "sistema",
    keywords: ["avisos", "notificaciones", "reglas"] },
  { to: "/integraciones", label: "Integraciones", icon: Plug, roles: SOLO_ADMIN, group: "sistema",
    keywords: ["api", "mercadolibre", "mercadopago", "conectar", "webhooks"] },
  { to: "/equipo", label: "Equipo", icon: Users, roles: SOLO_ADMIN, group: "sistema",
    keywords: ["usuarios", "permisos", "empleados", "invitar"] },
  { to: "/ajustes", label: "Ajustes", icon: Settings, roles: SOLO_ADMIN, group: "sistema",
    keywords: ["configuración", "preferencias", "datos del negocio"] },
  { to: "/perfil", label: "Mi perfil", icon: UserCircle, roles: AMBOS, group: "sistema",
    keywords: ["cuenta", "contraseña", "2fa"] },
  { to: "/admin", label: "Admin", icon: Crown, roles: SOLO_ADMIN, group: "sistema",
    keywords: ["administración", "organización", "suscripción"] },
];

/** Los que van siempre a la vista, sin encabezado ni plegado. */
export const ITEMS_DIARIOS = NAV_ITEMS.filter(i => i.group === "diario");

/** Los grupos plegables, en orden, ya sin el diario. */
export const GRUPOS_PLEGABLES = NAV_GROUPS.filter(g => g.id !== "diario");

export function itemsDe(group: NavGroupId): NavItem[] {
  return NAV_ITEMS.filter(i => i.group === group);
}

/** En qué grupo cae una ruta, para abrir el correcto al entrar. */
export function grupoDeRuta(path: string): NavGroupId | null {
  return NAV_ITEMS.find(i => i.to === path)?.group ?? null;
}

/**
 * Búsqueda para el paleta de comandos.
 *
 * Normaliza acentos en los dos lados: quien escribe "presupuesto" tiene que
 * encontrar lo mismo que quien escribe "presupuésto", y nadie pone tildes
 * cuando busca rápido.
 *
 * El orden importa más que el algoritmo: primero lo que empieza con lo tipeado,
 * después lo que lo contiene en el nombre, y al final lo que sólo coincide por
 * palabra clave. Así "ventas" no devuelve primero "Reportes" porque tiene
 * "ventas" en las keywords.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function buscarItems(consulta: string, roles?: NavRole): NavItem[] {
  const q = normalizar(consulta);
  const permitidos = roles ? NAV_ITEMS.filter(i => i.roles.includes(roles)) : NAV_ITEMS;
  if (!q) return permitidos;

  const puntaje = (i: NavItem): number => {
    const label = normalizar(i.label);
    if (label.startsWith(q)) return 0;
    if (label.includes(q)) return 1;
    if ((i.keywords ?? []).some(k => normalizar(k).startsWith(q))) return 2;
    if ((i.keywords ?? []).some(k => normalizar(k).includes(q))) return 3;
    return Infinity;
  };

  return permitidos
    .map(i => ({ i, p: puntaje(i) }))
    .filter(x => x.p !== Infinity)
    .sort((a, b) => a.p - b.p || a.i.label.localeCompare(b.i.label))
    .map(x => x.i);
}
