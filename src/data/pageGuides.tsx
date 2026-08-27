import {
  ScanLine, Pencil, Split, Tag, History, Maximize2,
  Search, BarChart2, Download, FileText, RefreshCw,
  Users, MessageCircle, Star, Filter, Calendar,
  Package, Upload, Copy, AlertTriangle, Layers,
  DollarSign, TrendingUp, Percent, CheckSquare, Printer,
  Zap, Bot, Brain, Mail, Link2, QrCode, Palette,
  ShoppingCart, Truck, CreditCard, Wallet,
  ClipboardList, CheckCircle2, ArrowUpDown,
  Kanban, Clock, Target, Flag,
  LayoutDashboard, Sun, Bell, RotateCcw,
  ReceiptText, Settings, User, Lock, Key,
  FileBarChart, PieChart, Activity, LineChart,
  Banknote, BarChart3, CalendarDays, MapPin,
  Globe, Plug, Shield, Building2,
  LucideIcon,
} from "lucide-react";

export interface GuideTip {
  icon: LucideIcon;
  title: string;
  desc: string;
  tag?: "Nuevo" | "Pro" | "IA" | "Tip";
}

export interface GuideConfig {
  title: string;
  subtitle?: string;
  color?: string; // tailwind text color
  tips: GuideTip[];
}

/** Map route pathname → guide config */
export const PAGE_GUIDES: Record<string, GuideConfig> = {

  // ── Dashboard ────────────────────────────────────────────────
  "/": {
    title: "Dashboard",
    subtitle: "Vista general del negocio",
    color: "text-primary",
    tips: [
      { icon: LayoutDashboard, title: "KPIs del día en tiempo real", desc: "Los 4 KPIs superiores muestran ventas de hoy, ganancia neta, margen y deudas activas. Hacé click en 'Hoy' para ver el desglose por hora." },
      { icon: Bot, title: "Insight diario con IA", desc: "Tocá '💡 Insight del día' en las acciones rápidas para que la IA analice tus datos y sugiera acciones concretas para hoy." },
      { icon: Target, title: "Meta mensual", desc: "Configurá tu objetivo de ventas mensual desde el widget 'Meta del mes'. La barra se pone roja si quedan 7 días y llevás menos del 60%." },
      { icon: Bell, title: "Alertas proactivas", desc: "El dashboard detecta stock crítico, caja abierta, sin ventas después de las 14h y objetivo en riesgo. Aparecen como banners automáticamente." },
      { icon: Sun, title: "Resumen del día (20h+)", desc: "Después de las 20h aparece el widget de cierre del día con ventas, ganancia, método de pago dominante y top-3 productos." },
      { icon: TrendingUp, title: "Gráfico P&L mensual", desc: "El gráfico de barras muestra ingresos vs gastos vs ganancia neta por mes. Pasá el cursor para ver los valores exactos." },
    ],
  },

  // ── POS / Caja ───────────────────────────────────────────────
  "/caja": {
    title: "Punto de Venta",
    subtitle: "POS rápido y sin fricciones",
    color: "text-green-400",
    tips: [
      { icon: Search, title: "Buscar por nombre, SKU o barcode", desc: "Escribí en el buscador o usá el botón de cámara para escanear el código de barras del producto directamente.", tag: "Tip" },
      { icon: Pencil, title: "Precio personalizado por ítem", desc: "Hacé click en el ícono ✏️ junto al precio de cualquier ítem del carrito para ingresar un precio especial. El fondo dorado indica que el precio fue modificado.", tag: "Nuevo" },
      { icon: BarChart2, title: "Margen visible por ítem", desc: "Cada ítem del carrito muestra un badge verde/amarillo/rojo con el margen estimado. Verde ≥40%, amarillo ≥20%, rojo <20%.", tag: "Nuevo" },
      { icon: Split, title: "Dividir el pago", desc: "Activá 'Dividir pago' para cobrar con dos métodos distintos (ej: efectivo + transferencia). Ingresá el monto de cada uno." },
      { icon: Tag, title: "Descuentos por categoría", desc: "Abrí el panel 'Descuento por categoría' para aplicar un % diferente a cada categoría de producto en el mismo ticket." },
      { icon: History, title: "Historial del turno", desc: "El panel 'Últimas ventas' lista todo lo vendido en el turno. Podés anular una venta con × (restaura el stock automáticamente)." },
      { icon: Maximize2, title: "Modo pantalla completa", desc: "Usá el botón ⛶ para ir a pantalla completa. Ideal para tener el POS siempre visible en una tablet en el mostrador." },
    ],
  },

  // ── Productos ────────────────────────────────────────────────
  "/productos": {
    title: "Productos",
    subtitle: "Catálogo e inventario",
    color: "text-blue-400",
    tips: [
      { icon: Upload, title: "Importar desde Excel", desc: "Cargá múltiples productos a la vez desde un Excel. El sistema calcula márgenes y precios sugeridos automáticamente." },
      { icon: FileText, title: "Importar factura con IA", desc: "Usá '✨ Factura IA' para fotografiar o subir una factura PDF. Claude extrae los productos, cantidades y precios en segundos.", tag: "IA" },
      { icon: Pencil, title: "Editar stock o precio inline", desc: "Hacé click directamente en el número de stock o precio en la tabla para editarlo sin abrir el formulario. Confirmá con Enter." },
      { icon: Copy, title: "Duplicar producto", desc: "El botón Copy en la columna de acciones crea una copia exacta del producto con stock 0 y nombre 'Copia de X'. Útil para variantes." },
      { icon: Layers, title: "Stock por variante", desc: "Hacé click en el badge de capas 🗂 para ver el stock de cada variante (sabor, talla, color) sin abrir el producto." },
      { icon: AlertTriangle, title: "Panel de reposición", desc: "El banner de stock bajo lista todos los productos que necesitan pedido. El botón 'Pedir' abre Compras con el producto preseleccionado.", tag: "Tip" },
      { icon: Printer, title: "Lista de precios PDF", desc: "Generá un PDF listo para imprimir con todos los precios agrupados por categoría. También podés exportar etiquetas de precios con QR." },
    ],
  },

  // ── Compras ──────────────────────────────────────────────────
  "/compras": {
    title: "Compras",
    subtitle: "Pedidos y recepción de mercadería",
    color: "text-purple-400",
    tips: [
      { icon: ScanLine, title: "Escanear barcode para buscar", desc: "Usá el botón de cámara junto al buscador para escanear el código de barras de un producto y filtrarlo instantáneamente.", tag: "Nuevo" },
      { icon: FileText, title: "Importar factura del proveedor", desc: "Con '✨ Factura IA' podés fotografiar la factura del proveedor y crear la compra automáticamente con todos los ítems.", tag: "IA" },
      { icon: Truck, title: "Estado 'En camino'", desc: "Marcá un pedido como 'En camino' para diferenciarlo de los pedidos no confirmados. Los KPIs del pipeline muestran los tres estados." },
      { icon: Package, title: "Recepción parcial", desc: "Al marcar un pedido como recibido podés ingresar la cantidad real recibida (puede ser menor a la pedida). El stock se ajusta correctamente." },
      { icon: BarChart2, title: "Tab 'Por Proveedor'", desc: "Ve el ranking de proveedores con total USD, número de compras, promedio por orden y última fecha de compra." },
      { icon: Download, title: "Exportar CSV", desc: "El botón CSV exporta todas las compras del período filtrado con tipo (Pedido/Recibida), proveedor, producto y montos." },
    ],
  },

  // ── Ventas ───────────────────────────────────────────────────
  "/ventas": {
    title: "Ventas",
    subtitle: "Registro y análisis de ventas",
    color: "text-primary",
    tips: [
      { icon: CalendarDays, title: "Chips de fecha rápida", desc: "Usá los chips Hoy / Ayer / Semana / Mes / Este año para filtrar el período en un click sin tocar los date pickers." },
      { icon: CheckSquare, title: "Marcar cobradas en lote", desc: "Seleccioná varias ventas (o 'Seleccionar todas') y usá la barra flotante 'Marcar cobradas' para actualizar en lote." },
      { icon: BarChart2, title: "Desglose por método de pago", desc: "Debajo de los KPIs aparece automáticamente el desglose con barras de progreso por efectivo, transferencia, débito, etc." },
      { icon: FileText, title: "PDF individual de venta", desc: "El botón ↓ en cada fila descarga un PDF A4 con logo, datos del cliente, ítems y total. El botón 📋 genera un recibo imprimible." },
      { icon: MessageCircle, title: "Compartir resumen por WhatsApp", desc: "El botón verde en el header genera un resumen del período filtrado (total, ganancia, top 3 productos) y lo envía por WhatsApp." },
      { icon: Download, title: "Exportar CSV del período", desc: "El CSV incluye fecha, producto, cliente, cantidad, precio, ganancia, método de pago y estado de cobro del período filtrado." },
      { icon: BarChart3, title: "Vistas alternativas", desc: "Cambiá entre 'Lista', 'Por cliente', 'Por fecha', 'Sesiones POS' y 'Por producto' con los botones de toggle." },
    ],
  },

  // ── Clientes / CRM ───────────────────────────────────────────
  "/clientes": {
    title: "Clientes / CRM",
    subtitle: "Gestión de relaciones con clientes",
    color: "text-cyan-400",
    tips: [
      { icon: Star, title: "Segmentación RFM automática", desc: "Cada cliente recibe un segmento (VIP / Premium / Frecuente / En riesgo / Dormido / Perdido) basado en recencia, frecuencia y monto." },
      { icon: BarChart2, title: "Panel de análisis RFM", desc: "Abrí el panel 'Análisis RFM' para ver la distribución de clientes y el top-15 con scores detallados. Exportable en CSV." },
      { icon: Filter, title: "Segmentos guardados", desc: "Aplicá filtros y hacé click en 'Guardar segmento' para crear un chip de acceso rápido. Los segmentos persisten entre sesiones." },
      { icon: Mail, title: "Campaña de email desde CRM", desc: "Seleccioná clientes y usá 'Crear campaña de email' en la barra flotante para abrir Email Marketing con esos contactos pre-cargados." },
      { icon: MessageCircle, title: "WhatsApp de cumpleaños masivo", desc: "Filtrá por cumpleaños 'Esta semana' y usá el botón bulk para enviar mensajes personalizados con el template configurado en Ajustes." },
      { icon: Users, title: "Top clientes del mes", desc: "El widget 'Top clientes del mes' muestra el top-5 con medallas, total ARS y badge VIP. Exportable en CSV." },
    ],
  },

  // ── CRM Avanzado / Pipeline ──────────────────────────────────
  "/crm-avanzado": {
    title: "CRM Avanzado",
    subtitle: "Seguimiento de oportunidades",
    color: "text-orange-400",
    tips: [
      { icon: Kanban, title: "Drag-and-drop entre columnas", desc: "Arrastrá los deals de una etapa a otra. El indicador azul muestra dónde se soltará el card." },
      { icon: DollarSign, title: "Pipeline ponderado", desc: "El KPI 'Pipeline ponderado' calcula el valor esperado multiplicando cada deal por la probabilidad de cierre de su etapa." },
      { icon: Clock, title: "Deals estancados", desc: "El banner naranja alerta cuando hay deals sin actualización por más de 14 días. Podés actualizarlos directamente desde el panel." },
      { icon: MessageCircle, title: "WhatsApp de seguimiento", desc: "Los deals sin actividad ≥7 días muestran el botón 'Seguimiento' que abre wa.me/ con un mensaje pre-redactado listo para enviar." },
      { icon: Flag, title: "Prioridad visual", desc: "Los deals con alta prioridad tienen un borde destacado. Editá la prioridad desde el card para organizarte mejor." },
    ],
  },

  // ── Presupuestos ─────────────────────────────────────────────
  "/presupuestos": {
    title: "Presupuestos",
    subtitle: "Cotizaciones y propuestas comerciales",
    color: "text-amber-400",
    tips: [
      { icon: Copy, title: "Duplicar presupuesto", desc: "El botón CopyPlus crea una copia exacta del presupuesto con un nuevo número. Útil para reutilizar cotizaciones similares." },
      { icon: FileText, title: "PDF profesional", desc: "Generá el PDF con un click. Incluye logo, datos del cliente, lista de ítems y condiciones. Listo para enviar." },
      { icon: AlertTriangle, title: "Presupuestos vencidos", desc: "El banner naranja detecta presupuestos sin respuesta después de 30 días. Podés filtrarlos con 'Sin respuesta +30d'." },
      { icon: CheckCircle2, title: "Convertir a venta", desc: "El botón 'Convertir a venta' abre un modal de cobro y crea la venta vinculada al presupuesto directamente." },
    ],
  },

  // ── Deudas ───────────────────────────────────────────────────
  "/deudas": {
    title: "Deudas",
    subtitle: "Gestión de cuentas corrientes",
    color: "text-red-400",
    tips: [
      { icon: CheckSquare, title: "Marcar cobradas en lote", desc: "Seleccioná múltiples deudas y usá la barra flotante para marcarlas como pagadas en un solo paso." },
      { icon: MessageCircle, title: "WhatsApp masivo a deudores", desc: "El botón 'Recordar >30d' envía mensajes personalizados a todos los deudores con más de 30 días de antigüedad usando el template de Ajustes." },
      { icon: CreditCard, title: "Plan de pago en cuotas", desc: "Desde cada deuda podés crear un plan de cuotas con frecuencia semanal/quincenal/mensual. Marcá las cuotas pagadas individualmente." },
      { icon: CalendarDays, title: "Proyección de cobros 30d", desc: "El tab 'Próximos cobros' muestra los cobros esperados en 4 buckets (hoy / 1-7d / 8-15d / 16-30d) con barras de totalización." },
      { icon: BarChart2, title: "Aging de deudas", desc: "El panel de aging agrupa las deudas por antigüedad (0-30 / 31-60 / 61-90 / >90 días) con colores de alerta y totales USD." },
    ],
  },

  // ── Gastos ───────────────────────────────────────────────────
  "/gastos": {
    title: "Gastos",
    subtitle: "Control de egresos y presupuesto",
    color: "text-orange-400",
    tips: [
      { icon: Target, title: "Presupuesto por categoría", desc: "Editá el presupuesto mensual de cada categoría con el ícono ✏️. La barra se pone naranja al 80% y roja al 100%." },
      { icon: FileText, title: "Adjuntar comprobante", desc: "Podés adjuntar foto o PDF del recibo directamente al gasto. Se guarda en la nube y queda disponible para auditoría." },
      { icon: TrendingUp, title: "Tendencia mensual", desc: "El tab 'Tendencia' muestra el gráfico de gastos por mes con un apilado por categoría para los últimos 6 meses." },
      { icon: Download, title: "Exportar e imprimir", desc: "El CSV exporta todos los gastos filtrados. El botón 'Imprimir' genera un reporte HTML con resumen por categoría y detalle completo." },
      { icon: RefreshCw, title: "Gastos recurrentes", desc: "Los gastos marcados como recurrentes se generan automáticamente cada mes/semana sin que tengas que ingresarlos de nuevo." },
    ],
  },

  // ── Proveedores ──────────────────────────────────────────────
  "/proveedores": {
    title: "Proveedores",
    subtitle: "Gestión de proveedores y pagos",
    color: "text-indigo-400",
    tips: [
      { icon: CreditCard, title: "Pagos parciales", desc: "Registrá pagos parciales a proveedores. El historial muestra cuánto quedó pendiente y las fechas de cada pago." },
      { icon: MessageCircle, title: "Contacto clickeable", desc: "El teléfono abre WhatsApp directamente y el email abre el cliente de correo. Comunicación rápida sin copiar datos." },
      { icon: BarChart2, title: "Aging de cuentas a pagar", desc: "El panel de aging muestra lo que debés a cada proveedor agrupado por antigüedad (0-30 / 31-60 / 61-90 / >90 días)." },
      { icon: TrendingUp, title: "Ranking en Reportes", desc: "El tab 'Proveedores' en Reportes muestra el ranking por monto USD, share % del total, cantidad de compras y promedio." },
    ],
  },

  // ── Reportes ─────────────────────────────────────────────────
  "/reportes": {
    title: "Reportes",
    subtitle: "Análisis financiero completo",
    color: "text-primary",
    tips: [
      { icon: FileBarChart, title: "Estado de Resultados (P&L)", desc: "El tab 'Resumen' muestra ingresos, COGS, ganancia bruta, gastos y neto con comparativa del período anterior." },
      { icon: PieChart, title: "Rentabilidad por producto", desc: "El tab 'Productos' rankea cada artículo por ganancia, margen y unidades vendidas. Con top-5 bar chart y exportación CSV." },
      { icon: CalendarDays, title: "Comparativa de dos períodos", desc: "En el tab 'Tendencia de margen' podés comparar dos meses directamente con Δ en todas las métricas (ingresos, ganancia, márgenes)." },
      { icon: FileText, title: "PDF para contador", desc: "El tab 'Impuestos' tiene un botón 'PDF Contador' que genera un documento profesional con IVA, IIBB y resultados por mes." },
      { icon: BarChart3, title: "Por categoría y por día", desc: "Los tabs 'Por categoría' y 'Por día' muestran heatmaps y barras con participación de cada categoría y día de la semana." },
    ],
  },

  // ── Analytics ────────────────────────────────────────────────
  "/analytics": {
    title: "Analytics",
    subtitle: "Inteligencia de negocio avanzada",
    color: "text-violet-400",
    tips: [
      { icon: LineChart, title: "Predicción de demanda", desc: "El tab 'Demanda' proyecta los próximos 30 días por producto usando velocidad de ventas. Semáforo de urgencia para reposición.", tag: "IA" },
      { icon: Activity, title: "Análisis de cohortes", desc: "El tab 'Cohorts' muestra la retención de clientes por mes de primera compra en un heatmap de 12 × 7. Verde = retención alta." },
      { icon: PieChart, title: "ABC Analysis", desc: "El tab 'ABC' clasifica tus productos en A (80% del ingreso), B (15%) y C (5%) siguiendo el principio de Pareto." },
      { icon: Users, title: "Nuevos vs Recurrentes", desc: "El tab 'Clientes' tiene el gráfico apilado de nuevos vs recurrentes por mes para medir la fidelización." },
      { icon: BarChart2, title: "Pareto de clientes", desc: "El widget Pareto muestra qué % de clientes genera el 80% de los ingresos. Alerta si la concentración es demasiado alta." },
      { icon: DollarSign, title: "Canales de venta", desc: "El tab 'Canales' muestra el donut y trend mensual de ingresos por método de pago (efectivo, transferencia, etc.)." },
    ],
  },

  // ── Facturas ─────────────────────────────────────────────────
  "/facturas": {
    title: "Facturas",
    subtitle: "Facturación electrónica AFIP",
    color: "text-blue-400",
    tips: [
      { icon: CheckSquare, title: "Envío masivo de facturas", desc: "Seleccioná múltiples facturas y usá la barra flotante 'Enviar emails' para enviarlas todas en lote a sus clientes." },
      { icon: ReceiptText, title: "Notas de Crédito", desc: "El botón FileMinus en facturas emitidas crea una Nota de Crédito vinculada. Podés revertir el stock y marcar la venta como devuelta." },
      { icon: Filter, title: "Filtrar por tipo", desc: "Filtrá por tipo de comprobante: Factura A / B / C / Nota de Crédito usando el dropdown junto a los chips de estado." },
      { icon: FileText, title: "PDF y email individual", desc: "Cada factura tiene botón para descargar el PDF o enviarlo por email directamente al cliente sin salir de la pantalla." },
    ],
  },

  // ── Fidelidad ────────────────────────────────────────────────
  "/fidelidad": {
    title: "Programa de Fidelidad",
    subtitle: "Puntos, tiers y canjes",
    color: "text-yellow-400",
    tips: [
      { icon: Star, title: "Tiers Bronce / Plata / Oro / Platino", desc: "Los clientes avanzan de tier automáticamente al acumular puntos. Cada tier tiene un % de descuento aplicado en el POS." },
      { icon: DollarSign, title: "Canjes al costo", desc: "La sección de canjes calcula el precio al costo del producto (no al precio de venta) para que el canje sea rentable para el negocio." },
      { icon: Zap, title: "Puntos automáticos", desc: "Los puntos se otorgan automáticamente vía trigger de base de datos al registrar cada venta. No requiere acción manual." },
      { icon: BarChart2, title: "Progreso al siguiente tier", desc: "La barra de progreso muestra cuántos puntos faltan para el próximo nivel. Motivá a los clientes a seguir comprando." },
    ],
  },

  // ── Alertas ──────────────────────────────────────────────────
  "/alertas": {
    title: "Alertas Inteligentes",
    subtitle: "Notificaciones automáticas del negocio",
    color: "text-red-400",
    tips: [
      { icon: Bell, title: "5 tipos de alerta", desc: "Configurá alertas de stock bajo, deuda vencida, meta en riesgo, vencimiento de producto y meta de ventas. Se activan automáticamente." },
      { icon: Zap, title: "Ejecución manual", desc: "El botón 'Ejecutar ahora' corre el chequeo de alertas en cualquier momento, sin esperar el cron diario de las 7:00 UTC." },
      { icon: History, title: "Historial de disparos", desc: "La tabla 'Última vez disparadas' muestra cuándo se activó cada regla por última vez. Badge 'Hoy' para las más recientes." },
      { icon: Bell, title: "Push Notifications", desc: "Activá las notificaciones push en Ajustes para recibir alertas en el celular aunque la app esté cerrada.", tag: "Pro" },
    ],
  },

  // ── Marketing ────────────────────────────────────────────────
  "/marketing": {
    title: "Marketing",
    subtitle: "Contenido y publicaciones",
    color: "text-pink-400",
    tips: [
      { icon: Palette, title: "Generador de Stories IG", desc: "Creá historias de Instagram profesionales con el generador: elige productos, colores, precios y descargá el PNG listo para publicar.", tag: "IA" },
      { icon: Filter, title: "Filtrar por estado", desc: "El selector de estado (borrador / programado / publicado / archivado) filtra las publicaciones y muestra el contador de resultados." },
      { icon: Download, title: "Exportar CSV de publicaciones", desc: "El botón CSV exporta todas las publicaciones con estado, fecha, canal y texto para análisis externo o registro." },
      { icon: Brain, title: "Sugerencias de ofertas con IA", desc: "El panel 'Recomendador IA' analiza tu inventario y sugiere qué productos promover basándose en stock y velocidad de ventas.", tag: "IA" },
    ],
  },

  // ── Email Marketing ──────────────────────────────────────────
  "/email-campaigns": {
    title: "Email Marketing",
    subtitle: "Campañas segmentadas con Resend",
    color: "text-blue-400",
    tips: [
      { icon: Users, title: "7 segmentos de audiencia", desc: "Seleccioná 'Todos / VIP / En riesgo / Dormidos / Perdidos >90d / Cumpleaños / Nunca compraron' para targetear correctamente." },
      { icon: FileText, title: "5 plantillas listas", desc: "Usá las plantillas de bienvenida, reactivación, VIP, promo fin de semana o cumpleaños. Personalizables con un click." },
      { icon: Activity, title: "Métricas de apertura en tiempo real", desc: "Las barras de apertura y clicks se actualizan en tiempo real vía Resend webhooks. Verde = bien, rojo = revisar asunto." },
      { icon: Globe, title: "Vista previa antes de enviar", desc: "El tab 'Vista previa' muestra exactamente cómo verá el email el destinatario, con colores, logo y formato final." },
      { icon: Mail, title: "Branding automático", desc: "Todos los emails incluyen el logo y nombre del negocio en el header y un pie de página profesional con unsubscribe." },
    ],
  },

  // ── Catálogo Online ──────────────────────────────────────────
  "/catalogo": {
    title: "Catálogo Online",
    subtitle: "Catálogo público y PDF de productos",
    color: "text-primary",
    tips: [
      { icon: QrCode, title: "QR y link compartible", desc: "El botón QR genera el código listo para imprimir. El link público puede compartirse en redes, WhatsApp o incluirse en el local." },
      { icon: FileText, title: "PDF profesional completo", desc: "El PDF incluye portada con logo, catálogo por categoría con imágenes y precios, y contraportada con datos de contacto." },
      { icon: Palette, title: "Colores personalizables", desc: "Configurá los colores del catálogo (fondo, cards, acento) desde Ajustes > Colores del catálogo. Guarda paletas de marca.", tag: "Nuevo" },
      { icon: Globe, title: "Catálogo público con carrito", desc: "El catálogo público permite a los clientes agregar productos y enviar el pedido por WhatsApp con todos los ítems en un mensaje." },
      { icon: Filter, title: "Filtrar por categoría", desc: "En el PDF podés seleccionar qué categorías incluir. Útil para catálogos especializados por línea de producto." },
    ],
  },

  // ── Chat IA ──────────────────────────────────────────────────
  "/chat-ia": {
    title: "Chat con IA",
    subtitle: "Asistente de negocio con Claude",
    color: "text-violet-400",
    tips: [
      { icon: Brain, title: "Acciones directas desde el chat", desc: "Podés registrar ventas, compras, gastos, clientes y productos con lenguaje natural. La IA crea los registros en la base de datos.", tag: "IA" },
      { icon: BarChart2, title: "Consultar métricas", desc: "Preguntá '¿cuánto vendí esta semana?' o '¿cuál es mi producto más rentable?' para obtener datos de tu negocio en lenguaje natural." },
      { icon: History, title: "Historial de conversaciones", desc: "El sidebar de la izquierda guarda hasta 10 conversaciones por organización. Podés retomar cualquiera desde donde la dejaste." },
      { icon: Download, title: "Exportar conversación", desc: "El botón 'Exportar' descarga toda la conversación actual como archivo .txt. Útil para guardar análisis o resúmenes." },
      { icon: Zap, title: "Chips de acceso rápido", desc: "Los chips en el estado vacío (ventas, POS, clientes, inventario, gastos, reportes) llevan a acciones frecuentes sin escribir." },
    ],
  },

  // ── Integraciones ────────────────────────────────────────────
  "/integraciones": {
    title: "Integraciones",
    subtitle: "Conexiones con servicios externos",
    color: "text-green-400",
    tips: [
      { icon: Plug, title: "Estado de salud por integración", desc: "Cada integración muestra su estado (activa / error / no configurada) basado en los últimos logs de conexión." },
      { icon: RefreshCw, title: "Retry de webhooks fallidos", desc: "Si un webhook falló, podés reintentar la entrega directamente desde la cola de dead-letters sin perder el evento." },
      { icon: Shield, title: "Webhooks con HMAC", desc: "Todos los webhooks salientes están firmados con HMAC-SHA256. Las integraciones entrantes también validan la firma." },
      { icon: Building2, title: "Mercado Pago y MercadoLibre", desc: "Se conectan por OAuth: el comercio autoriza su cuenta y la app nunca ve sus credenciales. Mercado Pago habilita los cobros con link y QR desde el POS." },
    ],
  },

  // ── Ajustes ──────────────────────────────────────────────────
  "/ajustes": {
    title: "Ajustes",
    subtitle: "Configuración del negocio",
    color: "text-muted-foreground",
    tips: [
      { icon: Palette, title: "Paletas de marca", desc: "Elegí entre 8 paletas predefinidas o creá la tuya propia con el color picker RGB/HSV completo. Se aplican al catálogo PDF y público.", tag: "Nuevo" },
      { icon: MessageCircle, title: "Plantillas de WhatsApp", desc: "Configurá las 5 plantillas de mensajes (venta, deuda, cumpleaños, reactivación, pedido listo) con variables {{nombre}} y {{monto}}." },
      { icon: Bell, title: "Notificaciones push", desc: "Activá las push notifications para recibir alertas de stock bajo, deuda vencida y metas en riesgo directamente en el celular.", tag: "Pro" },
      { icon: DollarSign, title: "Tipo de cambio y precios", desc: "El tipo de cambio se usa en todo el sistema para convertir costos USD a ARS. Actualizalo cuando cambie el dólar blue." },
      { icon: Key, title: "API Keys", desc: "Generá API keys rotables con scopes específicos para conectar sistemas externos sin exponer tu contraseña." },
    ],
  },

  // ── Tareas ───────────────────────────────────────────────────
  "/tareas": {
    title: "Tareas",
    subtitle: "Gestión de pendientes del equipo",
    color: "text-cyan-400",
    tips: [
      { icon: Kanban, title: "Vista Kanban con drag-drop", desc: "Arrastrá las tareas entre las columnas Pendiente / En progreso / Completada. El estado se actualiza automáticamente." },
      { icon: CheckSquare, title: "Subtareas colapsables", desc: "Hacé click en '+subtarea' dentro de un card para añadir subtareas. El badge N/total muestra el progreso en tiempo real." },
      { icon: Flag, title: "Prioridad con colores", desc: "Alta = rojo, Media = naranja, Baja = gris. Las tareas urgentes aparecen destacadas tanto en lista como en kanban." },
      { icon: Users, title: "Tareas creadas desde CRM", desc: "Desde CustomersPage podés crear tareas de seguimiento en lote para clientes seleccionados, con due_date = mañana." },
    ],
  },

  // ── Caja / Turno ────────────────────────────────────────────
  "/caja/turno": {
    title: "Turno de Caja",
    subtitle: "Apertura, cierre y diferencias",
    color: "text-green-400",
    tips: [
      { icon: DollarSign, title: "Diferencia al cierre", desc: "Al cerrar el turno ingresás el efectivo real en caja. El sistema calcula la diferencia vs las ventas registradas automáticamente." },
      { icon: Users, title: "Breakdown por vendedor", desc: "Si hay 2+ vendedores en el turno, aparece la tabla 'Ventas por vendedor' con totales individuales y método de pago." },
      { icon: FileText, title: "PDF y CSV del cierre", desc: "El cierre genera un PDF completo con KPIs, desglose por método de pago y top-5 productos. También exportable en CSV." },
      { icon: Printer, title: "Resumen parcial del turno", desc: "Sin cerrar el turno podés abrir el modal de 'Resumen parcial' para ver las ventas acumuladas hasta el momento." },
    ],
  },

  // ── Banco / Conciliación ─────────────────────────────────────
  "/banco": {
    title: "Banco / Conciliación",
    subtitle: "Control de movimientos bancarios",
    color: "text-blue-400",
    tips: [
      { icon: ArrowUpDown, title: "Conciliación manual", desc: "Importá el resumen bancario y marcá cada movimiento como conciliado contra ventas, gastos o pagos registrados." },
      { icon: BarChart2, title: "Saldo proyectado", desc: "El saldo proyectado incluye los cheques a depositar y los pagos a proveedores pendientes en las próximas semanas." },
      { icon: Download, title: "Exportar movimientos", desc: "Exportá todos los movimientos del período con fecha, tipo, monto y estado de conciliación en formato CSV." },
    ],
  },

  // ── Restock automático ───────────────────────────────────────
  "/planificacion": {
    title: "Restock Inteligente",
    subtitle: "Reposición basada en velocidad de ventas",
    color: "text-teal-400",
    tips: [
      { icon: TrendingUp, title: "Velocidad de ventas 60 días", desc: "El sistema calcula cuántas unidades se venden por día en los últimos 60 días para proyectar cuándo se va a agotar el stock." },
      { icon: Package, title: "Cantidad sugerida de pedido", desc: "La cantidad sugerida cubre 30 días de ventas proyectadas. Podés editarla antes de generar la compra." },
      { icon: ShoppingCart, title: "Generar orden de compra", desc: "Con un click convertís la sugerencia en una orden de compra pre-cargada en la página de Compras." },
    ],
  },

  // ── Kardex ───────────────────────────────────────────────────
  "/kardex": {
    title: "Kardex de Movimientos",
    subtitle: "Historial completo de stock",
    color: "text-indigo-400",
    tips: [
      { icon: History, title: "Trazabilidad completa", desc: "Cada movimiento de stock (venta, compra, ajuste manual, toma física) queda registrado con fecha, cantidad y responsable." },
      { icon: Filter, title: "Filtrar por producto", desc: "Buscá un producto específico para ver todo su historial de movimientos: entradas, salidas y ajustes." },
      { icon: Download, title: "Exportar para auditoría", desc: "El kardex exportable es el documento oficial para auditoría de inventario. Incluye saldo acumulado por movimiento." },
    ],
  },

  // ── Comisiones ───────────────────────────────────────────────
  "/comisiones": {
    title: "Comisiones de Vendedores",
    subtitle: "Liquidación de comisiones por período",
    color: "text-primary",
    tips: [
      { icon: Percent, title: "% configurable por vendedor", desc: "Cada vendedor puede tener un porcentaje de comisión diferente. Se puede editar directamente en la tabla." },
      { icon: CalendarDays, title: "Filtrar por período", desc: "Seleccioná el rango de fechas para calcular las comisiones de un mes específico o cualquier período personalizado." },
      { icon: Download, title: "Exportar liquidación", desc: "El CSV incluye vendedor, ventas totales, comisión calculada y tasa aplicada. Listo para la liquidación de sueldos." },
    ],
  },

  // ── Devoluciones ─────────────────────────────────────────────
  "/devoluciones": {
    title: "Devoluciones",
    subtitle: "Gestión de devoluciones y reembolsos",
    color: "text-red-400",
    tips: [
      { icon: RotateCcw, title: "Revertir stock automáticamente", desc: "Al procesar una devolución podés optar por reintegrar el stock al inventario. El ajuste queda auditado." },
      { icon: ReceiptText, title: "Vinculada a Nota de Crédito", desc: "Desde Facturas podés crear una Nota de Crédito que revierte el stock y marca la venta original como devuelta." },
      { icon: History, title: "Historial auditado", desc: "Cada devolución queda registrada con fecha, vendedor responsable y motivo para cumplir con la trazabilidad." },
    ],
  },

  // ── Cuotas ───────────────────────────────────────────────────
  "/cuotas": {
    title: "Cuotas",
    subtitle: "Seguimiento de pagos en cuotas",
    color: "text-cyan-400",
    tips: [
      { icon: CalendarDays, title: "Cronograma de vencimientos", desc: "Cada cuota muestra su fecha de vencimiento y estado. Las vencidas aparecen resaltadas en rojo." },
      { icon: CheckCircle2, title: "Marcar cuota pagada", desc: "El check individual por cuota permite registrar pagos parciales del plan. El progreso se actualiza en tiempo real." },
      { icon: Download, title: "Exportar CSV", desc: "El CSV completo incluye cliente, deuda original, cuotas pagadas, pendientes y próximo vencimiento." },
    ],
  },

  // ── Cheques ──────────────────────────────────────────────────
  "/cheques": {
    title: "Cheques",
    subtitle: "Gestión de cheques recibidos y emitidos",
    color: "text-amber-400",
    tips: [
      { icon: CalendarDays, title: "Alertas de vencimiento", desc: "Los cheques próximos a vencer aparecen destacados. Configurá la alerta en Alertas para notificación automática." },
      { icon: ArrowUpDown, title: "Recibidos vs emitidos", desc: "Filtrá entre cheques recibidos de clientes y cheques emitidos a proveedores para una vista separada de cada flujo." },
      { icon: Download, title: "Exportar CSV", desc: "El CSV exporta todos los campos: número, emisor/receptor, banco, monto, fecha de cobro y estado." },
    ],
  },

};
