/**
 * Diagnóstico de una importación antes de enviarla al servidor: agrupa los
 * problemas por causa, explica cómo se arreglan y ofrece correcciones que el
 * comercio aplica con un clic. Es un espejo de `stage_product_import`, que
 * sigue siendo la autoridad; ninguna corrección se aplica sin acción explícita.
 */
import { parseImportNumber, type ProductImportPayloadRow } from "@/lib/productImport";

type Fila = ProductImportPayloadRow & { source_row?: number };

export type ProblemaImportacionId =
  | "sin_nombre"
  | "codigo_repetido"
  | "precio_invalido"
  | "sin_precio"
  | "costo_invalido"
  | "stock_invalido"
  | "sin_cotizacion"
  | "oferta_no_menor";

export type CorreccionImportacion =
  | { tipo: "quitar_filas" }
  | { tipo: "quitar_campo"; campo: string }
  | { tipo: "conservar_ultima" }
  | { tipo: "activar_precio_sugerido" };

export type ProblemaImportacion = {
  id: ProblemaImportacionId;
  /** Bloquea la fila en el servidor; si es `false` sólo es una advertencia. */
  bloquea: boolean;
  titulo: string;
  causa: string;
  arreglo: string;
  cantidad: number;
  /** Hasta cinco ejemplos para ubicar el problema en la planilla. */
  ejemplos: { fila: number; nombre: string; valor?: string }[];
  correccion?: CorreccionImportacion & { etiqueta: string };
};

export type ContextoImportacion = {
  stockMode: "replace" | "ignore";
  exchangeRate: number;
  autoPrice: boolean;
  marginPercent: number;
};

const presente = (fila: Fila, campo: string) => fila.provided.includes(campo);
const numeroFila = (fila: Fila, indice: number) => fila.source_row || indice + 1;
const claveDe = (fila: Fila) => {
  const sku = String(fila.sku ?? "").trim().toLowerCase();
  return sku ? `sku:${sku}` : `name:${fila.name.trim().toLowerCase()}`;
};

function acumular(
  mapa: Map<ProblemaImportacionId, { indices: number[]; valores: (string | undefined)[] }>,
  id: ProblemaImportacionId,
  indice: number,
  valor?: unknown,
) {
  const actual = mapa.get(id) ?? { indices: [], valores: [] };
  actual.indices.push(indice);
  actual.valores.push(valor === undefined ? undefined : String(valor));
  mapa.set(id, actual);
}

type Hallazgos = Map<ProblemaImportacionId, { indices: number[]; valores: (string | undefined)[] }>;

function analizar(filas: Fila[], contexto: ContextoImportacion): Hallazgos {
  const hallazgos = new Map<ProblemaImportacionId, { indices: number[]; valores: (string | undefined)[] }>();
  const apariciones = new Map<string, number>();
  for (const fila of filas) {
    if (fila.name.trim()) apariciones.set(claveDe(fila), (apariciones.get(claveDe(fila)) ?? 0) + 1);
  }

  filas.forEach((fila, i) => {
    if (!fila.name.trim()) acumular(hallazgos, "sin_nombre", i, fila.sku);
    else if ((apariciones.get(claveDe(fila)) ?? 0) > 1) acumular(hallazgos, "codigo_repetido", i, fila.sku || fila.name);

    const precio = parseImportNumber(fila.sale_price_ars);
    const costoArs = parseImportNumber(fila.cost_ars);
    const costoUsd = parseImportNumber(fila.cost_usd);
    const tieneCosto = (presente(fila, "cost_ars") && (costoArs ?? 0) > 0) || (presente(fila, "cost_usd") && (costoUsd ?? 0) > 0);

    if (presente(fila, "sale_price_ars") && precio === null) acumular(hallazgos, "precio_invalido", i, fila.sale_price_ars);
    else if ((precio ?? 0) <= 0 && !(contexto.autoPrice && tieneCosto)) acumular(hallazgos, "sin_precio", i);

    if ((presente(fila, "cost_ars") && (costoArs === null || costoArs < 0))
      || (presente(fila, "cost_usd") && (costoUsd === null || costoUsd < 0))) {
      acumular(hallazgos, "costo_invalido", i, fila.cost_ars ?? fila.cost_usd);
    }
    if (presente(fila, "cost_usd") && contexto.exchangeRate <= 0) acumular(hallazgos, "sin_cotizacion", i, fila.cost_usd);

    if (contexto.stockMode === "replace" && presente(fila, "stock")) {
      const stock = parseImportNumber(fila.stock);
      if (stock === null || stock < 0 || !Number.isInteger(stock) || stock > 2147483647) {
        acumular(hallazgos, "stock_invalido", i, fila.stock);
      }
    }

    const oferta = parseImportNumber(fila.discount_price_ars);
    if (presente(fila, "discount_price_ars") && oferta !== null && (precio ?? 0) > 0 && oferta >= (precio ?? 0)) {
      acumular(hallazgos, "oferta_no_menor", i, fila.discount_price_ars);
    }
  });
  return hallazgos;
}

export function diagnosticarImportacion(filas: Fila[], contexto: ContextoImportacion): ProblemaImportacion[] {
  const hallazgos = analizar(filas, contexto);
  const sinPrecioConCosto = (hallazgos.get("sin_precio")?.indices ?? []).some(i => {
    const f = filas[i];
    return (parseImportNumber(f.cost_ars) ?? 0) > 0 || (parseImportNumber(f.cost_usd) ?? 0) > 0;
  });

  const textos: Record<ProblemaImportacionId, Omit<ProblemaImportacion, "id" | "cantidad" | "ejemplos">> = {
    sin_nombre: {
      bloquea: true, titulo: "Filas sin nombre",
      causa: "La columna asignada como nombre está vacía en estas filas; suelen ser renglones de subtotal, títulos o filas en blanco.",
      arreglo: "Si no son productos, quitalas. Si lo son, completá el nombre en la planilla o revisá qué columna está asignada como nombre.",
      correccion: { tipo: "quitar_filas", etiqueta: "Quitar estas filas" },
    },
    codigo_repetido: {
      bloquea: true, titulo: "Código repetido dentro del archivo",
      causa: "Dos o más filas tienen el mismo SKU (o el mismo nombre si no hay SKU). El servidor no puede saber cuál es la correcta y rechaza todas.",
      arreglo: "Quedate con la última aparición de cada código (suele ser la más actualizada) o corregí los códigos en la planilla.",
      correccion: { tipo: "conservar_ultima", etiqueta: "Conservar la última de cada código" },
    },
    precio_invalido: {
      bloquea: true, titulo: "Precio que no es un número",
      causa: "La celda de precio tiene texto (por ejemplo “consultar” o “-”) en lugar de un importe.",
      arreglo: contexto.autoPrice
        ? "Quitá esos precios y Nerqia sugiere uno desde el costo con el margen elegido."
        : "Corregí el valor en la planilla, o quitá esos precios y activá el precio sugerido desde el costo.",
      correccion: { tipo: "quitar_campo", campo: "sale_price_ars", etiqueta: "Quitar esos precios" },
    },
    sin_precio: {
      bloquea: true, titulo: "Productos sin precio de venta",
      causa: "No hay precio, o es cero. Un producto sin precio no se puede vender.",
      arreglo: sinPrecioConCosto
        ? `Activá el precio sugerido: se calcula desde el costo con ${contexto.marginPercent}% de margen y podés ajustarlo después.`
        : "Estas filas tampoco tienen costo: cargá el precio en la planilla o quitalas del archivo.",
      correccion: sinPrecioConCosto
        ? { tipo: "activar_precio_sugerido", etiqueta: `Sugerir precio con ${contexto.marginPercent}% de margen` }
        : { tipo: "quitar_filas", etiqueta: "Quitar estas filas" },
    },
    costo_invalido: {
      bloquea: true, titulo: "Costo que no es un número válido",
      causa: "La celda de costo tiene texto o un valor negativo.",
      arreglo: "Corregí el costo en la planilla, o importá esos productos sin costo y completalo después (el margen quedará incompleto).",
      correccion: { tipo: "quitar_campo", campo: "cost", etiqueta: "Importar sin costo" },
    },
    stock_invalido: {
      bloquea: true, titulo: "Stock negativo, con decimales o no numérico",
      causa: "Nerqia registra unidades enteras y no inventa stock: un negativo o una fracción no se redondea ni se pasa a cero.",
      arreglo: "Importá esas filas sin tocar su stock (se conserva el actual) y ajustalo después con un conteo, o corregilo en la planilla.",
      correccion: { tipo: "quitar_campo", campo: "stock", etiqueta: "No importar el stock de estas filas" },
    },
    sin_cotizacion: {
      bloquea: true, titulo: "Costos en dólares sin cotización",
      causa: "El costo está en USD y no hay cotización cargada para convertirlo.",
      arreglo: "Cargá la cotización USD → ARS en el campo de arriba. Si el costo en realidad está en pesos, cambiá la moneda del costo.",
    },
    oferta_no_menor: {
      bloquea: false, titulo: "Precio de oferta igual o mayor al precio normal",
      causa: "La oferta no baja el precio, así que no se mostrará como descuento.",
      arreglo: "Revisá las columnas de precio y oferta, o quitá esas ofertas.",
      correccion: { tipo: "quitar_campo", campo: "discount_price_ars", etiqueta: "Quitar esas ofertas" },
    },
  };

  const orden: ProblemaImportacionId[] = [
    "sin_nombre", "codigo_repetido", "sin_cotizacion", "precio_invalido", "sin_precio", "costo_invalido", "stock_invalido", "oferta_no_menor",
  ];
  return orden.filter(id => hallazgos.has(id)).map(id => {
    const { indices, valores } = hallazgos.get(id)!;
    return {
      id,
      ...textos[id],
      cantidad: indices.length,
      ejemplos: indices.slice(0, 5).map((indice, n) => ({
        fila: numeroFila(filas[indice], indice),
        nombre: filas[indice].name || "Sin nombre",
        ...(valores[n] !== undefined && valores[n] !== "" ? { valor: valores[n] } : {}),
      })),
    };
  });
}

/** Resultado de aplicar una corrección: filas nuevas y, si corresponde, un ajuste de opciones. */
export type ResultadoCorreccion<T extends Fila> = { filas: T[]; activarPrecioSugerido?: boolean };

export function aplicarCorreccion<T extends Fila>(
  filas: T[],
  problema: ProblemaImportacion,
  contexto: ContextoImportacion,
): ResultadoCorreccion<T> {
  const correccion = problema.correccion;
  if (!correccion) return { filas };
  const afectadas = new Set(analizar(filas, contexto).get(problema.id)?.indices ?? []);

  switch (correccion.tipo) {
    case "activar_precio_sugerido":
      return { filas, activarPrecioSugerido: true };
    case "quitar_filas":
      return { filas: filas.filter((_, i) => !afectadas.has(i)) };
    case "conservar_ultima": {
      const ultima = new Map<string, number>();
      filas.forEach((fila, i) => { if (fila.name.trim()) ultima.set(claveDe(fila), i); });
      return { filas: filas.filter((fila, i) => !fila.name.trim() || ultima.get(claveDe(fila)) === i) };
    }
    case "quitar_campo": {
      const campos = correccion.campo === "cost" ? ["cost_ars", "cost_usd"] : [correccion.campo];
      return {
        filas: filas.map((fila, i) => {
          if (!afectadas.has(i)) return fila;
          const copia = { ...fila, provided: fila.provided.filter(c => !campos.includes(c)) } as T;
          for (const campo of campos) delete (copia as Record<string, unknown>)[campo];
          return copia;
        }),
      };
    }
  }
}

/** Recalcula los contadores del resumen después de una corrección. */
export function contadoresImportacion(filas: Fila[]) {
  const codigos = new Map<string, number>();
  let negativeStock = 0; let fractionalStock = 0;
  for (const fila of filas) {
    const sku = String(fila.sku ?? "").trim().toLowerCase();
    if (sku) codigos.set(sku, (codigos.get(sku) ?? 0) + 1);
    const stock = parseImportNumber(fila.stock);
    if (stock !== null && stock < 0) negativeStock += 1;
    if (stock !== null && !Number.isInteger(stock)) fractionalStock += 1;
  }
  return { negativeStock, fractionalStock, duplicateCodes: [...codigos.values()].filter(n => n > 1).length };
}

/**
 * Arreglo sugerido para cada mensaje de `stage_product_import`. Las claves son
 * los textos exactos del servidor; un test verifica que sigan existiendo en SQL.
 */
export const ARREGLO_ERROR_SERVIDOR: Record<string, string> = {
  "Falta el nombre": "Completá el nombre o quitá la fila; suele ser un renglón de título o subtotal.",
  "El costo no es un número válido": "Corregí el costo en la planilla o importá sin costo.",
  "El costo ARS no es un número válido": "Corregí el costo en la planilla o importá sin costo.",
  "Elegí una sola moneda de costo": "Asigná una sola columna de costo y confirmá su moneda.",
  "Falta una cotización USD válida": "Cargá la cotización USD → ARS o cambiá la moneda del costo a pesos.",
  "El precio no es un número válido": "Corregí el precio o activá el precio sugerido desde el costo.",
  "El precio de oferta no es un número válido": "Corregí la oferta o quitá esa columna.",
  "El stock no es un número válido": "Corregí el stock o elegí “Conservar stock actual”.",
  "El stock debe ser un entero mayor o igual a cero": "Importá sin tocar el stock de esas filas y ajustalo con un conteo.",
  "Falta un precio de venta mayor a cero": "Cargá el precio o activá el precio sugerido desde el costo.",
  "Elegí una sucursal para importar stock": "Elegí la sucursal del stock antes de validar.",
  "El SKU coincide con más de un producto existente": "Tu catálogo ya tiene ese SKU repetido: unificá esos productos antes de importar.",
  "El nombre coincide con más de un producto existente; agregá el código": "Agregá una columna de código/SKU para distinguir productos con el mismo nombre.",
  "La clave está repetida dentro del archivo": "Volvé al paso anterior y usá “Conservar la última de cada código”.",
  "Sin costo: el margen quedará incompleto": "Podés cargar el costo después; el producto se importa igual.",
  "El precio de oferta no es menor al precio de venta": "La oferta no se mostrará como descuento; revisá esas columnas.",
  "Proveedor nuevo: se creará al aplicar": "Si ya existe con otro nombre, unificá la escritura en la planilla para no duplicarlo.",
  "Hay varios proveedores con ese nombre; se usará el activo más antiguo": "Unificá o desactivá los proveedores duplicados en Proveedores.",
};

export function arregloErrorServidor(mensaje: string): string | null {
  return ARREGLO_ERROR_SERVIDOR[mensaje] ?? null;
}
