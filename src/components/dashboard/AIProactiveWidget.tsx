import { useState, useEffect, useCallback } from "react";
import { llamarIA } from "@/lib/ia";
import { Brain, RefreshCw, Sparkles, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

interface Props {
  orgId: string;
  hasBusinessData: boolean;
}

function parseBullets(text: string): string[] {
  return text
    .split("\n")
    // El prompt de `daily_pulse` pide guiones y sin numerar, pero un modelo
    // numera igual de vez en cuando y el widget ya pone su propio número: sin
    // sacar el prefijo se lee «1 · 1. Reponer…».
    .map(l => l.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s+/, "").replace(/^\*\*(.+?)\*\*/, "$1").trim())
    .filter(l => l.length > 10 && !l.startsWith("#"))
    .slice(0, 5);
}

const CACHE_KEY = (orgId: string) => `gestiona.ai.pulse.v2.${orgId}`;
const CACHE_TTL_MS = 1000 * 60 * 60 * 8; // 8 horas

export default function AIProactiveWidget({ orgId, hasBusinessData }: Props) {
  const [bullets, setBullets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const run = useCallback(async (force = false) => {
    if (loading) return;

    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY(orgId)) || "null");
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
          setBullets(cached.bullets);
          setLastRun(new Date(cached.ts));
          return;
        }
      } catch { /* ignore */ }
    }

    setLoading(true);
    setError(null);
    try {
      // El navegador manda intención + tenant. Precios, márgenes, ventas,
      // gastos y deudas los vuelve a leer la función bajo RLS: no viajan desde
      // el estado de React ni se pueden reemplazar en DevTools.
      const data = await llamarIA("ai-analysis", {
        body: {
          type: "daily_pulse",
          orgId,
        },
      });
      const content: string = data?.content || "";
      const parsed = parseBullets(content);
      if (parsed.length) {
        setBullets(parsed);
        setLastRun(new Date());
        localStorage.setItem(CACHE_KEY(orgId), JSON.stringify({ bullets: parsed, ts: Date.now() }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos generar las prioridades del día.");
    } finally {
      setLoading(false);
    }
  }, [orgId, loading]);

  useEffect(() => {
    if (orgId && hasBusinessData) run();
  }, [orgId, hasBusinessData]);

  if (!hasBusinessData) return null;

  return (
    <div className="mb-5 bg-card border border-primary/20 rounded-xl shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-primary/15 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
            Sugerencias IA
          </span>
          {lastRun && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              · actualizado {lastRun.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        </button>
        <div className="ml-2 flex items-center gap-2">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); run(true); }}
            className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Regenerar sugerencias"
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4">
          {error && bullets.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5">
              <p className="flex min-w-0 items-start gap-2 text-xs text-foreground/80">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span>No pudimos actualizar: {error}</span>
              </p>
              <button type="button" onClick={() => run(true)} className="text-xs font-medium text-primary hover:underline">
                Reintentar
              </button>
            </div>
          )}
          {loading && !bullets.length ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Sparkles className="w-3.5 h-3.5 animate-pulse text-primary" />
              <span>Analizando tu negocio…</span>
            </div>
          ) : error && !bullets.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <p className="flex min-w-0 items-start gap-2 text-xs text-foreground/80">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <span>{error}</span>
              </p>
              <button type="button" onClick={() => run(true)} className="text-xs font-medium text-primary hover:underline">
                Reintentar
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 w-5 h-5 rounded-[4px] bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-foreground/85 leading-snug">{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
