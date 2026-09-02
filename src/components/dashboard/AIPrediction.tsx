import { useEffect, useState } from "react";
import { llamarIA } from "@/lib/ia";
import { Brain, Sparkles, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/lib/orgContext";

interface Prediction {
  projectedRevenue: number;
  confidencePercent: number;
  trend: 'up' | 'down' | 'stable';
  insights: string[];
  source?: 'ai' | 'statistical';
  notice?: string;
}

export default function AIPrediction({ sales }: { sales: any[] }) {
  const { activeOrg } = useOrg();
  const [pred, setPred] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrediction = async () => {
    setLoading(true); setError(null);
    try {
      const last90 = sales
        .filter(s => new Date(s.date) >= new Date(Date.now() - 90 * 86400000))
        .map(s => ({ date: s.date, total: Number(s.total_ars), product: s.product_name }));

      if (last90.length < 5) {
        setError('Se necesitan al menos 5 ventas en los últimos 90 días');
        setLoading(false); return;
      }

      const data = await llamarIA('predict-sales', { body: { sales: last90, orgId: activeOrg?.id } });
      if (data?.error) throw new Error(data.error);
      setPred(data);
      } catch (e: any) {
      // No toast de "IA rota": el servidor ya puede devolver statistical;
      // un error real es de red/auth, no "falta Anthropic".
      setError(e.message || 'No se pudo generar la proyección');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (sales.length >= 5 && !pred) fetchPrediction(); /* eslint-disable-next-line */ }, [sales.length]);

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 md:p-5 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
          <Brain className="w-4 h-4 text-primary" />
          {pred?.source === 'statistical' ? 'Proyección — Próximos 30 días' : 'Proyección IA — Próximos 30 días'}
        </h3>
        <Button variant="ghost" size="sm" onClick={fetchPrediction} disabled={loading} className="h-7 w-7 p-0">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && (
        <div className="py-8 text-center">
          <Sparkles className="w-6 h-6 text-primary mx-auto animate-pulse mb-2" />
          <p className="text-xs text-muted-foreground">Analizando tu historial...</p>
        </div>
      )}

      {error && !loading && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          {error.includes('5 ventas')
            ? error
            : 'No se pudo enriquecer con IA. Si hay historial, reintentá: también hay proyección estadística del servidor.'}
        </p>
      )}

      {pred && !loading && (
        <div className="space-y-3">
          <div className="text-center py-2">
            <p className="text-2xl md:text-3xl font-black font-display text-primary">{formatARS(pred.projectedRevenue)}</p>
            <p className="text-[10px] text-muted-foreground">±{(100 - pred.confidencePercent).toFixed(0)}% margen de error · Tendencia: {pred.trend === 'up' ? '📈' : pred.trend === 'down' ? '📉' : '➡️'}</p>
          </div>
          {pred.source === 'statistical' && pred.notice && (
            <p className="border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">{pred.notice}</p>
          )}
          {pred.insights?.length > 0 && (
            <div className="space-y-1.5 border-t border-border pt-3">
              {pred.insights.slice(0, 3).map((ins, i) => (
                <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <Sparkles className="w-3 h-3 text-primary shrink-0 mt-0.5" /> {ins}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
