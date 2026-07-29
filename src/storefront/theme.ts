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
    },
  },
  bold: {
    id: "bold",
    label: "Bold",
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
    },
  },
  luxury: {
    id: "luxury",
    label: "Luxury",
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
    },
  },
  sport: {
    id: "sport",
    label: "Sport",
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
    },
  },
  natural: {
    id: "natural",
    label: "Natural",
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

/**
 * Devuelve la luminancia relativa aproximada de un color HSL "H S% L%",
 * para decidir si el texto encima va claro u oscuro.
 */
function lightnessOf(hsl: string): number {
  const m = /(\d+)%\s*$/.exec(hsl);
  return m ? Number(m[1]) : 50;
}

export function resolveTheme(themeId?: string | null, primaryColor?: string | null): StoreTheme {
  const base = THEMES[themeId ?? "minimal"] ?? THEMES.minimal;
  const custom = hexToHsl(primaryColor);
  if (!custom) return base;

  // El color de marca pisa el acento; el texto encima se ajusta solo para que
  // siga siendo legible (un acento claro con texto blanco no se lee).
  return {
    ...base,
    vars: {
      ...base.vars,
      "--st-accent": custom,
      "--st-accent-fg": lightnessOf(custom) > 62 ? "0 0% 10%" : "0 0% 100%",
      // En los temas con header de color, el header sigue al acento.
      ...(base.id === "bold" || base.id === "natural" ? { "--st-header": custom } : {}),
    },
  };
}

export const THEME_IDS = Object.keys(THEMES);
