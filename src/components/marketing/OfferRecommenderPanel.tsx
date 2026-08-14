import { useState, useEffect } from 'react';
import { useOrg } from '@/lib/orgContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, TrendingDown, TrendingUp, Zap, Star, Package, X, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { dismissRecommendation, listAIRecommendations } from '@/lib/marketingExtraDB';

const TYPE_META: Record<string, { icon: any; color: string; label: string }> = {
  liquidacion: { icon: TrendingDown, color: 'bg-red-500/20 text-red-300', label: 'Liquidación' },
  flash: { icon: Zap, color: 'bg-amber-500/20 text-amber-300', label: 'Flash sale' },
  destacado: { icon: Star, color: 'bg-purple-500/20 text-purple-300', label: 'Destacar' },
  mayorista: { icon: Package, color: 'bg-blue-500/20 text-blue-300', label: 'Mayorista' },
  pack_decants: { icon: Package, color: 'bg-pink-500/20 text-pink-300', label: 'Pack decants' },
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
}

export default function OfferRecommenderPanel() {
  const { activeOrg } = useOrg();
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [recs, setRecs] = useState<any[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  const loadHistory = async () => {
    setHistory(await listAIRecommendations('pending'));
  };
  useEffect(() => { loadHistory(); }, []);

  const generate = async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-offer-recommender', {
        body: { org_id: activeOrg.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRecs(data.ofertas || []);
      setCombos(data.combos || []);
      toast.success(`${data.ofertas?.length || 0} ofertas generadas`);
      loadHistory();
    } catch (e: any) {
      toast.error(e.message || 'Error al generar');
    } finally {
      setLoading(false);
    }
  };

  const apply = async (rec: any) => {
    if (!rec._id) {
      toast.error('La recomendación no se pudo identificar. Generala otra vez antes de aplicarla.');
      return;
    }
    setApplyingId(rec._id);
    try {
      const { error } = await supabase.rpc('apply_ai_offer_recommendation', {
        p_recommendation_id: rec._id,
      });
      if (error) throw error;
      setRecs(current => current.filter(item => item._id !== rec._id));
      await loadHistory();
      toast.success('Oferta aplicada y acción registrada');
    } catch (e: any) {
      toast.error(e.message || 'No se pudo aplicar la recomendación');
    } finally {
      setApplyingId(null);
    }
  };

  const dismiss = async (id: string) => {
    try {
      await dismissRecommendation(id);
      setRecs(current => current.filter(item => item._id !== id));
      await loadHistory();
      toast.info('Recomendación descartada');
    } catch (e: any) {
      toast.error(e.message || 'No se pudo descartar la recomendación');
    }
  };

  const allRecs = [...recs, ...history.filter(h => !recs.find(r => r.product_id === h.product_id)).map(h => ({
    product_id: h.product_id, product_name: h.payload?.product_name, tipo: h.offer_type,
    razon: h.reason, descuento_sugerido_percent: h.suggested_discount_percent,
    precio_sugerido_ars: h.suggested_price_ars, duracion_horas: h.duration_hours,
    margen_resultante_percent: h.resulting_margin_percent, probabilidad_venta: h.probability,
    canal_recomendado: h.recommended_channel, _id: h.id,
  }))];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Recomendador de ofertas IA</h2>
          <p className="text-sm text-muted-foreground">Análisis en tiempo real de tu stock, ventas y márgenes. Cero hardcodeos.</p>
        </div>
        <Button onClick={generate} disabled={loading} className="gradient-gold text-primary-foreground">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
          Generar recomendaciones
        </Button>
      </div>

      {allRecs.length === 0 && !loading && (
        <Card className="p-8 text-center border-dashed">
          <Sparkles className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Tocá "Generar recomendaciones" para que la IA analice tu negocio.</p>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {allRecs.map((r, idx) => {
          const meta = TYPE_META[r.tipo] || TYPE_META.destacado;
          const Icon = meta.icon;
          return (
            <Card key={r._id || `${r.product_id}-${idx}`} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <Badge className={meta.color}>{meta.label}</Badge>
                    <p className="font-semibold text-sm mt-1 truncate">{r.product_name || 'Producto'}</p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">{r.probabilidad_venta}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{r.razon}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {r.descuento_sugerido_percent && <div><div className="text-muted-foreground">Descuento</div><div className="font-bold text-emerald-400">-{r.descuento_sugerido_percent}%</div></div>}
                {r.precio_sugerido_ars && <div><div className="text-muted-foreground">Precio</div><div className="font-bold">{fmt(r.precio_sugerido_ars)}</div></div>}
                {r.duracion_horas && <div><div className="text-muted-foreground">Duración</div><div className="font-bold">{r.duracion_horas}h</div></div>}
              </div>
              <div className="text-xs text-muted-foreground">📍 Canal: <strong>{r.canal_recomendado?.replace(/_/g, ' ')}</strong></div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => apply(r)} disabled={!r._id || applyingId === r._id} className="flex-1">
                  {applyingId === r._id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Check className="w-3 h-3 mr-1" />}
                  Aplicar
                </Button>
                {r._id && <Button size="sm" variant="ghost" disabled={applyingId === r._id} onClick={() => dismiss(r._id)}><X className="w-3 h-3" /></Button>}
              </div>
            </Card>
          );
        })}
      </div>

      {combos.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Package className="w-4 h-4" /> Combos sugeridos</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {combos.map((c, i) => (
              <Card key={i} className="p-4">
                <p className="font-semibold text-sm">{c.nombre}</p>
                <p className="text-xs text-muted-foreground mt-1">{c.razon}</p>
                <div className="flex justify-between mt-3 text-sm">
                  <span>Precio combo: <strong>{fmt(c.precio_combo_ars)}</strong></span>
                  {c.ahorro_ars && <span className="text-emerald-400">Ahorro: {fmt(c.ahorro_ars)}</span>}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
