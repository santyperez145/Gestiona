import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, formatARS, formatUSD } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, Package, DollarSign, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type AnalysisType = 'predict_sales' | 'restock_analysis' | 'marketing_copy';

export default function AIInsightsPage() {
  const { user } = useAuth();
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [activeType, setActiveType] = useState<AnalysisType | null>(null);

  const runAnalysis = async (type: AnalysisType) => {
    if (!user) return;
    setLoading(true);
    setActiveType(type);
    setResult('');
    try {
      const [products, sales] = await Promise.all([
        getProductsDB(user.id),
        getSalesDB(user.id),
      ]);

      const simplifiedProducts = products.slice(0, 30).map(p => ({
        name: p.name, brand: p.brand, category: p.category,
        cost_usd: p.cost_usd, sale_price_ars: p.sale_price_ars,
        profit_ars: p.profit_per_unit_ars, stock: p.stock,
      }));

      const simplifiedSales = sales.slice(0, 20).map(s => ({
        product: s.product_name, qty: s.quantity,
        total_ars: s.total_ars, profit_ars: s.profit_ars,
        date: s.date, paid: s.paid,
      }));

      const { data, error } = await supabase.functions.invoke('ai-analysis', {
        body: { type, data: { products: simplifiedProducts, sales: simplifiedSales } }
      });

      if (error) throw error;
      setResult(data.content || 'Sin resultado');
    } catch (err: any) {
      toast.error(err.message || 'Error al analizar');
      setResult('Error: ' + (err.message || 'Intenta de nuevo'));
    } finally {
      setLoading(false);
    }
  };

  const analyses = [
    { type: 'predict_sales' as AnalysisType, label: 'Predicción de Ventas', desc: 'Qué productos se venderán más, tendencias y estrellas', icon: TrendingUp, color: 'text-success' },
    { type: 'restock_analysis' as AnalysisType, label: 'Análisis de Restock', desc: 'Qué reponer, cuánto invertir y qué dejar', icon: Package, color: 'text-warning' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
          <Brain className="w-7 h-7 text-primary" /> IA Insights
        </h1>
        <p className="text-muted-foreground text-sm">Inteligencia artificial para tu negocio</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {analyses.map(a => (
          <button
            key={a.type}
            onClick={() => runAnalysis(a.type)}
            disabled={loading}
            className={`bg-card border border-border rounded-lg p-6 text-left hover:border-primary/40 transition-all shadow-card ${activeType === a.type ? 'border-primary/60 ring-1 ring-primary/30' : ''}`}
          >
            <div className="flex items-center gap-3 mb-2">
              <a.icon className={`w-6 h-6 ${a.color}`} />
              <h3 className="font-display font-semibold">{a.label}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{a.desc}</p>
          </button>
        ))}
      </div>

      {loading && (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-muted-foreground">Analizando datos con IA...</p>
          <p className="text-xs text-muted-foreground mt-1">Esto puede tardar unos segundos</p>
        </div>
      )}

      {result && !loading && (
        <div className="bg-card border border-border rounded-lg p-6 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-5 h-5 text-primary" />
            <h2 className="font-display font-semibold">Resultado del Análisis</h2>
          </div>
          <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-foreground/90 leading-relaxed">
            {result}
          </div>
        </div>
      )}
    </div>
  );
}
