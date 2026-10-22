/**
 * ¿Está Nerqia, o está caída la conexión del comercio? (2026-10-21)
 *
 * El 19/10 la base quedó inactiva y el ingreso decía «Revisá tu conexión»: le
 * echaba la culpa al comercio de un problema nuestro. Para distinguirlo se
 * consultan dos cosas:
 *
 *   · el servidor de datos (`/auth/v1/health`): si responde, Nerqia anda;
 *   · nuestro propio sitio (`/favicon.ico`): si responde y el servidor no, el
 *     problema es de Nerqia; si tampoco responde, es la conexión.
 *
 * Un 4xx del servidor significa que contestó: no se lo toma como caída.
 */

export type Disponibilidad = "disponible" | "caido" | "sin_conexion";

interface Opciones {
  urlServidor: string;
  clave: string;
  fetcher?: typeof fetch;
  enLinea?: boolean;
  timeoutMs?: number;
}

async function responde(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, cache: "no-store", signal: control.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(corte);
  }
}

export async function comprobarServicio({ urlServidor, clave, fetcher = fetch, enLinea = true, timeoutMs = 6000 }: Opciones): Promise<Disponibilidad> {
  if (!enLinea) return "sin_conexion";
  // Sin servidor configurado no hay nada que medir: no se alarma a nadie.
  if (!urlServidor) return "disponible";
  const salud = await responde(fetcher, `${urlServidor.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: clave } }, timeoutMs);
  if (salud && salud.status < 500) return "disponible";
  const sitio = await responde(fetcher, `/favicon.ico?disponibilidad=${Date.now()}`, { method: "HEAD" }, timeoutMs);
  return sitio && sitio.ok ? "caido" : "sin_conexion";
}

export const MENSAJE_SERVICIO_CAIDO =
  "Nerqia no está disponible en este momento. Tus datos están guardados y no se perdió nada: volvé a probar en unos minutos.";
export const MENSAJE_SIN_CONEXION =
  "No hay conexión a internet. Cuando vuelva, Nerqia sigue donde lo dejaste.";
