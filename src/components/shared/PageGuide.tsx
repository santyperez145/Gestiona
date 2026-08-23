import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { HelpCircle, ChevronRight, Sparkles, Lightbulb } from "lucide-react";
import { PAGE_GUIDES } from "@/data/pageGuides";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

// ── Tag badge styles ──────────────────────────────────────────────────────────
const TAG_STYLES: Record<string, string> = {
  Nuevo:  "bg-primary/15 text-primary border-primary/30",
  Pro:    "bg-purple-500/15 text-purple-400 border-purple-500/30",
  IA:     "bg-violet-500/15 text-violet-400 border-violet-500/30",
  Tip:    "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

// ── Storage helpers ───────────────────────────────────────────────────────────
const SEEN_KEY = "gestiona.guide.seen";

function getSeenPages(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markPageSeen(path: string) {
  try {
    const seen = getSeenPages();
    seen.add(path);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch { /* noop */ }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PageGuide() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);

  // Find guide for current page (exact match, then prefix match)
  const guide =
    PAGE_GUIDES[pathname] ??
    PAGE_GUIDES[Object.keys(PAGE_GUIDES).find((k) => k !== "/" && pathname.startsWith(k)) ?? ""] ??
    null;

  // When route changes, check if this guide is unseen
  useEffect(() => {
    if (!guide) { setIsNew(false); return; }
    const seen = getSeenPages();
    setIsNew(!seen.has(pathname));
    setOpen(false); // close when navigating
  }, [pathname, guide]);

  // Mark seen when opened
  const handleOpen = () => {
    setOpen(true);
    setIsNew(false);
    markPageSeen(pathname);
  };

  // `?` key opens/closes guide (skip if focus is in an input/textarea)
  useEffect(() => {
    if (!guide) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((o) => {
          if (!o) { setIsNew(false); markPageSeen(pathname); }
          return !o;
        });
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [guide, open, pathname]);

  if (!guide) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* ── Floating trigger button ─────────────────────────────────────── */}
      <button
        onClick={handleOpen}
        title="Guía de esta pantalla"
        className={cn(
          "fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-all duration-200",
          "bg-card border border-border/60 hover:border-primary/50 hover:shadow-xl hover:scale-105",
          open && "opacity-0 pointer-events-none",
        )}
        aria-label="Abrir guía"
      >
        <HelpCircle className="w-5 h-5 text-muted-foreground" />
        {/* "Nuevo" pulse dot */}
        {isNew && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary shadow-[0_0_0_2px_hsl(var(--background))]">
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
          </span>
        )}
      </button>

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
                <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                  Atajo de teclado:{" "}
                  <kbd className="px-1 py-0.5 rounded border border-border text-[9px] font-mono">?</kbd>
                  {" "}para abrir esta guía
                </p>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
            </div>
          </SheetContent>
    </Sheet>
  );
}
