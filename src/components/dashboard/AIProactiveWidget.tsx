import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Brain, RefreshCw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  orgId: string;
  stats: {
    products: any[];
    rawSales: any[];
    rawExpenses: any[];
    totalSalesARS: number;
    grossProfitARS: number;
    pendingDebts: number;
    totalDebtsARS: number;
  };
}

function parseBullets(text: string): string[] {
  return text
    .split("\n")
    .map(l => l.replace(/^[-*•]\s*/, "").replace(/^\*\*(.+?)\*\*/, "$1").trim())
    .filter(l => l.length > 10 && !l.startsWith("#"))
    .slice(0, 5);
}

const CACHE_KEY = (orgId: string) => `gestiona.ai.pulse.${orgId}`;
const CACHE_TTL_MS = 1000 * 60 * 60 * 8; // 8 horas

export default function AIProactiveWidget({ orgId, stats }: Props) {
  const [bullets, setBullets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
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
    try {
      const simProducts = stats.products.slice(0, 20).map((p: any) => ({
        name: p.name, stock: p.stock,
        margin_pct: Number(p.sale_price_ars) > 0
          ? Math.round((Number(p.profit_per_unit_ars) / Number(p.sale_price_ars)) * 100)
          : 0,
      }));

      const simSales = stats.rawSales.slice(0, 30).map((s: any) => ({
        product: s.product_name, total_ars: s.total_ars, profit_ars: s.profit_ars,
        date: s.date, customer: s.customer_name,
      }));

      const simExpenses = stats.rawExpenses.slice(0, 10).map((e: any) => ({
        category: e.category, amount_ars: e.amount_ars, date: e.date,
      }));

      const { data, error } = await supabase.functions.invoke("ai-analysis", {
        body: {
          type: "predict_sales",
          data: {
            products: simProducts,
            sales: simSales,
            expenses: simExpenses,
            kpis: {
              totalSalesARS: stats.totalSalesARS,
              grossProfitARS: stats.grossProfitARS,
              pendingDebts: stats.pendingDebts,
              totalDebtsARS: stats.totalDebtsARS,
            },
          },
          instructions: "Dame 4 sugerencias concretas y breves (1 línea cada una) para mejorar el negocio HOY basándote en estos datos. Formato: lista con guiones. Sin introducción.",
        },
      });

      if (error) throw error;
      const content: string = data?.content || "";
      const parsed = parseBullets(content);
      if (parsed.length) {
        setBullets(parsed);
        setLastRun(new Date());
        localStorage.setItem(CACHE_KEY(orgId), JSON.stringify({ bullets: parsed, ts: Date.now() }));
      }
    } catch {
      // Silently fail — widget is non-critical
    } finally {
      setLoading(false);
    }
  }, [orgId, stats, loading]);

  useEffect(() => {
    if (orgId && stats.products.length > 0) run();
  }, [orgId]);

  if (!bullets.length && !loading) return null;

  return (
    <div className="mb-5 bg-card border border-primary/20 rounded-xl shadow-card overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(e => !e)}
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
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); run(true); }}
            className="p-1 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
            title="Regenerar sugerencias"
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {loading && !bullets.length ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Sparkles className="w-3.5 h-3.5 animate-pulse text-primary" />
              <span>Analizando tu negocio…</span>
            </div>
          ) : (
            <ul className="space-y-2">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
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
