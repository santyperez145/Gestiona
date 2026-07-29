/**
 * Recarga "de verdad": desregistra el service worker y borra sus cachés antes
 * de recargar.
 *
 * Un F5 común no alcanza cuando el SW está sirviendo assets viejos: vuelve a
 * leer el mismo caché y la pantalla queda igual. Esto es la salida de
 * emergencia cuando la app quedó pegada a una versión anterior.
 */
export async function hardReload() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {
    // Si algo falla igual recargamos: peor es dejar al usuario trabado.
  }
  window.location.reload();
}
