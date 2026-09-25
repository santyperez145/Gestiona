/**
 * StoreThemeStudio — creador de temas visual profesional (paridad
 * Tiendanube/Shopify Theme Studio).
 *
 * No toca el panel de publicación (StoreThemePublishingPanel sigue siendo la
 * autoridad de versiones): este studio edita el borrador con vista previa en
 * vivo que replica la home de la tienda con las MISMAS variables CSS que ve el
 * comprador. El color primario pisa el acento vía resolveTheme, así que la
 * paleta granular se traduce en sugerencias de primario coherentes.
 */
import { useMemo } from "react";
import { Palette, Eye, Check } from "lucide-react";
import { STORE_THEMES, STORE_FONTS, resolveTheme } from "@/storefront/theme";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface StoreThemeStudioProps {
  selectedTheme: string;
  primaryColor: string;
  fontId: string;
  storeName: string;
  productCount: number;
  onSelectTheme: (themeId: string) => void;
  onSelectFont: (fontId: string) => void;
  onPrimaryColor: (hex: string) => void;
}

const PRIMARY_PRESETS = [
  { hex: "#111111", nombre: "Negro clásico" },
  { hex: "#173aef", nombre: "Cobalto Nerqia" },
  { hex: "#0d9488", nombre: "Verde teal" },
  { hex: "#9333ea", nombre: "Violeta" },
  { hex: "#e11d48", nombre: "Rosa fuerte" },
  { hex: "#ea580c", nombre: "Naranja" },
  { hex: "#ca8a04", nombre: "Dorado" },
  { hex: "#0284c7", nombre: "Celeste" },
];

export default function StoreThemeStudio({
  selectedTheme,
  primaryColor,
  fontId,
  storeName,
  productCount,
  onSelectTheme,
  onSelectFont,
  onPrimaryColor,
}: StoreThemeStudioProps) {
  // La vista previa usa EXACTAMENTE el mismo resolver que la vitrina: lo que
  // ves acá es lo que compra el cliente, no una imitación en Tailwind.
  const preview = resolveTheme(selectedTheme, primaryColor);
  const v = preview.vars;

  const hslOf = (key: string) => `hsl(${v[key] ?? "0 0% 50%"})`;

  const font = STORE_FONTS.find(f => f.id === fontId) ?? STORE_FONTS[0];

  const resumenAccesibilidad = useMemo(() => {
    // Contraste aproximado del acento con su texto: aviso honesto, no WCAG completo.
    const hex = primaryColor.trim();
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!match) return null;
    const int = Number.parseInt(match[1], 16);
    const r = (int >> 16) & 255, g = (int >> 8) & 0xff, b = int & 0xff;
    const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminancia > 0.65 ? "texto oscuro" : "texto blanco";
  }, [primaryColor]);

  return (
    <div className="bg-card border border-border/40 rounded-xl p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2 mb-1">
            <Palette className="w-4 h-4 text-primary" /> Theme Studio
          </h3>
          <p className="text-xs text-muted-foreground">
            Editá colores, tipografía y plantilla con vista previa real de tu tienda.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-1">
          <Eye className="w-3 h-3" /> Vista previa en vivo
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── Vista previa de la home ─────────────────────────────── */}
        <div
          className="rounded-lg border overflow-hidden"
          style={{
            background: hslOf("--st-bg"),
            borderColor: hslOf("--st-border"),
            fontFamily: font.stack,
          }}
          aria-label="Vista previa del diseño de la tienda"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ background: hslOf("--st-header"), color: hslOf("--st-header-fg") }}>
            <span className="font-bold text-sm truncate">{storeName || "Tu tienda"}</span>
            <div className="flex gap-3 text-[10px] opacity-80">
              <span>Inicio</span><span>Productos</span><span>Contacto</span>
            </div>
          </div>

          {/* Hero */}
          <div className="px-4 py-6 space-y-2" style={{ background: hslOf("--st-surface") }}>
            <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: hslOf("--st-muted") }}>Nueva colección</p>
            <p className="text-lg font-bold leading-tight" style={{ color: hslOf("--st-text") }}>
              {storeName || "Tu tienda"}
            </p>
            <div className="inline-flex px-3 py-1.5 text-[11px] font-semibold rounded" style={{ background: hslOf("--st-accent"), color: hslOf("--st-accent-fg") }}>
              Explorar catálogo
            </div>
          </div>

          {/* Grilla de productos */}
          <div className="grid grid-cols-3 gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded border overflow-hidden" style={{ borderColor: hslOf("--st-border"), background: hslOf("--st-bg") }}>
                <div className="h-12" style={{ background: `hsl(${v["--st-muted"]} / 0.12)` }} />
                <div className="p-1.5 space-y-1">
                  <div className="h-1.5 w-3/4 rounded" style={{ background: `hsl(${v["--st-text"]} / 0.55)` }} />
                  <div className="h-1.5 w-1/2 rounded" style={{ background: hslOf("--st-accent") }} />
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 text-[9px]" style={{ background: hslOf("--st-header"), color: hslOf("--st-header-fg"), opacity: 0.85 }}>
            {productCount} productos publicados · Compra protegida
          </div>
        </div>

        {/* ── Controles ───────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Color de marca (acento global)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor || "#173aef"}
                onChange={e => onPrimaryColor(e.target.value)}
                aria-label="Elegir color de marca"
                className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
              />
              <Input
                value={primaryColor}
                onChange={e => onPrimaryColor(e.target.value)}
                placeholder="#173aef"
                className="h-9 font-mono text-xs"
                maxLength={7}
              />
            </div>
            {resumenAccesibilidad && (
              <p className="text-[10px] text-muted-foreground">
                Con este color, los botones usan {resumenAccesibilidad} automáticamente para mantener legibilidad.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRIMARY_PRESETS.map(p => (
                <button
                  key={p.hex}
                  type="button"
                  title={p.nombre}
                  aria-label={`Usar ${p.nombre}`}
                  onClick={() => onPrimaryColor(p.hex)}
                  className={`h-7 w-7 rounded-full border-2 grid place-items-center transition-transform hover:scale-110 ${primaryColor.toUpperCase() === p.hex ? "border-foreground" : "border-transparent"}`}
                  style={{ background: p.hex }}
                >
                  {primaryColor.toUpperCase() === p.hex && <Check className="w-3 h-3 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Tipografía</Label>
            <Select value={fontId} onValueChange={onSelectFont}>
              <SelectTrigger className="h-9 text-sm" aria-label="Tipografía de la tienda">
                <SelectValue placeholder="Elegí la tipografía" />
              </SelectTrigger>
              <SelectContent>
                {STORE_FONTS.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.label} — {f.hint}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Plantilla visual</Label>
            <div className="grid grid-cols-2 gap-2">
              {STORE_THEMES.map(t => {
                const mini = resolveTheme(t.id, primaryColor);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelectTheme(t.id)}
                    className={`p-2 border rounded text-left transition-colors ${selectedTheme === t.id ? "border-primary ring-1 ring-primary/30" : "border-border hover:border-primary/40"}`}
                  >
                    <div className="h-8 rounded-sm overflow-hidden border mb-1.5" style={{ borderColor: `hsl(${mini.vars["--st-border"]})`, background: `hsl(${mini.vars["--st-bg"]})` }}>
                      <div className="h-2.5" style={{ background: `hsl(${mini.vars["--st-header"]})` }} />
                      <div className="mx-1.5 mt-1 h-1.5 w-6" style={{ background: `hsl(${mini.vars["--st-accent"]})` }} />
                    </div>
                    <p className="text-[11px] font-semibold flex items-center gap-1">
                      {t.label}
                      {selectedTheme === t.id && <Check className="w-3 h-3 text-primary" />}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}