import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType, type NavigationType } from "react-router-dom";

const MAX_POSITIONS = 40;
const storageKey = (slug: string) => `nerqia:storefront-scroll:${slug}`;

type StoredPositions = Record<string, number>;

function readPositions(slug: string): StoredPositions {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(slug)) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as StoredPositions
      : {};
  } catch {
    return {};
  }
}

function savePosition(slug: string, locationKey: string, position: number) {
  try {
    const positions = readPositions(slug);
    delete positions[locationKey];
    positions[locationKey] = Math.max(0, Math.round(position));
    const recent = Object.entries(positions).slice(-MAX_POSITIONS);
    sessionStorage.setItem(storageKey(slug), JSON.stringify(Object.fromEntries(recent)));
  } catch {
    // La navegación no puede depender de que sessionStorage esté disponible.
  }
}

export function storefrontScrollTarget(
  navigationType: NavigationType,
  savedPosition?: number,
): number {
  // Solo restaurar scroll en POP (atrás/adelante del navegador)
  // PUSH/PUSH navigation (clic en links) siempre va al top
  if (navigationType === "POP" && Number.isFinite(savedPosition)) {
    return Math.max(0, Number(savedPosition));
  }
  return 0;
}

/**
 * Hace que la SPA se comporte como una tienda multipágina:
 * - un link nuevo abre arriba y mueve el foco al contenido;
 * - Atrás/Adelante vuelve al lugar del catálogo donde estaba el comprador;
 * - cambiar filtros en la misma URL base no provoca saltos.
 */
export default function StorefrontNavigation({ slug }: { slug: string }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previous = useRef<{ key: string; pathname: string } | null>(null);

  useLayoutEffect(() => {
    const before = previous.current;
    if (before && before.key !== location.key) {
      savePosition(slug, before.key, window.scrollY);
    }

    const changedPage = !before || before.pathname !== location.pathname;
    previous.current = { key: location.key, pathname: location.pathname };
    if (!changedPage) return;

    const saved = readPositions(slug)[location.key];
    const target = storefrontScrollTarget(navigationType, saved);
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: target, left: 0, behavior: "auto" });
      if (before && navigationType !== "POP") {
        document.getElementById("contenido-principal")?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.key, location.pathname, navigationType, slug]);

  useEffect(() => {
    const previousMode = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const rememberCurrent = () => {
      if (previous.current) savePosition(slug, previous.current.key, window.scrollY);
    };
    window.addEventListener("pagehide", rememberCurrent);
    return () => {
      rememberCurrent();
      window.removeEventListener("pagehide", rememberCurrent);
      window.history.scrollRestoration = previousMode;
    };
  }, [slug]);

  return null;
}
