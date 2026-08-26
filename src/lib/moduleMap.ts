/**
 * Mapa ruta → módulo de permisos, derivado del Route Manifest.
 *
 * ── Lo que había acá, y por qué falló ─────────────────────────────────────
 *
 * Este archivo tenía dos tablas escritas a mano: `ROUTE_MODULE` con 24 rutas
 * exactas, y `SECTION_MODULE` como fallback por sección del sidebar. La idea
 * era buena —no repetir el módulo en cada ruta— pero el fallback dependía de
 * que los nombres de sección coincidieran con los de la navegación, y **eso
 * dejó de ser cierto sin que nada fallara**.
 *
 * Medido el 2026-08-26: `SECTION_MODULE` tenía `principal`, `inventario`,
 * `ventas`, `analytics` y `admin`; la navegación ya usaba `diario`, `trabajo`,
 * `compras`, `cobranzas`, `reportes` y `sistema`. **Coincidían 2 de 8.** Para
 * los otros seis grupos el fallback devolvía `""`, que significa "sin
 * restricción": **29 de 70 destinos ignoraban los toggles de permisos**,
 * incluidos `/ventas`, `/ajustes`, `/kardex`, `/deudas` y `/analytics`.
 *
 * Es el mismo bug que el docstring anterior decía haber arreglado —"se podía
 * apagar Ventas o Configuración y no pasaba nada"— reintroducido al renombrar
 * los grupos del sidebar.
 *
 * ── Lo que lo evita ───────────────────────────────────────────────────────
 *
 * **No hay más fallback.** Cada ruta declara su módulo en
 * `src/app/routeManifest.ts`, y una abierta necesita `openReason` escrito. Un
 * módulo que no coincide con ninguna ruta no puede aparecer por accidente: lo
 * que no está declarado devuelve `""` y el test lo señala.
 */
import { moduleForPath } from "@/app/routeManifest";

/**
 * Devuelve el módulo de permisos de una ruta, o `""` si no está restringida.
 *
 * El segundo parámetro existía para el fallback por sección y ya no se usa. Se
 * conserva en la firma para no romper a los llamadores; se ignora a propósito.
 */
export function moduleForRoute(path: string, _section?: string): string {
  return moduleForPath(path);
}
