/**
 * El menú del header de la tienda.
 *
 * Hasta la sesión 95 se armaba solo —Inicio, Productos, las dos primeras
 * categorías y Ofertas— y no había forma de sacar un link, renombrarlo, ni
 * subir una página de contenido como "Cómo comprar" o "Envíos", que hoy vive
 * escondida en el pie. Es de las primeras cosas que un comercio quiere tocar y
 * Tiendanube la da desde el principio.
 *
 * **Una lista vacía significa "armalo solo", no "menú vacío".** Es lo que hace
 * que la migración no cambie ninguna tienda el día que se aplica y que una
 * tienda recién creada tenga menú sin configurar nada. Devolver [] ahí dejaría
 * al comprador sin forma de llegar al catálogo.
 */

export type TipoLink = "inicio" | "productos" | "categoria" | "ofertas" | "pagina" | "url";

export interface LinkMenu {
  label: string;
  tipo: TipoLink;
  /** Slug de la categoría o de la página, o la URL. Vacío para inicio/productos/ofertas. */
  valor?: string | null;
}

export interface ItemMenu {
  label: string;
  to: string;
  /** Los externos abren en otra pestaña y no usan el router. */
  externo?: boolean;
}

export const TIPOS: { id: TipoLink; label: string; pideValor: boolean }[] = [
  { id: "inicio",    label: "Inicio",              pideValor: false },
  { id: "productos", label: "Todos los productos", pideValor: false },
  { id: "categoria", label: "Una categoría",       pideValor: true  },
  { id: "ofertas",   label: "Ofertas",             pideValor: false },
  { id: "pagina",    label: "Una página",          pideValor: true  },
  { id: "url",       label: "Un link externo",     pideValor: true  },
];

/** Sólo http(s). Un `javascript:` en el menú de la tienda es un XSS servido. */
export function esUrlSegura(url: string): boolean {
  try {
    const u = new URL(String(url ?? "").trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function destinoDe(link: LinkMenu, base: string): ItemMenu | null {
  const valor = String(link.valor ?? "").trim();
  const label = String(link.label ?? "").trim();
  if (!label) return null;

  switch (link.tipo) {
    case "inicio":    return { label, to: base };
    case "productos": return { label, to: `${base}/productos` };
    case "ofertas":   return { label, to: `${base}/productos?oferta=1` };
    case "categoria":
      return valor ? { label, to: `${base}/productos?cat=${encodeURIComponent(valor)}` } : null;
    case "pagina":
      return valor ? { label, to: `${base}/pagina/${encodeURIComponent(valor)}` } : null;
    case "url":
      // Un link roto o peligroso no se muestra: es preferible un menú más corto
      // que uno que lleva a cualquier lado.
      return esUrlSegura(valor) ? { label, to: valor, externo: true } : null;
    default:
      return null;
  }
}

export interface ContextoMenu {
  base: string;
  /** Categorías con productos, ya ordenadas: `menuDeCategorias`. */
  categorias: { slug: string; label: string }[];
}

/** El menú de siempre, para una tienda que no configuró el suyo. */
export function menuAutomatico({ base, categorias }: ContextoMenu): ItemMenu[] {
  return [
    { label: "Inicio", to: base },
    { label: "Productos", to: `${base}/productos` },
    ...categorias.slice(0, 2).map(c => ({
      label: c.label,
      to: `${base}/productos?cat=${encodeURIComponent(c.slug)}`,
    })),
    { label: "Ofertas", to: `${base}/productos?oferta=1` },
  ];
}

/**
 * El menú que se muestra: el del comercio si configuró alguno **que resuelva a
 * algo**, el automático si no.
 *
 * El matiz importa: una lista con tres links todos rotos —una categoría que se
 * borró, una página despublicada— no puede dejar el header sin nada. En ese
 * caso se vuelve al automático, que siempre lleva al catálogo.
 */
export function menuEfectivo(
  navLinks: unknown,
  contexto: ContextoMenu,
): ItemMenu[] {
  const lista = Array.isArray(navLinks) ? (navLinks as LinkMenu[]) : [];
  const resueltos = lista
    .map(l => destinoDe(l, contexto.base))
    .filter((x): x is ItemMenu => x !== null);

  return resueltos.length > 0 ? resueltos : menuAutomatico(contexto);
}

/** Mensaje de error de un link que está armando el comercio, o `undefined`. */
export function validarLink(link: LinkMenu): string | undefined {
  if (!String(link.label ?? "").trim()) return "Poné un texto para el link";
  if (String(link.label).trim().length > 30) return "El texto es muy largo";

  const tipo = TIPOS.find(t => t.id === link.tipo);
  if (!tipo) return "Elegí a dónde lleva";

  const valor = String(link.valor ?? "").trim();
  if (tipo.pideValor && !valor) {
    return link.tipo === "url" ? "Poné la dirección" : "Elegí cuál";
  }
  if (link.tipo === "url" && !esUrlSegura(valor)) {
    return "La dirección tiene que empezar con http:// o https://";
  }
  return undefined;
}

// ── Submenús ────────────────────────────────────────────────────────────────

export interface ItemMenuConHijos extends ItemMenu {
  hijos: ItemMenu[];
}

/**
 * El menú con un nivel de despliegue, que es lo que hacen Tiendanube y
 * MercadoLibre: "Perfumes ▾" abre "Árabes / Diseñador".
 *
 * Un ítem del menú configurado por el comercio se despliega si apunta a una
 * categoría que tiene hijas; los demás tipos —una página, un link externo— no
 * tienen nada que desplegar y quedan planos.
 */
export function menuConSubmenus(
  items: ItemMenu[],
  hijasPorSlug: Map<string, { slug: string; label: string }[]>,
  base: string,
): ItemMenuConHijos[] {
  return items.map(item => {
    // El slug se saca del propio destino: así funciona igual para el menú
    // automático y para el que armó el comercio, sin arrastrar el tipo hasta acá.
    const m = /[?&]cat=([^&]+)/.exec(item.to);
    const slug = m ? decodeURIComponent(m[1]) : null;
    const hijas = slug ? hijasPorSlug.get(slug) ?? [] : [];
    return {
      ...item,
      hijos: hijas.map(h => ({
        label: h.label,
        to: `${base}/productos?cat=${encodeURIComponent(h.slug)}`,
      })),
    };
  });
}
