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
 */

export type FilaCatalogo = { id: string; updated_at?: string | null; name?: string | null };

export type FuentesCatalogo<T extends FilaCatalogo> = {
  leerTodo: () => Promise<T[]>;
  leerCambiosDesde: (desde: string) => Promise<T[]>;
  contar: () => Promise<number | null>;
  leerIds: () => Promise<string[]>;
};

export type GuardadoCatalogo<T> = { filas: T[]; maxUpdatedAt: string | null; completoAt: number; version: number };

export type AlmacenCatalogo<T> = {
  leer: (clave: string) => Promise<GuardadoCatalogo<T> | null>;
  guardar: (clave: string, valor: GuardadoCatalogo<T>) => Promise<void>;
};

export const VERSION_CACHE = 1;
export const MARGEN_MS = 10 * 60_000;
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
  const [cambios, total] = await Promise.all([fuentes.leerCambiosDesde(desde), fuentes.contar()]);
  const porId = new Map(guardado.filas.map(f => [f.id, f]));
  for (const fila of cambios) porId.set(fila.id, fila);

  // Borrados: si el conteo del servidor no coincide, se reconcilia por ids.
  if (total !== null && total !== porId.size) {
    const vivos = new Set(await fuentes.leerIds());
    for (const id of [...porId.keys()]) if (!vivos.has(id)) porId.delete(id);
    if (vivos.size !== porId.size) {
      // Faltan filas que el margen no trajo: más seguro releer todo.
      const filas = await fuentes.leerTodo();
      await almacen?.guardar(clave, { filas, maxUpdatedAt: maxUpdated(filas), completoAt: ahora, version: VERSION_CACHE }).catch(() => undefined);
      return { filas, modo: "completo" };
    }
  }

  const filas = [...porId.values()];
  await almacen?.guardar(clave, { filas, maxUpdatedAt: maxUpdated(cambios, guardado.maxUpdatedAt), completoAt: guardado.completoAt, version: VERSION_CACHE }).catch(() => undefined);
  return { filas, modo: "incremental" };
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
