import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight, Sparkles, Lightbulb } from "lucide-react";
import { PAGE_GUIDES, type GuideConfig } from "@/data/pageGuides";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

// ── Tag badge styles ──────────────────────────────────────────────────────────
const TAG_STYLES: Record<string, string> = {
  Nuevo:  "bg-primary/15 text-primary border-primary/30",
  Pro:    "bg-primary/15 text-primary border-primary/30",
  IA:     "bg-primary/15 text-primary border-primary/30",
  Tip:    "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

/** Consejos de la pantalla actual (exacta o por prefijo), o null. */
export function guiaDeRuta(pathname: string): GuideConfig | null {
  return PAGE_GUIDES[pathname]
    ?? PAGE_GUIDES[Object.keys(PAGE_GUIDES).find((k) => k !== "/" && pathname.startsWith(k)) ?? ""]
    ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Panel de consejos de la pantalla. Lo abre el botón de ayuda unificado
 * (TutorialHelp), junto al recorrido guiado y la Academia; ya no tiene botón
 * propio para no apilar dos «?» en la misma esquina.
 */
export default function PageGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pathname } = useLocation();
  const guide = guiaDeRuta(pathname);

  // Al navegar se cierra.
  useEffect(() => { onOpenChange(false); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!guide) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* ── Sheet panel ─────────────────────────────────────────────────── */}
          <SheetContent side="right" className="w-full sm:max-w-[360px] p-0 flex flex-col">

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 pr-12 border-b border-border bg-muted/30">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Lightbulb className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-sm truncate">{guide.title}</SheetTitle>
                {guide.subtitle && (
                  <SheetDescription className="text-[11px] truncate">{guide.subtitle}</SheetDescription>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold mb-3 px-0.5">
                Guía rápida · {guide.tips.length} consejos
              </p>

              {guide.tips.map((tip, i) => {
                const Icon = tip.icon;
                return (
                  <div
                    key={i}
                    className="group flex gap-3 p-3 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-primary/20 transition-all cursor-default"
                  >
                    {/* Icon */}
                    <div className="w-8 h-8 rounded-lg bg-background border border-border flex items-center justify-center shrink-0 mt-0.5 group-hover:border-primary/30 transition-colors">
                      <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className="text-[13px] font-semibold text-foreground leading-tight">{tip.title}</span>
                        {tip.tag && (
                          <span className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide",
                            TAG_STYLES[tip.tag] ?? TAG_STYLES.Tip,
                          )}>
                            {tip.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-muted-foreground leading-relaxed">{tip.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-primary/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground/70">
                  ¿Más dudas? Usá el <span className="text-primary font-medium">Chat IA</span>.
                </p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
            </div>
          </SheetContent>
    </Sheet>
  );
}
