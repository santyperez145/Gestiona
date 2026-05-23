import { useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import {
  getProductsDB, getSalesDB, getExpensesDB, getPurchasesDB,
} from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Brain, TrendingUp, Package, Megaphone, Users, DollarSign,
  Tag, Loader2, ChevronDown, ChevronUp, Clock, Sparkles, RefreshCw,
} from "lucide-react";

type AnalysisType =
  | "predict_sales"
  | "restock_analysis"
  | "marketing_copy"
  | "customer_analysis"
  | "cashflow_advice"
  | "pricing_strategy"
  | "tax_afip"
  | "bundle_strategy";

interface HistoryEntry {
  id: string;
  type: AnalysisType;
  content: string;
  timestamp: Date;
}

const ANALYSIS_CONFIG: Record<
  AnalysisType,
  { label: string; desc: string; icon: typeof Brain; color: string; badge: string }
> = {
  predict_sales: {
    label: "Predicción de Ventas",
    desc: "Qué productos se venderán más, tendencias y estrellas del catálogo",
    icon: TrendingUp,
    color: "text-green-400",
    badge: "bg-green-500/15 text-green-400 border-green-500/20",
  },
  restock_analysis: {
    label: "Plan de Restock",
    desc: "Qué reponer urgente, inversión en USD y qué liquidar",
    icon: Package,
    color: "text-yellow-400",
    badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  },
  marketing_copy: {
    label: "Copy de Marketing",
    desc: "Captions, hashtags y estrategia para Instagram",
    icon: Megaphone,
    color: "text-pink-400",
    badge: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  },
  customer_analysis: {
    label: "Análisis de Clientes",
    desc: "Clientes VIP, dormidos, ticket promedio y estrategia de fidelización",
    icon: Users,
    color: "text-blue-400",
    badge: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  },
  cashflow_advice: {
    label: "Asesoría Financiera",
    desc: "Flujo de caja, meses críticos y liquidez para próximo restock",
    icon: DollarSign,
    color: "text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  },
  pricing_strategy: {
    label: "Estrategia de Precios",
    desc: "Márgenes, precios fuera de mercado y oportunidades de bundles",
    icon: Tag,
    color: "text-purple-400",
    badge: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  },
  tax_afip: {
    label: "Impuestos AFIP",
    desc: "Estimación de categoría Monotributo, IVA e Ingresos Brutos según facturación del período",
    icon: DollarSign,
    color: "text-red-400",
    badge: "bg-red-500/15 text-red-400 border-red-500/20",
  },
  bundle_strategy: {
    label: "Bundles & Combos",
    desc: "Productos que se compran juntos, oportunidades de combos y estrategias de upselling",
    icon: Users,
    color: "text-cyan-400",
    badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  },
};

function parseMarkdownSections(text: string): { title: string; body: string }[] {
  const lines = text.split("\n");
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;

  for (const line of lines) {
    // eslint-disable-next-line no-misleading-character-class
    const heading = line.match(/^([1-9]\d*\.\s+[🎯📈📦💰📊🚨📋❌💵📝#️⃣📱💡⏰👑😴🔄🛒📬💲🏷️⚠️📉🏦].+)/u);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].trim(), body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    } else if (line.trim()) {
      if (!sections.length) sections.push({ title: "", body: line });
      else sections[sections.length - 1].body += "\n" + line;
    }
  }
  if (current) sections.push(current);
  return sections.filter((s) => s.title || s.body.trim());
}

function ResultCard({ content, type }: { content: string; type: AnalysisType }) {
  const cfg = ANALYSIS_CONFIG[type];
  const Icon = cfg.icon;
  const sections = parseMarkdownSections(content);

  if (!sections.length || (sections.length === 1 && !sections[0].title)) {
    return (
      <div className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed p-5">
        {content}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {sections.map((s, i) => (
        <div key={i} className="p-5">
          {s.title && (
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${cfg.color} shrink-0`} />
              <h4 className="font-semibold text-sm">{s.title}</h4>
            </div>
          )}
          <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed pl-6">
            {s.body.trim()}
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryItem({ entry, onExpand }: { entry: HistoryEntry; onExpand: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = ANALYSIS_CONFIG[entry.type];
  const Icon = cfg.icon;

  return (
    <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-card border border-border shrink-0`}>
          <Icon className={`w-4 h-4 ${cfg.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{cfg.label}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Clock className="w-3 h-3" />
            {entry.timestamp.toLocaleString("es-AR")}
          </p>
        </div>
        <Badge className={`text-[10px] border shrink-0 ${cfg.badge}`}>{cfg.label}</Badge>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <div className="border-t border-border">
          <ResultCard content={entry.content} type={entry.type} />
        </div>
      )}
    </div>
  );
}

export default function AIInsightsPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [loadingType, setLoadingType] = useState<AnalysisType | null>(null);
  const [activeResult, setActiveResult] = useState<{ type: AnalysisType; content: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const runAnalysis = useCallback(async (type: AnalysisType) => {
    if (!user) return;
    setLoadingType(type);
    setActiveResult(null);
    try {
      const [products, sales, expenses, purchases] = await Promise.all([
        getProductsDB(user.id),
        getSalesDB(user.id),
        getExpensesDB(user.id),
        getPurchasesDB(user.id),
      ]);

      const simProducts = products.slice(0, 30).map((p: any) => ({
        name: p.name, brand: p.brand, category: p.category,
        cost_usd: p.cost_usd, sale_price_ars: p.sale_price_ars,
        margin_ars: p.profit_per_unit_ars, stock: p.stock,
      }));

      const simSales = sales.slice(0, 30).map((s: any) => ({
        product: s.product_name, qty: s.quantity,
        total_ars: s.total_ars, profit_ars: s.profit_ars,
        date: s.date, customer: s.customer_name,
      }));

      const simExpenses = expenses.slice(0, 20).map((e: any) => ({
        category: e.category, amount_ars: e.amount_ars, date: e.date, note: e.note,
      }));

      const simPurchases = purchases.slice(0, 10).map((p: any) => ({
        product: p.product_name, qty: p.quantity, cost_usd: p.unit_cost_usd, date: p.date,
      }));

      const customerMap: Record<string, { name: string; total_ars: number; purchases: number; last_date: string }> = {};
      for (const s of simSales) {
        if (!s.customer) continue;
        if (!customerMap[s.customer]) customerMap[s.customer] = { name: s.customer, total_ars: 0, purchases: 0, last_date: s.date };
        customerMap[s.customer].total_ars += s.total_ars || 0;
        customerMap[s.customer].purchases += 1;
        if (s.date > customerMap[s.customer].last_date) customerMap[s.customer].last_date = s.date;
      }
      const customers = Object.values(customerMap).sort((a, b) => b.total_ars - a.total_ars).slice(0, 30);

      const { data, error } = await supabase.functions.invoke("ai-analysis", {
        body: {
          type,
          data: { products: simProducts, sales: simSales, expenses: simExpenses, purchases: simPurchases, customers },
        },
      });

      if (error) throw error;
      const content = data?.content || "Sin resultado";

      setActiveResult({ type, content });
      setHistory((prev) => [
        { id: Date.now().toString(), type, content, timestamp: new Date() },
        ...prev.slice(0, 9),
      ]);
    } catch (err: any) {
      toast.error(err.message || "Error al analizar");
    } finally {
      setLoadingType(null);
    }
  }, [user]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">IA Insights</h1>
            <p className="text-sm text-muted-foreground">Inteligencia artificial para tu negocio — powered by Claude</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
          <Sparkles className="w-3 h-3 text-primary" />
          <span className="text-xs font-medium text-primary">Claude Haiku</span>
        </div>
      </div>

      {/* Analysis grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(Object.entries(ANALYSIS_CONFIG) as [AnalysisType, typeof ANALYSIS_CONFIG[AnalysisType]][]).map(([type, cfg]) => {
          const Icon = cfg.icon;
          const isLoading = loadingType === type;
          const isActive = activeResult?.type === type;

          return (
            <button
              key={type}
              onClick={() => runAnalysis(type)}
              disabled={!!loadingType}
              className={`bg-[hsl(228_24%_7%)] border rounded-[10px] p-5 text-left transition-all hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed ${
                isActive ? "border-primary/50 ring-1 ring-primary/30 shadow-md" : "border-border hover:border-primary/30"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-card border border-border`}>
                  {isLoading
                    ? <Loader2 className={`w-4 h-4 animate-spin ${cfg.color}`} />
                    : <Icon className={`w-4 h-4 ${cfg.color}`} />
                  }
                </div>
                {isActive && !isLoading && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cfg.badge}`}>Activo</span>
                )}
              </div>
              <h3 className="font-semibold text-sm mb-1">{cfg.label}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{cfg.desc}</p>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-primary">
                {isLoading ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Analizando...</>
                ) : (
                  <><RefreshCw className="w-3 h-3" /> Analizar</>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Active result */}
      {activeResult && (
        <div className="bg-[hsl(228_24%_7%)] border border-primary/30 rounded-[10px] overflow-hidden shadow-md">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2 bg-primary/5">
            {(() => {
              const cfg = ANALYSIS_CONFIG[activeResult.type];
              const Icon = cfg.icon;
              return (
                <>
                  <Icon className={`w-4 h-4 ${cfg.color}`} />
                  <h2 className="font-semibold text-sm flex-1">{cfg.label}</h2>
                  <span className="text-xs text-muted-foreground">
                    {new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </>
              );
            })()}
          </div>
          <ResultCard content={activeResult.content} type={activeResult.type} />
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Historial de sesión
          </h2>
          {history.slice(1).map((entry) => (
            <HistoryItem key={entry.id} entry={entry} onExpand={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}
