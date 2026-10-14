/**
 * Catálogo con caché local y sincronización incremental.
 *
 * Medido 2026-10-10: el catálogo real de una ferretería (7.378 productos)
 * pesaba 8,7 MB de JSON y se descargaba entero cada vez que se abría
 * Productos, la caja o cualquiera de las 28 pantallas que llaman a
 * getProductsDB. Con 11.000 productos son ~13 MB por pantalla.
 *
 * Ahora la primera carga baja todo y lo guarda en IndexedDB; las siguientes
 * piden sólo lo que cambió desde el último `updated_at` visto (índice
 * products(org_id, updated_at)), con un margen para transacciones largas, y
 * detectan borrados comparando el conteo (si no cuadra, traen sólo los ids).
 * Cada 6 horas se resincroniza completo. La caché es por organización y
 * usuario; si IndexedDB no está disponible se cae a la lectura completa.
 *
 * 2026-10-14, «con más de 1.000 productos la plataforma se vuelve súper lenta
 * y se cae» (dueño). Con 5.500 productos (7,1 MB) cada pantalla:
 * · releía la copia entera de IndexedDB y la volvía a escribir entera aunque
 *   no hubiera cambiado nada;
 * · tenía su propia copia: el Inicio monta varios paneles que piden el
 *   catálogo a la vez, y cada uno sincronizaba y guardaba en paralelo;
 * · después de una importación o un cambio masivo de precios, volvía a bajar
 *   enteros todos los productos tocados en los últimos 10 minutos.
 * Ahora la copia vive una vez por pestaña (`almacenConMemoria`), las
 * sincronizaciones simultáneas comparten la misma, sólo se escribe si algo
 * cambió, y lo incremental pide primero id + fecha de cambio y baja completos
 * sólo los productos que de verdad cambiaron (`leerVersionesDesde` +
 * `leerPorIds`).
 */

export type FilaCatalogo = { id: string; updated_at?: string | null; name?: string | null };

export type FuentesCatalogo<T extends FilaCatalogo> = {
  leerTodo: () => Promise<T[]>;
  leerCambiosDesde: (desde: string) => Promise<T[]>;
  contar: () => Promise<number | null>;
  leerIds: () => Promise<string[]>;
  /** Sólo id + fecha de cambio desde `desde`: liviano aunque se hayan tocado miles. */
  leerVersionesDesde?: (desde: string) => Promise<Array<{ id: string; updated_at: string | null }>>;
  /** Filas completas de esos ids (sólo las que cambiaron de verdad). */
  leerPorIds?: (ids: string[]) => Promise<T[]>;
};

export type GuardadoCatalogo<T> = { filas: T[]; maxUpdatedAt: string | null; completoAt: number; version: number };

export type AlmacenCatalogo<T> = {
  leer: (clave: string) => Promise<GuardadoCatalogo<T> | null>;
  guardar: (clave: string, valor: GuardadoCatalogo<T>) => Promise<void>;
};

export const VERSION_CACHE = 1;
// Para transacciones que confirman después de leer (un lote de importación
// tarda segundos). Con versiones livianas, el margen ya no re-baja productos.
export const MARGEN_MS = 2 * 60_000;
export const RESYNC_COMPLETO_MS = 6 * 3600_000;

const maxUpdated = <T extends FilaCatalogo>(filas: T[], inicial: string | null = null) =>
  filas.reduce<string | null>((max, f) => (f.updated_at && (!max || f.updated_at > max) ? f.updated_at : max), inicial);

export async function sincronizarCatalogo<T extends FilaCatalogo>(
  clave: string,
  fuentes: FuentesCatalogo<T>,
  almacen: AlmacenCatalogo<T> | null,
  ahora = Date.now(),
): Promise<{ filas: T[]; modo: "completo" | "incremental" }> {
  let guardado: GuardadoCatalogo<T> | null = null;
  try { guardado = almacen ? await almacen.leer(clave) : null; } catch { guardado = null; }

  const vigente = guardado && guardado.version === VERSION_CACHE && guardado.maxUpdatedAt
    && ahora - guardado.completoAt < RESYNC_COMPLETO_MS;

  if (!vigente || !guardado) {
    const filas = await fuentes.leerTodo();
    await almacen?.guardar(clave, { filas, maxUpdatedAt: maxUpdated(filas), completoAt: ahora, version: VERSION_CACHE }).catch(() => undefined);
    return { filas, modo: "completo" };
  }

  const desde = new Date(new Date(guardado.maxUpdatedAt!).getTime() - MARGEN_MS).toISOString();
  const porId = new Map(guardado.filas.map(f => [f.id, f]));
  const [cambios, total] = await Promise.all([leerCambios(fuentes, desde, porId), fuentes.contar()]);
  for (const fila of cambios) porId.set(fila.id, fila);
  let huboCambios = cambios.length > 0;

  // Borrados: si el conteo del servidor no coincide, se reconcilia por ids.
  if (total !== null && total !== porId.size) {
    const vivos = new Set(await fuentes.leerIds());
    for (const id of [...porId.keys()]) if (!vivos.has(id)) { porId.delete(id); huboCambios = true; }
    if (vivos.size !== porId.size) {
      // Faltan filas que el margen no trajo: más seguro releer todo.
      const filas = await fuentes.leerTodo();
      await almacen?.guardar(clave, { filas, maxUpdatedAt: maxUpdated(filas), completoAt: ahora, version: VERSION_CACHE }).catch(() => undefined);
      return { filas, modo: "completo" };
    }
  }

  // Sin cambios: la misma copia, sin reescribir 7–15 MB en el navegador.
  if (!huboCambios) return { filas: guardado.filas, modo: "incremental" };
  const filas = [...porId.values()];
  await almacen?.guardar(clave, { filas, maxUpdatedAt: maxUpdated(cambios, guardado.maxUpdatedAt), completoAt: guardado.completoAt, version: VERSION_CACHE }).catch(() => undefined);
  return { filas, modo: "incremental" };
}

/** Lo que cambió desde `desde`: en dos pasos si la fuente lo permite. */
async function leerCambios<T extends FilaCatalogo>(fuentes: FuentesCatalogo<T>, desde: string, actuales: Map<string, T>): Promise<T[]> {
  if (!fuentes.leerVersionesDesde || !fuentes.leerPorIds) return fuentes.leerCambiosDesde(desde);
  const versiones = await fuentes.leerVersionesDesde(desde);
  const distintos = versiones.filter(v => (actuales.get(v.id)?.updated_at ?? null) !== v.updated_at || !actuales.has(v.id)).map(v => v.id);
  return distintos.length ? fuentes.leerPorIds(distintos) : [];
}

/**
 * Una copia del catálogo por pestaña: las pantallas que lo piden después de
 * la primera no vuelven a leer (ni a clonar) IndexedDB. Escribe en memoria y
 * en el almacén de abajo.
 */
export function almacenConMemoria<T>(abajo: AlmacenCatalogo<T> | null, memoria = memoriaCompartida as Map<string, GuardadoCatalogo<T>>): AlmacenCatalogo<T> {
  return {
    async leer(clave) {
      const enMemoria = memoria.get(clave);
      if (enMemoria) return enMemoria;
      const guardado = abajo ? await abajo.leer(clave) : null;
      if (guardado) memoria.set(clave, guardado);
      return guardado;
    },
    async guardar(clave, valor) {
      memoria.set(clave, valor);
      await abajo?.guardar(clave, valor);
    },
  };
}
const memoriaCompartida = new Map<string, GuardadoCatalogo<unknown>>();

/** Pedidos simultáneos de la misma clave comparten una sola sincronización. */
const enCurso = new Map<string, Promise<unknown>>();
export function unaVezALaVez<R>(clave: string, trabajo: () => Promise<R>): Promise<R> {
  const actual = enCurso.get(clave) as Promise<R> | undefined;
  if (actual) return actual;
  const nuevo = trabajo().finally(() => enCurso.delete(clave));
  enCurso.set(clave, nuevo);
  return nuevo;
}

// ── IndexedDB ────────────────────────────────────────────────────────────────
const DB = "nerqia-cache";
const STORE = "catalogo";

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function almacenIndexedDb<T>(): AlmacenCatalogo<T> | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    async leer(clave) {
      const db = await abrirDb();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(clave);
        req.onsuccess = () => resolve((req.result as GuardadoCatalogo<T>) ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async guardar(clave, valor) {
      const db = await abrirDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(valor, clave);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}
