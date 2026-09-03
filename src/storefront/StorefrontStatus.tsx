/**
 * Estados de la vitrina que no son el catálogo: 404 real vs red caída.
 *
 * Confundirlos era el bug: un `Failed to fetch` se pintaba como
 * «Tienda no encontrada». El comprador se iba. Tokens `--st-*`, no el
 * violeta del panel. Reintentar no borra el carrito: vive en localStorage.
 */
const TOKENS = {
  background: "hsl(var(--st-bg, 0 0% 100%))",
  text: "hsl(var(--st-text, 0 0% 9%))",
  muted: "hsl(var(--st-muted, 0 0% 45%))",
  border: "hsl(var(--st-border, 0 0% 90%))",
  accent: "hsl(var(--st-accent, 252 83% 62%))",
  accentFg: "hsl(var(--st-accent-fg, 0 0% 100%))",
  radius: "var(--st-radius, 0.5rem)",
} as const;

export default function StorefrontStatus({
  kind,
  storeName,
  title,
  detail,
  onRetry,
}: {
  kind: "not-found" | "error";
  slug?: string;
  storeName?: string | null;
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  const error = kind === "error";
  const titulo = title ?? (error
    ? (storeName ? `No pudimos cargar ${storeName}` : "No pudimos cargar la tienda")
    : "Tienda no encontrada");
  const detalle = detail ?? (error
    ? "La red falló o el catálogo no respondió. Tu carrito sigue guardado; reintentá."
    : "No hay ninguna tienda activa en esta dirección. Puede que haya cambiado o que esté desactivada.");

  return (
    <div
      className="min-h-screen grid place-items-center p-4"
      data-storefront-state={error ? "error" : "not-found"}
      role="alert"
      style={{ background: TOKENS.background, color: TOKENS.text }}
    >
      <div className="text-center max-w-sm">
        <h1 className="text-base font-semibold mb-1">{titulo}</h1>
        <p className="text-sm mb-4" style={{ color: TOKENS.muted }}>{detalle}</p>
        {error && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center min-h-11 px-5 text-sm font-medium"
            style={{
              background: TOKENS.accent,
              color: TOKENS.accentFg,
              borderRadius: TOKENS.radius,
            }}
          >
            Reintentar
          </button>
        ) : (
          <a href="/" className="text-sm hover:underline" style={{ color: TOKENS.muted }}>
            Ir al inicio
          </a>
        )}
      </div>
    </div>
  );
}
