/**
 * Temas de la tienda online.
 *
 * El panel deja elegir entre 5 temas desde hace tiempo, pero no existía
 * vitrina que los aplicara. Cada tema define un juego de variables CSS que el
 * `StoreLayout` inyecta en un contenedor; los componentes solo usan las
 * variables, así que agregar un tema no obliga a tocar ninguna página.
 *
 * El `primary_color` que configura el dueño pisa el acento del tema: la marca
 * del negocio manda sobre la plantilla.
 */

export interface StoreTheme {
  id: string;
  label: string;
  /** Una línea para el selector del panel: no adivina rubro. */
  hint: string;
  vars: Record<string, string>;
  /** Clases extra para el contenedor raíz (tipografía, tracking). */
  rootClass: string;
  /** Redondeo de tarjetas y botones. */
  radius: string;
}

const THEMES: Record<string, StoreTheme> = {
  minimal: {
    id: "minimal",
    label: "Minimal",
    hint: "Fondo claro, header blanco",
    rootClass: "font-sans",
    radius: "0.5rem",
    vars: {
      "--st-bg": "0 0% 100%",
      "--st-surface": "0 0% 98%",
      "--st-border": "0 0% 90%",
      "--st-text": "0 0% 9%",
      "--st-muted": "0 0% 45%",
      "--st-accent": "0 0% 9%",
      "--st-accent-fg": "0 0% 100%",
      "--st-header": "0 0% 100%",
      "--st-header-fg": "0 0% 9%",
    },
  },
  bold: {
    id: "bold",
    label: "Bold",
    hint: "Header de color, acento fuerte",
    rootClass: "font-sans",
    radius: "1rem",
    vars: {
      "--st-bg": "48 100% 97%",
      "--st-surface": "0 0% 100%",
      "--st-border": "45 60% 85%",
      "--st-text": "24 10% 10%",
      "--st-muted": "24 6% 40%",
      "--st-accent": "38 92% 50%",
      "--st-accent-fg": "24 10% 10%",
      "--st-header": "38 92% 50%",
      "--st-header-fg": "24 10% 10%",
    },
  },
  luxury: {
    id: "luxury",
    label: "Luxury",
    hint: "Oscuro editorial, serif",
    rootClass: "font-serif tracking-tight",
    radius: "0.25rem",
    vars: {
      "--st-bg": "240 12% 6%",
      "--st-surface": "240 10% 11%",
      "--st-border": "240 8% 20%",
      "--st-text": "40 20% 96%",
      "--st-muted": "40 8% 62%",
      "--st-accent": "43 74% 58%",
      "--st-accent-fg": "240 12% 6%",
      "--st-header": "240 12% 6%",
      "--st-header-fg": "40 20% 96%",
    },
  },
  sport: {
    id: "sport",
    label: "Sport",
    hint: "Header oscuro, acento azul",
    rootClass: "font-sans",
    radius: "0.75rem",
    vars: {
      "--st-bg": "215 30% 97%",
      "--st-surface": "0 0% 100%",
      "--st-border": "215 25% 88%",
      "--st-text": "222 47% 11%",
      "--st-muted": "215 16% 45%",
      "--st-accent": "221 83% 53%",
      "--st-accent-fg": "0 0% 100%",
      "--st-header": "222 47% 11%",
      "--st-header-fg": "0 0% 100%",
    },
  },
  natural: {
    id: "natural",
    label: "Natural",
    hint: "Header verde, formas suaves",
    rootClass: "font-sans",
    radius: "1.25rem",
    vars: {
      "--st-bg": "60 20% 97%",
      "--st-surface": "0 0% 100%",
      "--st-border": "80 15% 85%",
      "--st-text": "120 12% 14%",
      "--st-muted": "120 6% 42%",
      "--st-accent": "158 64% 32%",
      "--st-accent-fg": "0 0% 100%",
      "--st-header": "158 64% 32%",
      "--st-header-fg": "0 0% 100%",
    },
  },
  // Oscuro sin ser Luxury: Luxury es dorado y serif, muy marcado. Éste es
  // neutro, para marcas que quieren fondo oscuro sin la carga de "premium".
  noche: {
    id: "noche",
    label: "Noche",
    hint: "Oscuro neutro, sin dorado",
    rootClass: "font-sans",
    radius: "0.625rem",
    vars: {
      "--st-bg": "222 18% 9%",
      "--st-surface": "222 16% 13%",
      "--st-border": "222 12% 24%",
      "--st-text": "210 20% 96%",
      "--st-muted": "215 14% 62%",
      "--st-accent": "199 89% 55%",
      "--st-accent-fg": "222 18% 9%",
      "--st-header": "222 18% 9%",
      "--st-header-fg": "210 20% 96%",
    },
  },
  // Claro y cálido, con mucho aire. Es el que mejor le sienta a catálogos de
  // pocas fotos grandes, donde Minimal se ve vacío.
  pastel: {
    id: "pastel",
    label: "Pastel",
    hint: "Claro y cálido",
    rootClass: "font-sans",
    radius: "1.5rem",
    vars: {
      "--st-bg": "20 60% 98%",
      "--st-surface": "0 0% 100%",
      "--st-border": "20 30% 90%",
      "--st-text": "340 15% 16%",
      "--st-muted": "340 8% 46%",
      "--st-accent": "340 65% 62%",
      "--st-accent-fg": "0 0% 100%",
      "--st-header": "0 0% 100%",
      "--st-header-fg": "340 15% 16%",
    },
  },
};

/** Convierte "#f59e0b" al formato "H S% L%" que usan las variables. */
export function hexToHsl(hex?: string | null): string | null {
  if (!hex) return null;
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Luminancia relativa WCAG de un color hexadecimal sRGB. */
function relativeLuminance(hex: string): number | null {
  const match = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const numeric = Number.parseInt(match[1], 16);
  const channels = [numeric >> 16, numeric >> 8, numeric]
    .map(channel => (channel & 255) / 255)
    .map(channel => (
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    ));
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

/**
 * Elige negro o blanco usando luminancia relativa WCAG, no claridad HSL.
 * HSL clasifica mal amarillos y naranjas saturados: `#f59f0a` tiene L=50%
 * pero necesita texto negro para superar 4.5:1.
 */
export function accessibleForeground(hex: string): "0 0% 0%" | "0 0% 100%" {
  const luminance = relativeLuminance(hex);
  if (luminance === null) return "0 0% 100%";
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithBlack >= contrastWithWhite ? "0 0% 0%" : "0 0% 100%";
}

export function resolveTheme(themeId?: string | null, primaryColor?: string | null): StoreTheme {
  const base = THEMES[themeId ?? "minimal"] ?? THEMES.minimal;
  const custom = hexToHsl(primaryColor);
  if (!custom) return base;
  const foreground = accessibleForeground(primaryColor!);

  // El color de marca pisa el acento; el texto encima se ajusta solo para que
  // siga siendo legible (un acento claro con texto blanco no se lee).
  return {
    ...base,
    vars: {
      ...base.vars,
      "--st-accent": custom,
      "--st-accent-fg": foreground,
      // Bold y Natural ya tienen header de color: ahí la marca pinta el cromo.
      // Luxury / Minimal / Noche conservan su header — pintar todo el topbar
      // con el acento se ve de plantilla, no de boutique (Shopify: acento ≠ chrome).
      ...(themePaintsHeader(base.id)
        ? {
            "--st-header": custom,
            "--st-header-fg": foreground,
          }
        : {}),
    },
  };
}

/** Temas cuyo header sigue al color de marca. El resto sólo pinta botones. */
export function themePaintsHeader(themeId: string): boolean {
  return themeId === "bold" || themeId === "natural";
}

export const THEME_IDS = Object.keys(THEMES);

/** Catálogo del panel: misma lista que resuelve la vitrina, sin ids sueltos. */
export const STORE_THEMES = Object.values(THEMES).map(t => ({
  id: t.id,
  label: t.label,
  hint: t.hint,
}));

/**
 * Tipografías que puede elegir el comercio.
 *
 * La `rootClass` del tema define una por defecto; esto la pisa. Son pocas y
 * curadas a propósito: un selector con 200 fuentes de Google termina en tiendas
 * ilegibles, y cada fuente es una descarga más para el comprador.
 *
 * `google` es lo que se le pide a Google Fonts; `null` significa que no hay
 * nada que descargar. Las que ya carga la app (Inter, Space Grotesk) tampoco
 * cuestan un pedido extra en el panel, pero sí en la tienda, que es una página
 * aparte — por eso también se listan con su nombre de Google.
 */
export interface StoreFont {
  id: string;
  label: string;
  /** Qué se le pide a Google Fonts, o null si es una del sistema. */
  google: string | null;
  /** El `font-family` que termina en CSS. */
  stack: string;
  /** Para que el panel muestre cómo se ve sin cargarla. */
  hint: string;
}

const FONTS: Record<string, StoreFont> = {
  sistema: {
    id: "sistema",
    label: "Del sistema",
    google: null,
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    hint: "La más rápida: no descarga nada",
  },
  inter: {
    id: "inter",
    label: "Inter",
    google: "Inter:wght@300;400;500;600;700",
    stack: '"Inter", system-ui, sans-serif',
    hint: "Neutra y muy legible en pantalla",
  },
  poppins: {
    id: "poppins",
    label: "Poppins",
    google: "Poppins:wght@300;400;500;600;700",
    stack: '"Poppins", system-ui, sans-serif',
    hint: "Redonda y amigable",
  },
  space: {
    id: "space",
    label: "Space Grotesk",
    google: "Space+Grotesk:wght@300;400;500;600;700",
    stack: '"Space Grotesk", system-ui, sans-serif',
    hint: "Técnica, con carácter",
  },
  playfair: {
    id: "playfair",
    label: "Playfair Display",
    google: "Playfair+Display:wght@400;500;600;700",
    stack: '"Playfair Display", Georgia, serif',
    hint: "Serif elegante, para moda y marcas premium",
  },
  lora: {
    id: "lora",
    label: "Lora",
    google: "Lora:wght@400;500;600;700",
    stack: '"Lora", Georgia, serif',
    hint: "Serif suave, buena para textos largos",
  },
};

export const STORE_FONTS: StoreFont[] = Object.values(FONTS);

/**
 * La tipografía elegida, o `null` si hay que usar la del tema.
 *
 * Un id desconocido —una fuente que se sacó del catálogo, o un valor viejo en
 * la base— devuelve `null` en vez de romper: la tienda se ve con la del tema.
 */
export function resolveFont(fontId?: string | null): StoreFont | null {
  if (!fontId) return null;
  return FONTS[fontId] ?? null;
}

/** La URL de Google Fonts para una fuente, o null si no hay que cargar nada. */
export function googleFontHref(font: StoreFont | null): string | null {
  if (!font?.google) return null;
  return `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
}
