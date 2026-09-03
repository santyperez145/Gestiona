/**
 * Navegación — vista del Route Manifest.
 *
 * ── Por qué esto ya no tiene los destinos escritos ────────────────────────
 *
 * Los 70 items vivían acá y sus permisos en `moduleMap.ts`, con las secciones
 * duplicadas entre los dos. Divergieron: el 2026-08-26 se midió que **29 de
 * los 70 destinos no tenían módulo de permisos** porque los nombres de grupo
 * de este archivo (`diario`, `trabajo`, `compras`…) ya no coincidían con las
 * claves de `SECTION_MODULE` (`principal`, `inventario`, `ventas`…) —
 * coincidían 2 de 8— y el fallback devolvía "sin restricción".
 *
 * Ahora los destinos son uno solo: `src/app/routeManifest.ts`. Este módulo
 * conserva lo que sí es suyo —agrupar, plegar y buscar— y expone la misma API
 * de antes para no tocar a sus consumidores.
 *
 * ── Las tres decisiones que siguen valiendo ───────────────────────────────
 *
 * **1. Jerarquía por uso, no por catálogo.** Los destinos `diario` quedan
 * siempre a la vista, sin encabezado — Inicio y Tienda online primero.
 * `commerce` agrupa envíos, cupones y promociones junto a la puerta de venta
 * online. El resto vive en grupos que arrancan cerrados salvo el que contiene
 * la página actual.
 *
 * **2. Lenguaje de tarea, no de jerga.** "Kardex" es "Movimientos de stock";
 * "RFM" es "Segmentación de clientes". El comercio piensa "¿cuánto stock
 * tengo?", no "Kardex".
 *
 * **3. Renombrar sólo es seguro si el buscador conoce el nombre viejo.** Cada
 * item lleva `keywords` con la jerga anterior. Quien escriba "kardex", "P&L" o
 * "libro mayor" llega igual.
 */
import type { LucideIcon } from "lucide-react";
import { navRoutes, type NavGroupId, type NavRole } from "@/app/routeManifest";

export type { NavGroupId, NavRole };

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: NavRole[];
  group: NavGroupId;
  keywords?: string[];
}

export interface NavGroup {
  id: NavGroupId;
  /** Vacío = sin encabezado; los items se muestran sueltos arriba de todo. */
  label: string;
  /** Ayuda de una línea, para el buscador y la vista de todas las herramientas. */
  hint: string;
}

export const NAV_GROUPS: NavGroup[] = [
  { id: "diario",    label: "",            hint: "Lo de todos los días — Inicio y Tienda online primero" },
  { id: "commerce",  label: "Tienda y canales", hint: "Pedidos online, envíos, cupones y promociones" },
  { id: "trabajo",   label: "Mi trabajo",  hint: "Tareas, seguimientos y calendario" },
  { id: "compras",   label: "Compras y stock", hint: "Reponer, mover y controlar la mercadería" },
  { id: "cobranzas", label: "Cobranzas",   hint: "Lo que falta cobrar y los documentos de venta" },
  { id: "finanzas",  label: "Contabilidad", hint: "Gastos, libro, banco e impuestos del Business Core — no es Gestiona Finance" },
  { id: "marketing", label: "Marketing",   hint: "Campañas, email, WhatsApp y fidelidad" },
  { id: "reportes",  label: "Reportes",    hint: "Ver cómo viene el negocio" },
  { id: "sistema",   label: "Sistema",     hint: "Configuración, equipo e integraciones" },
];

const NAV_ORDER_BY_GROUP: Record<NavGroupId, string[]> = {
  diario: ["/", "/tienda-online", "/caja", "/ventas", "/productos", "/clientes"],
  commerce: ["/pedidos-online", "/envios", "/links-de-pago", "/cupones", "/promociones"],
  trabajo: ["/tareas", "/calendario"],
  compras: [
    "/compras", "/ordenes-compra", "/proveedores", "/planificacion",
    "/kardex", "/transferencias", "/sucursales", "/lotes",
    "/bundles", "/listas-precios", "/valuacion-inventario",
  ],
  cobranzas: ["/deudas", "/presupuestos", "/cuotas", "/facturas", "/devoluciones"],
  finanzas: [
    "/billetera", "/movimientos", "/cash-flow", "/pl-dashboard",
    "/libro", "/banco", "/gastos", "/comisiones",
    "/impuestos", "/afip", "/multi-divisa", "/cheques", "/suscripciones",
  ],
  marketing: [
    "/marketing", "/email-campaigns", "/whatsapp-campaigns",
    "/fidelidad", "/catalogo", "/influencers", "/canjes",
    "/afiliados", "/referidos",
  ],
  reportes: ["/reportes", "/analytics", "/ia"],
  sistema: ["/alertas", "/integraciones", "/equipo", "/ajustes", "/admin", "/calidad-datos", "/mi-plan", "/perfil"],
};

function ordenarNavItems(items: NavItem[]): NavItem[] {
  const fallbackIndex = new Map(items.map((item, idx) => [item.to, idx]));
  const orderIndex = new Map<string, number>();
  for (const [group, paths] of Object.entries(NAV_ORDER_BY_GROUP) as Array<[NavGroupId, string[]]>) {
    paths.forEach((path, idx) => orderIndex.set(`${group}:${path}`, idx));
  }
  return [...items].sort((a, b) => {
    const ai = orderIndex.get(`${a.group}:${a.to}`) ?? Number.MAX_SAFE_INTEGER;
    const bi = orderIndex.get(`${b.group}:${b.to}`) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return (fallbackIndex.get(a.to) ?? 0) - (fallbackIndex.get(b.to) ?? 0);
  });
}

/**
 * Los destinos del sidebar, derivados del manifest.
 *
 * `to` en vez de `path` porque es la forma que ya consumen `AppLayout` y el
 * Command Palette; renombrarla sería churn sin beneficio.
 */
export const NAV_ITEMS: NavItem[] = navRoutes().map(r => ({
  to: r.path,
  label: r.nav!.label,
  icon: r.nav!.icon,
  roles: r.roles,
  group: r.nav!.group,
  keywords: r.nav!.keywords,
}));

export const NAV_ITEMS_ORDENADOS: NavItem[] = ordenarNavItems(NAV_ITEMS);

/** Los que van siempre a la vista, sin encabezado ni plegado. */
export const ITEMS_DIARIOS = NAV_ITEMS_ORDENADOS.filter(i => i.group === "diario");

/** Los grupos plegables, en orden, ya sin el diario. */
export const GRUPOS_PLEGABLES = NAV_GROUPS.filter(g => g.id !== "diario");

export function itemsDe(group: NavGroupId): NavItem[] {
  return NAV_ITEMS_ORDENADOS.filter(i => i.group === group);
}

/** En qué grupo cae una ruta, para abrir el correcto al entrar. */
export function grupoDeRuta(path: string): NavGroupId | null {
  return NAV_ITEMS_ORDENADOS.find(i => i.to === path)?.group ?? null;
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
  const permitidos = roles ? NAV_ITEMS_ORDENADOS.filter(i => i.roles.includes(roles)) : NAV_ITEMS_ORDENADOS;
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
