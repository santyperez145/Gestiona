import { useState, useEffect } from 'react';
import { useOrg } from '@/lib/orgContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles, TrendingDown, TrendingUp, Zap, Star, Package, X, Check,
  Loader2, Activity, RotateCcw, ShieldCheck, Clock3,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  dismissRecommendation,
  listAIRecommendations,
  listPriceChangeOutcomes,
  measurePriceChangeOutcome,
  revertPriceChangeProposal,
} from '@/lib/marketingExtraDB';
import { useHasPermission } from '@/lib/usePermissions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { observedPriceLabel, priceOutcomeProgress, priceOutcomeState } from '@/lib/priceChangeOutcome';

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

function signedMoney(value: number | null | undefined) {
  if (value == null) return 'Sin evidencia completa';
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmt(value)}/día`;
}

export default function OfferRecommenderPanel() {
  const { activeOrg } = useOrg();
  const canEditMarketing = useHasPermission('marketing', 'edit');
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [measuringId, setMeasuringId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [recs, setRecs] = useState<any[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [outcomes, setOutcomes] = useState<any[]>([]);
  const [revertTarget, setRevertTarget] = useState<any | null>(null);
  const [revertReason, setRevertReason] = useState('');

  const loadHistory = async () => {
    const [pending, appliedOutcomes] = await Promise.all([
      listAIRecommendations('pending'),
      listPriceChangeOutcomes(),
    ]);
    setHistory(pending);
    setOutcomes(appliedOutcomes);
  };
  useEffect(() => {
    if (activeOrg?.id) {
      void loadHistory().catch(error => {
        console.error('No se pudo cargar el historial de recomendaciones:', error);
        toast.error('No se pudo cargar el historial de decisiones');
      });
    }
  }, [activeOrg?.id]);

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
      await loadHistory();
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

  const measureOutcome = async (recommendationId: string) => {
    setMeasuringId(recommendationId);
    try {
      const result = await measurePriceChangeOutcome(recommendationId) as any;
      await loadHistory();
      toast.success(result?.is_mature
        ? 'Ventana medida con la evidencia disponible'
        : 'Señal temprana actualizada; todavía no es un resultado final');
    } catch (e: any) {
      toast.error(e.message || 'No se pudo medir el resultado');
    } finally {
      setMeasuringId(null);
    }
  };

  const confirmRevert = async () => {
    if (!revertTarget) return;
    setRevertingId(revertTarget.recommendation_id);
    try {
      await revertPriceChangeProposal(revertTarget.recommendation_id, revertReason);
      setRevertTarget(null);
      setRevertReason('');
      await loadHistory();
      toast.success('Precio anterior restaurado con trazabilidad');
    } catch (e: any) {
      toast.error(e.message || 'No se pudo revertir la propuesta');
    } finally {
      setRevertingId(null);
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

      {outcomes.length > 0 && (
        <section className="space-y-3 pt-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Decisiones de precio
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Línea base congelada, acción reversible y resultado observado. Un antes/después no prueba causalidad.
              </p>
            </div>
            <Badge variant="outline">{outcomes.length} con evidencia</Badge>
          </div>

          <div className="grid xl:grid-cols-2 gap-3">
            {outcomes.map(outcome => {
              const evidenceState = priceOutcomeState(outcome);
              const progress = priceOutcomeProgress(outcome.applied_at, outcome.measurement_due_at);
              const basePrice = Number(outcome.original_discount_price_ars || outcome.original_sale_price_ars || 0);
              const contributionKnown = outcome.contribution_per_day_delta_ars != null;
              const coverage = outcome.observed_coverage_pct == null
                ? outcome.baseline_coverage_pct
                : outcome.observed_coverage_pct;
              return (
                <Card key={outcome.recommendation_id} className="p-4 space-y-3 border-primary/15">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{outcome.product_name}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{outcome.reason}</p>
                    </div>
                    <Badge variant={outcome.status === 'reverted' ? 'secondary' : 'outline'}>
                      {outcome.status === 'reverted' ? 'Revertida' : 'Aplicada'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/25 p-3 text-xs">
                    <div><p className="text-muted-foreground">Precio previo</p><p className="font-mono font-semibold">{fmt(basePrice)}</p></div>
                    <div><p className="text-muted-foreground">Precio aplicado</p><p className="font-mono font-semibold text-primary">{fmt(Number(outcome.applied_price_ars))}</p></div>
                    <div><p className="text-muted-foreground">Cobertura</p><p className="font-mono font-semibold">{coverage == null ? 'Sin ventas' : `${coverage}%`}</p></div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> {observedPriceLabel(outcome)}</span>
                      {progress != null && <span className="font-mono">{progress}%</span>}
                    </div>
                    {progress != null && <Progress value={progress} className="h-1.5" />}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border/50 p-2">
                      <p className="text-muted-foreground">Ingreso observado</p>
                      <p className="font-mono font-semibold">{outcome.observed_revenue_ars == null ? 'Aún no medido' : fmt(Number(outcome.observed_revenue_ars))}</p>
                    </div>
                    <div className="rounded-md border border-border/50 p-2">
                      <p className="text-muted-foreground">Δ contribución diaria</p>
                      <p className={`font-mono font-semibold ${
                        Number(outcome.contribution_per_day_delta_ars) > 0 ? 'text-emerald-400' :
                        Number(outcome.contribution_per_day_delta_ars) < 0 ? 'text-red-400' : ''
                      }`}>{signedMoney(outcome.contribution_per_day_delta_ars)}</p>
                    </div>
                  </div>

                  {!contributionKnown && evidenceState !== 'awaiting_sales' && (
                    <div className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      <span>No se publica impacto en margen hasta que baseline y observación tengan costo, cobro, envío e IVA.</span>
                    </div>
                  )}

                  {canEditMarketing && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        disabled={measuringId === outcome.recommendation_id}
                        onClick={() => void measureOutcome(outcome.recommendation_id)}
                      >
                        {measuringId === outcome.recommendation_id
                          ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          : <Activity className="mr-1 h-3.5 w-3.5" />}
                        Actualizar resultado
                      </Button>
                      {outcome.status === 'applied' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={revertingId === outcome.recommendation_id}
                          onClick={() => setRevertTarget(outcome)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Revertir
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

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

      <Dialog open={!!revertTarget} onOpenChange={open => {
        if (!open && !revertingId) {
          setRevertTarget(null);
          setRevertReason('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revertir cambio de precio</DialogTitle>
            <DialogDescription>
              Gestiona restaura el precio anterior sólo si nadie lo modificó después. La decisión y el motivo quedan auditados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="price-revert-reason">Motivo</Label>
            <Input
              id="price-revert-reason"
              value={revertReason}
              onChange={event => setRevertReason(event.target.value)}
              maxLength={500}
              placeholder="Ej. rotación menor a la esperada"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={!!revertingId} onClick={() => setRevertTarget(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={!!revertingId} onClick={() => void confirmRevert()}>
              {revertingId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Restaurar precio anterior
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
