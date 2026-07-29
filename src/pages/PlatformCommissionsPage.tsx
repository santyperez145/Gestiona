import { useEffect, useState, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformAccess } from '@/lib/usePermissions';
import { toast } from 'sonner';
import {
  Percent, DollarSign, TrendingUp, Save, Plus, Trash2, Loader2,
  Calculator, CreditCard, Building2, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  PROVIDER_LABEL, METHOD_LABEL, computeSettlement, resolveProviderFee,
  resolvePlatformRule, type ProviderFee, type CommissionRule,
} from '@/lib/paymentFees';

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString('es-AR')}`;

interface RevenueRow {
  month: string;
  currency: string;
  transactions: number;
  active_orgs: number;
  gross_processed: number;
  platform_revenue: number;
  provider_cost: number;
  merchants_net: number;
  effective_take_rate: number;
}

interface FeeRow extends ProviderFee {
  id: string;
  notes?: string | null;
}

interface RuleRow extends CommissionRule {
  id: string;
  notes?: string | null;
}

interface PlanOption { id: string; name: string; code: string }

export default function PlatformCommissionsPage() {
  usePageTitle('Comisiones');
  const { canBilling, loading: accessLoading } = usePlatformAccess();

  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Simulador
  const [simGross, setSimGross] = useState(10000);
  const [simProvider, setSimProvider] = useState('mercadopago');
  const [simMethod, setSimMethod] = useState('credit');
  const [simInstallments, setSimInstallments] = useState(1);
  const [simPlan, setSimPlan] = useState<string>('none');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rev }, { data: f }, { data: r }, { data: p }] = await Promise.all([
      supabase.from('platform_revenue_monthly').select('*').order('month', { ascending: false }).limit(12),
      supabase.from('payment_provider_fees').select('*').order('provider').order('method').order('installments'),
      supabase.from('platform_commission_rules').select('*').order('created_at'),
      supabase.from('plans').select('id, name, code').order('sort_order'),
    ]);
    setRevenue((rev || []) as unknown as RevenueRow[]);
    setFees((f || []) as unknown as FeeRow[]);
    setRules((r || []) as unknown as RuleRow[]);
    setPlans((p || []) as unknown as PlanOption[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (canBilling) load(); }, [canBilling, load]);

  // ── Aranceles ────────────────────────────────────────────────────────────

  function patchFee(id: string, changes: Partial<FeeRow>) {
    setFees(prev => prev.map(f => f.id === id ? { ...f, ...changes } : f));
  }

  async function saveFee(f: FeeRow) {
    setSavingId(f.id);
    const { error } = await supabase.from('payment_provider_fees').update({
      percent_fee: f.percent_fee,
      fixed_fee: f.fixed_fee,
      iva_on_fee_pct: f.iva_on_fee_pct,
      release_days: f.release_days,
    } as never).eq('id', f.id);
    setSavingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Arancel actualizado');
  }

  // ── Reglas de comisión ───────────────────────────────────────────────────

  function patchRule(id: string, changes: Partial<RuleRow>) {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...changes } : r));
  }

  async function saveRule(r: RuleRow) {
    setSavingId(r.id);
    const { error } = await supabase.from('platform_commission_rules').update({
      percent: r.percent,
      fixed: r.fixed,
      max_per_transaction: r.max_per_transaction,
      min_per_transaction: r.min_per_transaction,
      applies_to: r.applies_to,
      is_active: r.is_active,
      plan_id: r.plan_id,
    } as never).eq('id', r.id);
    setSavingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Regla actualizada');
  }

  async function addRule() {
    const { error } = await supabase.from('platform_commission_rules').insert({
      plan_id: null, org_id: null, percent: 0, fixed: 0, applies_to: 'online',
    } as never);
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function deleteRule(r: RuleRow) {
    if (!r.plan_id && !r.org_id) {
      toast.error('No borres la regla base: poné el porcentaje en 0 si no querés cobrar comisión');
      return;
    }
    if (!confirm('¿Eliminar esta regla de comisión?')) return;
    const { error } = await supabase.from('platform_commission_rules').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    setRules(prev => prev.filter(x => x.id !== r.id));
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const ars = revenue.filter(r => r.currency === 'ARS');
    const thisMonth = ars[0];
    return {
      monthRevenue: Number(thisMonth?.platform_revenue || 0),
      monthGross: Number(thisMonth?.gross_processed || 0),
      takeRate: Number(thisMonth?.effective_take_rate || 0),
      transactions: Number(thisMonth?.transactions || 0),
      activeOrgs: Number(thisMonth?.active_orgs || 0),
      total12m: ars.reduce((s, r) => s + Number(r.platform_revenue || 0), 0),
    };
  }, [revenue]);

  // ── Simulación ───────────────────────────────────────────────────────────

  const simulation = useMemo(() => {
    const fee = resolveProviderFee(fees, {
      provider: simProvider,
      method: simMethod,
      installments: simInstallments <= 1 ? 0 : simInstallments,
    });
    const rule = resolvePlatformRule(rules, {
      planId: simPlan === 'none' ? null : simPlan,
      channel: 'online',
    });
    return { settlement: computeSettlement({ gross: simGross, providerFee: fee, platformRule: rule }), fee, rule };
  }, [fees, rules, simProvider, simMethod, simInstallments, simPlan, simGross]);

  if (accessLoading) {
    return <div className="p-8 text-muted-foreground text-sm">Verificando permisos...</div>;
  }
  if (!canBilling) {
    // La sección es de finanzas: soporte no ve la estructura de comisiones
    return <Navigate to="/platform" replace />;
  }
  if (loading) {
    return <div className="p-8 text-muted-foreground text-sm">Cargando comisiones...</div>;
  }

  const planName = (id: string | null | undefined) =>
    id ? (plans.find(p => p.id === id)?.name || 'plan desconocido') : 'Todos los planes';

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Percent}
        title="Comisiones y revenue"
        description="Aranceles de los medios de pago y cuánto cobra la plataforma por venta procesada"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Comisión este mes" value={fmt(totals.monthRevenue)} icon={DollarSign} color="success"
          sub={`${totals.transactions} cobros · ${totals.activeOrgs} orgs`} />
        <KPICard label="Volumen procesado" value={fmt(totals.monthGross)} icon={TrendingUp} color="primary"
          sub="bruto cobrado por las tiendas" />
        <KPICard label="Take rate efectivo" value={`${totals.takeRate}%`} icon={Percent} color="blue"
          sub="comisión / volumen" />
        <KPICard label="Últimos 12 meses" value={fmt(totals.total12m)} icon={Building2} color="warning"
          sub="comisión acumulada" />
      </div>

      <Tabs defaultValue="reglas">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="reglas" className="gap-2"><Percent className="w-3.5 h-3.5" /> Nuestra comisión</TabsTrigger>
          <TabsTrigger value="aranceles" className="gap-2"><CreditCard className="w-3.5 h-3.5" /> Aranceles</TabsTrigger>
          <TabsTrigger value="revenue" className="gap-2"><TrendingUp className="w-3.5 h-3.5" /> Revenue mensual</TabsTrigger>
          <TabsTrigger value="simulador" className="gap-2"><Calculator className="w-3.5 h-3.5" /> Simulador</TabsTrigger>
        </TabsList>

        {/* ── Reglas de comisión ─────────────────────────────────── */}
        <TabsContent value="reglas" className="mt-4 space-y-3">
          <div className="bg-primary/6 border border-primary/20 rounded-[10px] px-4 py-3 flex gap-2">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Esto es lo que la plataforma le cobra a cada tienda por venta online, además
              del arancel del procesador. Se resuelve de lo más específico a lo más general:
              <span className="text-foreground"> acuerdo por org → plan → regla base</span>.
              Poné un tope por transacción para no castigar tickets grandes.
            </p>
          </div>

          {rules.map(r => {
            const isBase = !r.plan_id && !r.org_id;
            return (
              <div key={r.id} className="bg-card border border-border/60 rounded-[10px] p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={isBase ? 'outline' : 'secondary'} className="text-[10px]">
                    {r.org_id ? 'Acuerdo puntual' : isBase ? 'Regla base' : 'Por plan'}
                  </Badge>
                  <span className="text-sm font-medium">{planName(r.plan_id)}</span>
                  {r.org_id && (
                    <code className="text-[10px] font-mono text-muted-foreground">org {r.org_id.slice(0, 8)}</code>
                  )}
                  <div className="flex-1" />
                  <Switch checked={r.is_active !== false}
                    onCheckedChange={v => patchRule(r.id, { is_active: v })} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <Label className="text-[10px]">Comisión %</Label>
                    <Input type="number" step="0.05" className="h-8 text-xs" value={r.percent}
                      onChange={e => patchRule(r.id, { percent: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Fijo por venta</Label>
                    <Input type="number" className="h-8 text-xs" value={r.fixed}
                      onChange={e => patchRule(r.id, { fixed: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Mínimo</Label>
                    <Input type="number" className="h-8 text-xs" value={r.min_per_transaction ?? 0}
                      onChange={e => patchRule(r.id, { min_per_transaction: Number(e.target.value) })} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Tope por venta</Label>
                    <Input type="number" className="h-8 text-xs" placeholder="sin tope"
                      value={r.max_per_transaction ?? ''}
                      onChange={e => patchRule(r.id, {
                        max_per_transaction: e.target.value === '' ? null : Number(e.target.value),
                      })} />
                  </div>
                  <div>
                    <Label className="text-[10px]">Canal</Label>
                    <Select value={r.applies_to}
                      onValueChange={v => patchRule(r.id, { applies_to: v as 'online' | 'pos' | 'all' })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="online">Tienda online</SelectItem>
                        <SelectItem value="pos">POS / local</SelectItem>
                        <SelectItem value="all">Todos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {!r.org_id && (
                  <div className="max-w-xs">
                    <Label className="text-[10px]">Aplicar a un plan</Label>
                    <Select value={r.plan_id || 'none'}
                      onValueChange={v => patchRule(r.id, { plan_id: v === 'none' ? null : v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Todos los planes</SelectItem>
                        {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  {!isBase && (
                    <Button variant="ghost" size="sm" className="text-destructive/70"
                      onClick={() => deleteRule(r)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Eliminar
                    </Button>
                  )}
                  <Button size="sm" onClick={() => saveRule(r)} disabled={savingId === r.id}>
                    {savingId === r.id
                      ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      : <Save className="w-3.5 h-3.5 mr-1" />}
                    Guardar
                  </Button>
                </div>
              </div>
            );
          })}

          <Button variant="outline" onClick={addRule}>
            <Plus className="w-4 h-4 mr-1" /> Nueva regla
          </Button>
        </TabsContent>

        {/* ── Aranceles del procesador ───────────────────────────── */}
        <TabsContent value="aranceles" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Lo que cobra cada procesador. Son los valores publicados al momento de la
            instalación: MercadoPago los cambia seguido, así que hay que mantenerlos
            actualizados para que las tiendas vean el neto correcto.
          </p>

          <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border/40">
                <tr className="text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Proveedor</th>
                  <th className="text-left px-3 py-2 font-medium">Medio</th>
                  <th className="text-right px-3 py-2 font-medium">Cuotas</th>
                  <th className="text-right px-3 py-2 font-medium">Arancel %</th>
                  <th className="text-right px-3 py-2 font-medium">Fijo</th>
                  <th className="text-right px-3 py-2 font-medium">IVA %</th>
                  <th className="text-right px-3 py-2 font-medium">Acredita</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {fees.map(f => (
                  <tr key={f.id} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5">{PROVIDER_LABEL[f.provider as keyof typeof PROVIDER_LABEL] || f.provider}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {METHOD_LABEL[f.method as keyof typeof METHOD_LABEL] || f.method}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{f.installments || '—'}</td>
                    <td className="px-3 py-1.5">
                      <Input type="number" step="0.01" className="h-7 w-20 text-xs text-right ml-auto"
                        value={f.percent_fee}
                        onChange={e => patchFee(f.id, { percent_fee: Number(e.target.value) })} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input type="number" className="h-7 w-20 text-xs text-right ml-auto"
                        value={f.fixed_fee}
                        onChange={e => patchFee(f.id, { fixed_fee: Number(e.target.value) })} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input type="number" step="0.5" className="h-7 w-16 text-xs text-right ml-auto"
                        value={f.iva_on_fee_pct ?? 0}
                        onChange={e => patchFee(f.id, { iva_on_fee_pct: Number(e.target.value) })} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input type="number" className="h-7 w-14 text-xs text-right ml-auto"
                        value={f.release_days ?? 0}
                        onChange={e => patchFee(f.id, { release_days: Number(e.target.value) })} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button variant="ghost" size="sm" className="h-7 px-2"
                        onClick={() => saveFee(f)} disabled={savingId === f.id}>
                        {savingId === f.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Save className="w-3 h-3" />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── Revenue mensual ───────────────────────────────────── */}
        <TabsContent value="revenue" className="mt-4">
          {revenue.length === 0 ? (
            <div className="bg-card border border-border/60 rounded-[10px] p-8 text-center">
              <TrendingUp className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium">Todavía no hay cobros registrados</p>
              <p className="text-xs text-muted-foreground mt-1">
                Cada pago aprobado que pase por el webhook de MercadoPago va a aparecer acá
                con su desglose de comisiones.
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 border-b border-border/40">
                  <tr className="text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Mes</th>
                    <th className="text-right px-3 py-2 font-medium">Cobros</th>
                    <th className="text-right px-3 py-2 font-medium">Orgs</th>
                    <th className="text-right px-3 py-2 font-medium">Volumen</th>
                    <th className="text-right px-3 py-2 font-medium">Nuestra comisión</th>
                    <th className="text-right px-3 py-2 font-medium">Costo procesador</th>
                    <th className="text-right px-3 py-2 font-medium">Neto tiendas</th>
                    <th className="text-right px-3 py-2 font-medium">Take rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {revenue.map(r => (
                    <tr key={`${r.month}-${r.currency}`} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">
                        {new Date(r.month).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
                        {r.currency !== 'ARS' && <span className="text-muted-foreground ml-1">({r.currency})</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.transactions}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.active_orgs}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(Number(r.gross_processed))}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-400 font-semibold">
                        {fmt(Number(r.platform_revenue))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {fmt(Number(r.provider_cost))}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(Number(r.merchants_net))}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.effective_take_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Simulador ─────────────────────────────────────────── */}
        <TabsContent value="simulador" className="mt-4">
          <div className="bg-card border border-border/60 rounded-[10px] p-4 space-y-4 max-w-2xl">
            <p className="text-xs text-muted-foreground">
              Corre exactamente el mismo cálculo que el webhook y el checkout. Sirve para
              ver el impacto de un cambio de comisión antes de aplicarlo.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px]">Monto de la venta</Label>
                <Input type="number" className="h-8 text-xs" value={simGross}
                  onChange={e => setSimGross(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-[10px]">Proveedor</Label>
                <Select value={simProvider} onValueChange={setSimProvider}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...new Set(fees.map(f => f.provider))].map(p => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_LABEL[p as keyof typeof PROVIDER_LABEL] || p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Medio</Label>
                <Select value={simMethod} onValueChange={setSimMethod}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Cuotas</Label>
                <Input type="number" min="1" className="h-8 text-xs" value={simInstallments}
                  onChange={e => setSimInstallments(Number(e.target.value))} />
              </div>
              <div className="col-span-2">
                <Label className="text-[10px]">Plan de la tienda</Label>
                <Select value={simPlan} onValueChange={setSimPlan}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin plan / regla base</SelectItem>
                    {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!simulation.fee && (
              <p className="text-xs text-yellow-500/90 bg-yellow-500/8 border border-yellow-500/25 rounded-[6px] px-3 py-2">
                No hay arancel cargado para esa combinación: el cálculo asume costo 0 del procesador.
              </p>
            )}

            <div className="rounded-[8px] border border-border/40 divide-y divide-border/30">
              {[
                { label: 'Paga el comprador', value: simulation.settlement.gross, strong: true },
                { label: `Arancel ${PROVIDER_LABEL[simProvider as keyof typeof PROVIDER_LABEL] || simProvider}`, value: -simulation.settlement.providerFee },
                { label: 'IVA sobre el arancel', value: -simulation.settlement.providerFeeIva },
                { label: 'Comisión de la plataforma', value: -simulation.settlement.platformFee, highlight: true },
                { label: 'Le queda a la tienda', value: simulation.settlement.net, strong: true },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2">
                  <span className={`text-xs ${row.strong ? 'font-semibold' : 'text-muted-foreground'}`}>
                    {row.label}
                  </span>
                  <span className={`text-xs font-mono ${
                    row.highlight ? 'text-emerald-400 font-semibold'
                    : row.strong ? 'font-semibold' : 'text-muted-foreground'
                  }`}>
                    {row.value < 0 ? `−${fmt(Math.abs(row.value))}` : fmt(row.value)}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Costo total de cobrar: <span className="text-foreground font-medium">
                {simulation.settlement.effectiveCostPct}%
              </span>
              {simulation.settlement.releaseDays != null && (
                <> · se acredita en {simulation.settlement.releaseDays} {simulation.settlement.releaseDays === 1 ? 'día' : 'días'}</>
              )}
              {simulation.rule && (
                <> · regla aplicada: {simulation.rule.percent}% + {fmt(simulation.rule.fixed)}</>
              )}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
