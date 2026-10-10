/**
 * Tutoriales de la plataforma: el recorrido guiado de cada pantalla y los
 * caminos de la Academia (/aprender).
 *
 * Cada paso puede señalar un elemento real (`target`, un selector CSS). Si el
 * elemento no está en pantalla —otro rol, móvil, una sección cerrada— el paso
 * se muestra centrado: el recorrido nunca se corta por un selector.
 *
 * Las pantallas sin recorrido propio reciben uno generado desde el manifiesto
 * de rutas (nombre, área y para qué sirve), así toda la plataforma tiene ayuda.
 */

export type PasoTutorial = {
  titulo: string;
  texto: string;
  /** Selector del elemento a resaltar; sin él, el paso va centrado. */
  target?: string;
};

export type Tutorial = {
  /** Estable: es la clave del progreso guardado. Para pantallas, el id de la ruta. */
  id: string;
  /** Pantalla donde corre el recorrido. */
  ruta: string;
  titulo: string;
  resumen: string;
  minutos: number;
  pasos: PasoTutorial[];
};

export type CaminoAprendizaje = {
  id: string;
  titulo: string;
  descripcion: string;
  /** Ids de tutoriales, en el orden en que conviene hacerlos. */
  lecciones: string[];
};

const ENCABEZADO = ".page-header";

export const TUTORIALES: Record<string, Tutorial> = {
  bienvenida: {
    id: "bienvenida", ruta: "/", titulo: "Bienvenida a Nerqia", minutos: 2,
    resumen: "Cómo moverte por la plataforma, buscar cualquier cosa y pedir ayuda.",
    pasos: [
      { titulo: "Tu negocio en un solo lugar", texto: "Desde acá manejás ventas en el local, tienda online, stock, compras, facturación ARCA y finanzas. Este recorrido te muestra cómo moverte." },
      { titulo: "El menú", target: "aside", texto: "A la izquierda están todas las áreas, agrupadas: lo de todos los días arriba; operación, cobros y fiscal, marketing y reportes después. Podés plegar el menú para ganar espacio." },
      { titulo: "Buscar cualquier cosa", target: ".workspace-command-search", texto: "Con Ctrl + K buscás pantallas, productos y clientes escribiendo como hablás: «me deben», «stock», «factura»." },
      { titulo: "Vender rápido", target: ".workspace-topbar__cta", texto: "«Nueva venta» está siempre arriba. Para el mostrador usá «Vender» (la caja), pensada para teclado y lector de códigos." },
      { titulo: "Ayuda en cada pantalla", target: "[data-tour='ayuda']", texto: "Este botón abre el recorrido de la pantalla en la que estés y la Academia, con lecciones paso a paso y tu avance." },
    ],
  },
  caja: {
    id: "caja", ruta: "/caja", titulo: "Vender en el local (caja)", minutos: 4,
    resumen: "Buscar o escanear, elegir cliente, cobrar, facturar y usar los atajos F1–F11.",
    pasos: [
      { titulo: "La caja", texto: "Está pensada para vender rápido con teclado y lector de códigos de barras. Todo lo que hagas acá descuenta stock y queda en el libro." },
      { titulo: "Buscar o escanear", target: "[data-tour='pos-buscar']", texto: "F2 lleva al buscador: escribí nombre, marca o código, o pasá el lector. Si escaneás el código de una caja o bulto, se suman todas sus unidades. Los productos por kilo o metro piden la cantidad." },
      { titulo: "Cliente y factura", target: "[data-tour='pos-cliente']", texto: "F3 abre el buscador de clientes. Con un cliente con CUIT, el comprobante sale A, B o C según su condición frente al IVA, y la factura se pide sola." },
      { titulo: "Medio de pago", target: ".pos-pay-method-grid", texto: "Efectivo, transferencia, débito, crédito, QR o fiado. El fiado respeta el límite de crédito del cliente. También podés dividir el pago en dos medios." },
      { titulo: "Factura ARCA", target: "[data-tour='pos-factura']", texto: "Prendé o apagá la factura electrónica de este ticket. Si en Ajustes activaste «Facturar todas las ventas», cada ticket arranca pidiéndola." },
      { titulo: "Cobrar", target: ".pos-confirm-sale", texto: "Confirmá la venta (F9). Si un descuento supera el máximo permitido, se pide el PIN del encargado." },
      { titulo: "Atajos de teclado", texto: "F1 muestra todos los atajos · F2 buscar · F3 cliente · F4 siguiente medio de pago · F6 cupón · F7 ticket en espera · F9 cobrar · F10 factura ARCA. Alt + 1…4 eligen el medio de pago y Supr quita el último producto." },
    ],
  },
  productos: {
    id: "productos", ruta: "/productos", titulo: "Productos y catálogo", minutos: 4,
    resumen: "Cargar, importar, corregir errores, proveedores, presentaciones y duplicados.",
    pasos: [
      { titulo: "Tu catálogo", target: ENCABEZADO, texto: "Acá está todo lo que vendés. La lista está paginada y la búsqueda es instantánea aunque tengas miles de productos." },
      { titulo: "Importar desde Excel", texto: "Usá «Importar» para subir tu planilla. Si una fila tiene un error (precio vacío, código repetido, proveedor inexistente), el diagnóstico te dice la causa y cómo arreglarla antes de cargar." },
      { titulo: "Ficha del producto", texto: "Precio, costo (en pesos o dólares), proveedor, código de barras, alícuota de IVA y si se vende por unidad, kilo, metro, litro o m²." },
      { titulo: "Presentaciones", texto: "En la ficha podés cargar cajas o bultos con su propio código: escanearlos en la caja suma todas las unidades, con precio propio si lo definís." },
      { titulo: "Duplicados", texto: "«Revisar duplicados» encuentra productos repetidos y los unifica sin perder stock ni historial: los códigos del duplicado quedan como alternativos." },
    ],
  },
  clientes: {
    id: "clientes", ruta: "/clientes", titulo: "Clientes", minutos: 3,
    resumen: "Fichas con datos fiscales, límite de fiado, historial y seguimiento.",
    pasos: [
      { titulo: "Tus clientes", target: ENCABEZADO, texto: "Cada cliente tiene su ficha con contacto, historial de compras y lo que te debe." },
      { titulo: "Datos fiscales", texto: "Cargá CUIT o DNI, razón social, condición frente al IVA y domicilio fiscal: con eso la factura sale con la letra correcta, en la caja y en Facturas." },
      { titulo: "Límite de fiado", texto: "Dueños y administradores pueden fijar cuánto puede deber cada cliente. La caja no deja fiar por encima de ese límite." },
      { titulo: "Seguimiento", texto: "Etiquetas, segmentos y el embudo de oportunidades te ayudan a volver a venderle a quien hace tiempo no compra." },
    ],
  },
  facturas: {
    id: "facturas", ruta: "/facturas", titulo: "Facturación electrónica", minutos: 4,
    resumen: "Emitir, autorizar en ARCA, notas de crédito y débito, pendientes fiscales.",
    pasos: [
      { titulo: "Tus comprobantes", target: ENCABEZADO, texto: "Facturas, notas de crédito y de débito, con su CAE y el QR de ARCA." },
      { titulo: "Pendientes fiscales", texto: "Si algo no se autorizó, aparece agrupado por lo que tenés que hacer: corregir datos del cliente, revisar la conexión con ARCA o reintentar." },
      { titulo: "Ventas cobradas sin comprobante", texto: "«Generar comprobantes» factura de una vez los pedidos online cobrados. Lo que no se puede facturar aparece pedido por pedido con el motivo y qué hacer." },
      { titulo: "Notas de crédito y débito", texto: "Para corregir una factura autorizada no se edita: se emite una nota de crédito (anula o descuenta) o de débito (suma un cargo) asociada." },
      { titulo: "Observaciones de ARCA", texto: "Si ARCA autoriza pero deja un aviso, la factura lo muestra como «Con observaciones» con el detalle." },
    ],
  },
  afip: {
    id: "afip", ruta: "/afip", titulo: "Conectar ARCA", minutos: 5,
    resumen: "Certificado, punto de venta, ambiente y salud fiscal.",
    pasos: [
      { titulo: "Conexión con ARCA", target: ENCABEZADO, texto: "Para facturar electrónicamente Nerqia necesita tu CUIT, un punto de venta habilitado para web services y la delegación o el certificado." },
      { titulo: "Salud fiscal", texto: "El panel puntúa de 0 a 100 tu configuración: datos del emisor, conexión, delegación, ambiente, rechazos recientes y último CAE." },
      { titulo: "Homologación y producción", texto: "Probá primero en homologación (comprobantes sin validez). Cuando todo esté verde, pasá a producción." },
      { titulo: "Vencimiento del certificado", texto: "Te avisamos 60, 30 y 7 días antes de que venza el certificado para que no se corte la facturación." },
    ],
  },
  ventas: {
    id: "ventas", ruta: "/ventas", titulo: "Historial de ventas", minutos: 2,
    resumen: "Buscar ventas, cargar una venta manual y ver cobros.",
    pasos: [
      { titulo: "Todas tus ventas", target: ENCABEZADO, texto: "Las de la caja, la tienda online y las cargadas a mano, con filtros por fecha, medio de pago, vendedor y categoría." },
      { titulo: "Venta manual", texto: "Para registrar una venta fuera de la caja, buscá el producto en el selector y completá cantidad y medio de pago." },
    ],
  },
  kardex: {
    id: "kardex", ruta: "/kardex", titulo: "Movimientos de stock", minutos: 3,
    resumen: "Ajustes, conteos físicos e historial de cada producto.",
    pasos: [
      { titulo: "Kardex", target: ENCABEZADO, texto: "Cada entrada y salida de stock queda registrada con su motivo: venta, compra, ajuste, transferencia o devolución." },
      { titulo: "Ajustar stock", texto: "Si contaste y no coincide, usá «Ajustar»: queda el movimiento con quién lo hizo. El stock nunca se pisa a mano." },
      { titulo: "Toma física", texto: "Contá por sector o categoría y cerrá el conteo: las diferencias se ajustan solas y quedan en el historial." },
    ],
  },
  compras: {
    id: "compras", ruta: "/compras", titulo: "Compras y reposición", minutos: 3,
    resumen: "Registrar compras, órdenes a proveedores y recompra automática.",
    pasos: [
      { titulo: "Compras", target: ENCABEZADO, texto: "Cada compra suma stock y actualiza el costo. Podés cargarla por unidad o por caja." },
      { titulo: "Orden de compra", texto: "Elegí productos y cantidades (o usá «Pre-cargar recompra» con lo vendido en los últimos días) y descargá el Excel para el proveedor." },
      { titulo: "Compras programadas", texto: "Una compra futura no mueve stock: aparece en el flujo de caja proyectado." },
    ],
  },
  proveedores: {
    id: "proveedores", ruta: "/proveedores", titulo: "Proveedores", minutos: 2,
    resumen: "Datos, productos asociados y saldo.",
    pasos: [
      { titulo: "Proveedores", target: ENCABEZADO, texto: "Cada producto pertenece a un proveedor: así filtrás el catálogo y armás pedidos por proveedor." },
    ],
  },
  deudas: {
    id: "deudas", ruta: "/deudas", titulo: "Lo que te deben (fiado)", minutos: 2,
    resumen: "Cobros, planes de pago y antigüedad de deudas.",
    pasos: [
      { titulo: "Cuentas por cobrar", target: ENCABEZADO, texto: "Cada venta fiado crea una deuda. Registrá cobros totales o parciales y armá planes de cuotas." },
      { titulo: "Antigüedad", texto: "La vista por antigüedad muestra qué deudas están vencidas para priorizar a quién llamar." },
    ],
  },
  tienda_online: {
    id: "tienda_online", ruta: "/tienda-online", titulo: "Tu tienda online", minutos: 4,
    resumen: "Publicar, diseñar, pagos, envíos y dominio.",
    pasos: [
      { titulo: "Tu tienda", target: ENCABEZADO, texto: "La tienda usa el mismo catálogo y el mismo stock que el local: no hay que cargar nada dos veces." },
      { titulo: "Diseño y contenido", texto: "Logo, colores, banners, categorías y páginas. Lo ves en la vista previa antes de publicar." },
      { titulo: "Cobros y envíos", texto: "Conectá Mercado Pago y configurá zonas y tarifas de envío. Cada pedido pagado genera su factura y se autoriza en ARCA solo." },
    ],
  },
  pedidos_online: {
    id: "pedidos_online", ruta: "/pedidos-online", titulo: "Pedidos online", minutos: 2,
    resumen: "Preparar, despachar y avisar al comprador.",
    pasos: [
      { titulo: "Pedidos", target: ENCABEZADO, texto: "Los pedidos llegan con su estado de pago. Al avanzarlos (preparado, enviado, entregado) el comprador recibe el aviso." },
    ],
  },
  ajustes: {
    id: "ajustes", ruta: "/ajustes", titulo: "Ajustes del negocio", minutos: 3,
    resumen: "Datos del negocio, descuentos por medio de pago, caja y facturación.",
    pasos: [
      { titulo: "Ajustes", target: ENCABEZADO, texto: "Datos del negocio, cotización, descuentos por medio de pago y preferencias de cada módulo." },
      { titulo: "Caja", target: "#settings-pos-supervisor", texto: "Activá «Facturar todas las ventas», fijá el descuento máximo del cajero y tu PIN de encargado para autorizar excepciones." },
    ],
  },
  equipo: {
    id: "equipo", ruta: "/equipo", titulo: "Tu equipo", minutos: 2,
    resumen: "Invitar usuarios, roles y permisos.",
    pasos: [
      { titulo: "Equipo", target: ENCABEZADO, texto: "Invitá a tus empleados con su correo. El rol define qué ven: un vendedor usa la caja y ventas; dueños y administradores, todo." },
    ],
  },
  reportes: {
    id: "reportes", ruta: "/reportes", titulo: "Reportes", minutos: 2,
    resumen: "Ventas, márgenes, productos y exportaciones.",
    pasos: [
      { titulo: "Reportes", target: ENCABEZADO, texto: "Ventas por período, margen por producto y canal, lo más vendido y lo que no rota. Todo se puede exportar." },
    ],
  },
  listas_precios: {
    id: "listas_precios", ruta: "/listas-precios", titulo: "Listas de precios", minutos: 2,
    resumen: "Mayorista, revendedor y precios especiales por cliente.",
    pasos: [
      { titulo: "Listas de precios", target: ENCABEZADO, texto: "Creá listas (mayorista, gremio) con descuento general o precios por producto, y asignalas a clientes: la caja las aplica sola." },
    ],
  },
  gastos: {
    id: "gastos", ruta: "/finance/gastos", titulo: "Gastos", minutos: 2,
    resumen: "Registrar gastos fijos y variables.",
    pasos: [
      { titulo: "Gastos", target: ENCABEZADO, texto: "Alquiler, servicios, sueldos: cargalos acá para que el resultado del mes sea real y no sólo ventas menos costo." },
    ],
  },
};

export const CAMINOS: CaminoAprendizaje[] = [
  { id: "primeros-pasos", titulo: "Primeros pasos", descripcion: "Lo mínimo para empezar a vender.", lecciones: ["bienvenida", "ajustes", "productos", "caja"] },
  { id: "local", titulo: "Vender en el local", descripcion: "Caja, clientes, fiado y listas de precios.", lecciones: ["caja", "clientes", "deudas", "listas_precios", "ventas"] },
  { id: "stock", titulo: "Stock y compras", descripcion: "Catálogo, movimientos, compras y proveedores.", lecciones: ["productos", "kardex", "compras", "proveedores"] },
  { id: "fiscal", titulo: "Facturación ARCA", descripcion: "Conectar ARCA y emitir comprobantes.", lecciones: ["afip", "facturas"] },
  { id: "online", titulo: "Tienda online", descripcion: "Publicar tu catálogo y despachar pedidos.", lecciones: ["tienda_online", "pedidos_online"] },
  { id: "gestion", titulo: "Gestión del negocio", descripcion: "Equipo, gastos y reportes.", lecciones: ["equipo", "gastos", "reportes"] },
];

/** Datos mínimos de una ruta del manifiesto para generar su recorrido. */
export type RutaParaTutorial = { id: string; path: string; label: string; areaHint?: string; keywords?: string[] };

/**
 * El recorrido de una pantalla: el propio, o uno generado desde el manifiesto
 * y los consejos de la guía de esa pantalla (si los tiene).
 */
export function tutorialDeRuta(ruta: RutaParaTutorial, consejos: { title: string; desc: string }[] = []): Tutorial {
  const propio = TUTORIALES[ruta.id];
  if (propio) return propio;
  const usos = (ruta.keywords ?? []).slice(0, 5);
  const pasosConsejos = consejos.slice(0, 5).map(c => ({ titulo: c.title, texto: c.desc }));
  return {
    id: ruta.id, ruta: ruta.path, titulo: ruta.label, minutos: Math.max(1, Math.ceil((pasosConsejos.length + 3) / 3)),
    resumen: ruta.areaHint ?? "Qué hace esta pantalla y cómo pedir ayuda.",
    pasos: [
      {
        titulo: ruta.label, target: ENCABEZADO,
        texto: `${ruta.areaHint ? `Forma parte de ${ruta.areaHint.charAt(0).toLowerCase()}${ruta.areaHint.slice(1)}. ` : ""}${usos.length ? `Sirve para: ${usos.join(", ")}.` : "Desde acá manejás esta parte del negocio."}`,
      },
      ...pasosConsejos,
      { titulo: "Buscá sin saber dónde está", target: ".workspace-command-search", texto: "Ctrl + K encuentra pantallas, productos y clientes por lo que escribas." },
      { titulo: "¿Seguís con dudas?", target: "[data-tour='ayuda']", texto: "En la Academia tenés lecciones paso a paso, y en Soporte hablás con el equipo." },
    ],
  };
}

/** Porcentaje de un camino completado según los ids vistos. */
export function avanceCamino(camino: CaminoAprendizaje, vistos: ReadonlySet<string>): number {
  if (!camino.lecciones.length) return 0;
  return Math.round(camino.lecciones.filter(id => vistos.has(id)).length / camino.lecciones.length * 100);
}
