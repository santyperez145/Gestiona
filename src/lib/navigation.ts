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
 * siempre a la vista, sin encabezado — Inicio, Tienda y Pedidos online primero.
 * `commerce` agrupa envíos, cupones y promociones. El resto vive en grupos que
 * arrancan cerrados salvo el que contiene la página actual.
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
import { financeProductRoutes, influencerMarketingProductRoutes, navRoutes, type NavGroupId, type NavRole } from "@/app/routeManifest";

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
  { id: "diario",    label: "",            hint: "Lo de todos los días — Inicio, Tienda y Pedidos online primero" },
  { id: "commerce",  label: "Venta online", hint: "Tienda online, pedidos, envíos y cobros online" },
  { id: "business",  label: "Stock y compras", hint: "Inventario, compras, proveedores y sucursales" },
  { id: "marketing", label: "Marketing",    hint: "Campañas, email, WhatsApp y fidelización" },
  { id: "finance",   label: "Cobros y facturación", hint: "Cuentas por cobrar, facturas ARCA e impuestos" },
  { id: "reportes",  label: "Reportes",    hint: "Ventas, márgenes y estadísticas del negocio" },
  { id: "sistema",   label: "Configuración", hint: "Ajustes, equipo, integraciones y ayuda" },
];

const NAV_ORDER_BY_GROUP: Record<NavGroupId, string[]> = {
  diario: ["/", "/tienda-online", "/pedidos-online", "/caja", "/ventas", "/productos", "/clientes"],
  commerce: ["/tienda-online", "/pedidos-online", "/productos", "/envios", "/links-de-pago", "/cupones", "/promociones"],
  business: ["/caja", "/ventas", "/compras", "/ordenes-compra", "/proveedores", "/kardex", "/transferencias", "/sucursales", "/lotes", "/bundles", "/listas-precios", "/valuacion-inventario"],
  marketing: ["/marketing", "/email-campaigns", "/whatsapp-campaigns", "/fidelidad", "/catalogo", "/afiliados", "/referidos"],
  influencers: ["/influencers", "/canjes", "/brief-composer", "/campaign-matching"],
  "influencer-marketing": ["/influencer-marketing"],
  finance: ["/deudas", "/presupuestos", "/cuotas", "/facturas", "/devoluciones", "/billetera", "/movimientos", "/comisiones", "/impuestos", "/afip", "/multi-divisa", "/cheques", "/suscripciones"],
  reportes: ["/reportes", "/ia"],
  sistema: ["/soporte", "/alertas", "/integraciones", "/equipo", "/ajustes", "/admin", "/calidad-datos", "/mi-plan", "/perfil"],
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

/** Otras superficies no ocupan el sidebar Business, pero sí el buscador global. */
export const PRODUCT_NAV_ITEMS: NavItem[] = [...financeProductRoutes(), ...influencerMarketingProductRoutes()]
  .filter(route => route.nav)
  .map(route => ({
    to: route.path,
    label: route.nav!.label,
    icon: route.nav!.icon,
    roles: route.roles,
    group: route.nav!.group,
    keywords: route.nav!.keywords,
  }));

export const GLOBAL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, ...PRODUCT_NAV_ITEMS];

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
  const globalesOrdenados = ordenarNavItems(GLOBAL_NAV_ITEMS);
  const permitidos = roles ? globalesOrdenados.filter(i => i.roles.includes(roles)) : globalesOrdenados;
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

// ─── Perfil del menú ─────────────────────────────────────────────────────────
//
// Un comercio que recién empieza veía las mismas ~50 entradas que uno con
// sucursales, cheques y multi-moneda. El perfil decide qué queda a la vista;
// lo demás va a «Más herramientas» al final del menú y sigue en Ctrl+K. Nada
// se pierde, y la página en la que estás siempre se ve.
//
// Sin perfil elegido (o sin la columna todavía) el menú es el completo: un
// comercio que ya trabaja no pierde de vista nada que usa.

export type PerfilMenu = "emprendedor" | "establecido" | "avanzado";

export const PERFILES_MENU: Array<{ id: PerfilMenu; label: string; descripcion: string }> = [
  { id: "emprendedor", label: "Emprendedor", descripcion: "Lo esencial: vender, cobrar, productos, clientes y facturas." },
  { id: "establecido", label: "Establecido", descripcion: "Suma compras, stock, promociones, envíos, marketing e impuestos." },
  { id: "avanzado", label: "Avanzado", descripcion: "Todo: sucursales, lotes, cheques, multi-moneda, inteligencia y administración." },
];

/**
 * En qué perfil aparece cada destino: 1 emprendedor, 2 establecido, 3
 * avanzado. Explícito para todos los destinos del menú —lo exige un test—:
 * una pantalla nueva tiene que decidir dónde aparece.
 */
export const NIVEL_DE_DESTINO: Record<string, 1 | 2 | 3> = {
  // Lo de todos los días
  "/": 1, "/caja": 1, "/ventas": 1, "/productos": 1, "/clientes": 1,
  "/tienda-online": 1, "/pedidos-online": 1,
  // Cobros y facturación
  "/facturas": 1, "/deudas": 1,
  "/afip": 2, "/presupuestos": 2, "/cuotas": 2, "/devoluciones": 2, "/billetera": 2, "/impuestos": 2,
  "/movimientos": 3, "/cheques": 3, "/comisiones": 3, "/multi-divisa": 3, "/suscripciones": 3,
  // Stock y compras
  "/compras": 1, "/proveedores": 1,
  "/kardex": 2, "/ordenes-compra": 2, "/planificacion": 2, "/sucursales": 2, "/listas-precios": 2,
  "/transferencias": 3, "/lotes": 3, "/bundles": 3, "/valuacion-inventario": 3,
  // Venta online
  "/envios": 2, "/links-de-pago": 2, "/cupones": 2, "/promociones": 2,
  // Marketing
  "/marketing": 2, "/email-campaigns": 2, "/whatsapp-campaigns": 2, "/fidelidad": 2,
  // Reportes
  "/reportes": 1, "/ia": 3,
  // Configuración y ayuda
  "/ajustes": 1, "/equipo": 1, "/mi-plan": 1, "/perfil": 1, "/soporte": 1, "/aprender": 1,
  "/integraciones": 2, "/alertas": 2, "/tareas": 2, "/calendario": 2,
  "/calidad-datos": 3, "/admin": 3,
};

const TOPE_DE_PERFIL: Record<PerfilMenu, 1 | 2 | 3> = { emprendedor: 1, establecido: 2, avanzado: 3 };

export function esPerfilMenu(valor: unknown): valor is PerfilMenu {
  return valor === "emprendedor" || valor === "establecido" || valor === "avanzado";
}

/** ¿El destino queda a la vista con este perfil? Sin perfil: todo a la vista. */
export function apareceEnPerfil(path: string, perfil: PerfilMenu | null | undefined): boolean {
  if (!perfil) return true;
  return (NIVEL_DE_DESTINO[path] ?? 2) <= TOPE_DE_PERFIL[perfil];
}
