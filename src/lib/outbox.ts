/**
 * Outbox — el espejo en cliente del motor de eventos (H2).
 *
 * La entrega la hace la base: `outbox_despachar` y `outbox_confirmar` corren
 * por cron y el navegador no participa. Lo que vive acá es lo que el panel
 * necesita para **mostrar** el estado de la cola sin volver a inventar las
 * reglas, y la cuenta del backoff, que tiene que dar igual de los dos lados
 * para que la pantalla no prometa un reintento que no va a pasar.
 *
 * ── Por qué importa que se vea ────────────────────────────────────────────
 *
 * Una cola sin tablero es una cola que se tapa en silencio. Y el número que
 * importa **no es cuántas hay pendientes**: mil pendientes de hace dos segundos
 * es un pico normal, y una sola de hace seis horas es un incidente. Por eso la
 * salud se juzga por antigüedad y no por volumen.
 */

/** Estados posibles de una entrega. Espejo del CHECK de `outbox_events`. */
export type EstadoEntrega =
  | "pendiente"    // esperando al worker
  | "en_curso"     // mandada, sin respuesta todavía
  | "entregado"    // 2xx confirmado
  | "fallado"      // va a reintentarse
  | "descartado";  // agotó los intentos; queda como evidencia

/**
 * Cuánto se espera antes del próximo intento, en segundos.
 *
 * Exponencial con techo, espejo de `public.outbox_espera`. Sin techo, el
 * intento 15 caería dentro de un año; sin exponencial, un destino caído recibe
 * un martillazo por segundo justo cuando menos lo aguanta.
 *
 * @param intentos Cuántos van hechos. 0 = todavía ninguno.
 */
export function esperaDeReintento(intentos: number): number {
  const n = Math.max(0, Math.floor(Number(intentos) || 0));
  // 2^n × 30s, con techo de una hora. Los primeros pasos son 30s, 1m, 2m, 4m…
  return Math.min(Math.pow(2, n) * 30, 3600);
}

/** "en 2 minutos", para mostrarle al comercio cuándo se reintenta. */
export function textoDeEspera(segundos: number): string {
  const s = Math.max(0, Math.round(Number(segundos) || 0));
  if (s < 60) return `en ${s} segundos`;
  const m = Math.round(s / 60);
  if (m < 60) return `en ${m} minuto${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  return `en ${h} hora${h === 1 ? "" : "s"}`;
}

export interface SaludOutbox {
  pendientes: number;
  en_curso: number;
  fallados: number;
  descartados: number;
  entregados: number;
  /** Antigüedad de la entrega sin resolver más vieja. `null` si no hay ninguna. */
  minutos_del_mas_viejo: number | null;
}

export type NivelSalud = "ok" | "atencion" | "incidente";

export interface DiagnosticoOutbox {
  nivel: NivelSalud;
  titulo: string;
  detalle: string;
}

/**
 * Cómo está la cola, en una frase.
 *
 * Los umbrales están acá y no dispersos en la UI porque son una decisión de
 * producto: **15 minutos** es el punto donde una demora deja de ser normal —el
 * worker corre cada minuto, así que quince pasadas sin vaciar algo es una
 * señal— y cualquier descarte es un incidente aunque la cola esté vacía,
 * porque significa que algo no llegó y ya no va a llegar solo.
 */
export function diagnosticarOutbox(s: SaludOutbox | null | undefined): DiagnosticoOutbox {
  const pendientes = Number(s?.pendientes ?? 0) + Number(s?.fallados ?? 0) + Number(s?.en_curso ?? 0);
  const descartados = Number(s?.descartados ?? 0);
  const viejo = s?.minutos_del_mas_viejo == null ? null : Number(s.minutos_del_mas_viejo);

  // Un descarte es lo más grave: no se resuelve esperando.
  if (descartados > 0) {
    return {
      nivel: "incidente",
      titulo: `${descartados} ${descartados === 1 ? "aviso no llegó" : "avisos no llegaron"}`,
      detalle: "Agotaron los reintentos. Revisá el destino y reintentá a mano.",
    };
  }

  if (viejo != null && viejo >= 15) {
    return {
      nivel: "incidente",
      titulo: "La cola está trabada",
      detalle: `Hay algo esperando hace ${Math.round(viejo)} minutos. El worker corre cada minuto.`,
    };
  }

  if (viejo != null && viejo >= 5) {
    return {
      nivel: "atencion",
      titulo: "La cola está demorada",
      detalle: `${pendientes} ${pendientes === 1 ? "aviso pendiente" : "avisos pendientes"}, el más viejo de hace ${Math.round(viejo)} minutos.`,
    };
  }

  if (pendientes > 0) {
    return {
      nivel: "ok",
      titulo: "Al día",
      detalle: `${pendientes} ${pendientes === 1 ? "aviso saliendo" : "avisos saliendo"}.`,
    };
  }

  return { nivel: "ok", titulo: "Al día", detalle: "No hay nada pendiente de entregar." };
}

/**
 * Valida el destino de una suscripción antes de guardarla.
 *
 * ⚠️ Sólo http(s), y **nunca localhost ni una IP privada**. Un webhook es una
 * URL que el servidor va a visitar con las credenciales del sistema: apuntarla
 * a `169.254.169.254` o a `localhost` convierte la suscripción en una forma de
 * leer la red interna desde afuera. Es el mismo criterio que ya rige para los
 * links del menú de la tienda, donde un `javascript:` sería un XSS servido.
 */
export function destinoValido(url: string | null | undefined): { ok: boolean; motivo?: string } {
  const crudo = String(url ?? "").trim();
  if (crudo === "") return { ok: false, motivo: "Falta la dirección" };

  let u: URL;
  try {
    u = new URL(crudo);
  } catch {
    return { ok: false, motivo: "No es una dirección válida" };
  }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, motivo: "Solo http o https" };
  }

  const host = u.hostname.toLowerCase();
  const privada =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]";

  if (privada) {
    return { ok: false, motivo: "No se puede apuntar a una dirección interna" };
  }

  return { ok: true };
}

/**
 * Un tipo de evento es `dominio.accion`, en pasado. Espejo de la validación de
 * `emitir_evento`.
 *
 * Un evento es algo que **ya ocurrió**. Si se lee como una orden —"crear.orden"—
 * es un comando disfrazado, y un comando puede rechazarse; un evento no.
 */
export function tipoDeEventoValido(tipo: string | null | undefined): boolean {
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(String(tipo ?? ""));
}

/**
 * ¿Este patrón de suscripción matchea este tipo de evento?
 *
 * Espejo del `LIKE` de Postgres, con `%` como comodín. Sirve para previsualizar
 * en el panel qué eventos va a recibir una suscripción antes de guardarla —
 * suscribirse a ciegas y esperar a que llegue algo es cómo se descubre tarde
 * que el patrón estaba mal escrito.
 */
export function patronMatchea(patron: string, tipo: string): boolean {
  const p = String(patron ?? "");
  if (p === "") return false;
  // Se escapa todo menos `%`, que es el único comodín que entiende LIKE. `_`
  // también lo es en SQL, y ya mordió a este repo: `LIKE '%_iva%'` matcheaba
  // "inactiva". Acá se trata como literal a propósito, porque en un nombre de
  // evento el guión bajo es parte de la palabra.
  const rx = p
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*");
  return new RegExp(`^${rx}$`).test(String(tipo ?? ""));
}
