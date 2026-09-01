/**
 * Reserva la geometría de la vitrina mientras llega el catálogo.
 *
 * El spinner centrado con `bg-background` era chrome del SaaS: violeta en
 * claro, y cuando la tienda aparecía el comprador veía saltar header, banner
 * y grilla de una sola vez. Este esqueleto usa tokens `--st-*` del tema
 * minimal —blanco, no el primary del panel— y deja huecos con la misma
 * proporción que banners (`16/7`) y tarjetas (`1/1`).
 */
const TARJETAS = 8;

function Hueso({ className }: { className: string }) {
  return <span aria-hidden="true" className={`storefront-skeleton-bone ${className}`} />;
}

export default function StorefrontSkeleton() {
  return (
    <div
      className="storefront-skeleton min-h-screen"
      data-storefront-state="loading"
      aria-busy="true"
      style={{
        background: "hsl(var(--st-bg, 0 0% 100%))",
        color: "hsl(var(--st-text, 0 0% 9%))",
        ["--st-bg" as string]: "0 0% 100%",
        ["--st-surface" as string]: "0 0% 98%",
        ["--st-border" as string]: "0 0% 90%",
        ["--st-text" as string]: "0 0% 9%",
        ["--st-muted" as string]: "0 0% 45%",
        ["--st-header" as string]: "0 0% 100%",
        ["--st-radius" as string]: "0.5rem",
      }}
    >
      <p className="sr-only" role="status">Cargando la tienda</p>

      <div
        className="border-b"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))" }}
      >
        <div className="max-w-6xl mx-auto px-4 py-1 flex justify-end">
          <Hueso className="h-3 w-36" />
        </div>
      </div>

      <header
        className="sticky top-0 z-40 border-b"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-header))" }}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          <Hueso className="h-8 w-8 rounded" />
          <Hueso className="h-4 w-28 sm:w-40" />
          <Hueso className="ml-auto h-9 w-9 rounded" />
          <Hueso className="h-9 w-9 rounded" />
        </div>
      </header>

      <div
        className="relative aspect-[16/7] sm:aspect-[21/7] border-b"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))" }}
      >
        <Hueso className="absolute inset-0 rounded-none" />
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Hueso className="h-10 w-full" />
        <Hueso className="hidden sm:block h-10 w-full" />
        <Hueso className="hidden sm:block h-10 w-full" />
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        <Hueso className="mb-4 h-5 w-32" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: TARJETAS }, (_, i) => (
            <article key={i} className="overflow-hidden border" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>
              <div className="relative aspect-square" style={{ background: "hsl(var(--st-surface))" }}>
                <Hueso className="absolute inset-0 rounded-none" />
              </div>
              <div className="p-3 space-y-2">
                <Hueso className="h-3 w-16" />
                <Hueso className="h-4 w-full" />
                <Hueso className="h-5 w-20" />
                <Hueso className="mt-3 h-11 w-full" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
