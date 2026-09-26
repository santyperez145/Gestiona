import { useStore } from "./storeContext";
import type { StorefrontLayout } from "@/lib/storeHomeLayout";

export default function CodigoPersonalizado({ layout }: { layout: StorefrontLayout }) {
  const seccion = layout.sections.find((s) => s.id === "codigo");
  if (!seccion || !seccion.enabled) return null;
  return (
    <section
      className="storefront-codigo relative overflow-hidden py-12"
      style={{ borderBottom: "1px solid hsl(var(--st-border))" }}
    >
      <div className="max-w-3xl mx-auto px-4">
        <h2 className="font-semibold mb-6 text-center">Código personalizado</h2>
        <p className="text-sm text-center mb-8" style={{ color: "hsl(var(--st-muted))" }}>
          Agrega HTML, CSS o JavaScript personalizado. Los scripts peligrosos son eliminados automáticamente.
        </p>
        <div className="rounded-lg p-6 mb-8" style={{ border: "1px solid hsl(var(--st-border))", background: "hsl(var(--st-surface))" }}>
          <pre className="text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto" style={{ color: "hsl(var(--st-muted))" }}>
            {/* Bloque de código personalizado (patrón Tiendanube Ipanema) */}
            {/* Aquí iría el contenido HTML/CSS/JS guardado en el layout */}
          </pre>
        </div>
      </div>
    </section>
  );
}
