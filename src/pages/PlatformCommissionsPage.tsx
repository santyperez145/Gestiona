import { useEffect, useState, useCallback, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformAccess } from '@/lib/usePermissions';
import { toast } from 'sonner';
import {
  Percent, DollarSign, TrendingUp, Save, Plus, Trash2, Loader2,
  Calculator, CreditCard, Building2, Info, ShieldCheck, Clock3, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import UnitEconomicsWorkbench from '@/components/platform/UnitEconomicsWorkbench';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  PROVIDER_LABEL, METHOD_LABEL, computeSettlement, resolveProviderFee,
  resolvePlatformRule, type ProviderFee, type CommissionRule,
} from '@/lib/paymentFees';

const fmt = (n: number) =>
  `${Math.round(n).toLocaleString('es-AR')}`;

// ⚠️ Los dos únicos cobros reales son de $1 con $0,05 de comisión. Con `fmt`
// se ven como "$0", que es exactamente el número equivocado en la pantalla que
// existe para mostrar cuánto se ganó. Debajo de $1.000 se muestran los centavos.
const fmtFino = (n: number) =>
  Math.abs(n) < 1000
    ? `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : fmt(n);

const monthLabel = (value: string) => {
  const [year, month] = value.slice(0, 7).split('-').map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1, 12).toLocaleDateString('es-AR', {
    month: 'long', year: 'numeric',
  });
};

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
  created_at: string;
  notes?: string | null;
  approval_status: 'draft' | 'approved' | 'retired';
  change_reason: string | null;
  terms_version: string | null;
  tax_treatment: 'included' | 'added' | null;
  tax_rate_pct: number;
  effective_from: string | null;
  effective_until: string | null;
  approved_at: string | null;
}

interface PlanOption { id: string; name: string; code: string }

interface GrossProfitRow {
  transaccion_id: string;
  comercio: string | null;
  proveedor: string;
  medio: string | null;
  cuotas: number | null;
  fecha: string;
  moneda: string;
  bruto_procesado: number;
  comision_plataforma: number;
  iva_de_la_comision: number;
  gross_profit: number;
  take_rate_pct: number | null;
  costo_del_comercio: number;
  estado: string;
  monto_muy_chico_para_comparar: boolean;
}

const commissionDraftArgs = (r: RuleRow) => ({
  p_rule_id: r.id,
  p_plan_id: r.plan_id,
  p_org_id: r.org_id,
  p_percent: r.percent,
  p_fixed: r.fixed,
  p_max_per_transaction: r.max_per_transaction,
  p_min_per_transaction: r.min_per_transaction ?? 0,
  p_applies_to: r.applies_to,
  p_change_reason: r.change_reason,
});

export default function PlatformCommissionsPage() {
  usePageTitle('Comisiones');
  const { canBilling, loading: accessLoading } = usePlatformAccess();

  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [grossProfit, setGrossProfit] = useState<GrossProfitRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [approvalRule, setApprovalRule] = useState<RuleRow | null>(null);
  const [approvalTerms, setApprovalTerms] = useState('');
  const [approvalTaxTreatment, setApprovalTaxTreatment] = useState<'included' | 'added'>('included');
  const [approvalTaxRate, setApprovalTaxRate] = useState(21);
  const [approvalStartsAt, setApprovalStartsAt] = useState('');
  const [approvalEndsAt, setApprovalEndsAt] = useState('');

  // Simulador
  const [simGross, setSimGross] = useState(10000);
  const [simProvider, setSimProvider] = useState('mercadopago');
  const [simMethod, setSimMethod] = useState('credit');
  const [simInstallments, setSimInstallments] = useState(1);
  const [simPlan, setSimPlan] = useState<string>('none');

  const load = useCallback(async () => {
    setLoading(true);
    const [revResult, feeResult, ruleResult, planResult, gpResult] = await Promise.all([
      supabase.from('platform_revenue_monthly').select('*').order('month', { ascending: false }).limit(12),
      supabase.from('payment_provider_fees').select('*').order('provider').order('method').order('installments'),
      supabase.from('platform_commission_rules').select('*').order('created_at'),
      supabase.from('plans').select('id, name, code').order('sort_order'),
      supabase.from('platform_gross_profit_por_pago')
        .select('*').order('fecha', { ascending: false }).limit(50),
    ]);
    const error = revResult.error || feeResult.error || ruleResult.error || planResult.error || gpResult.error;
    if (error) {
      toast.error(`No se pudieron cargar las comisiones: ${error.message}`);
      setLoading(false);
      return;
    }
    setRevenue((revResult.data || []) as unknown as RevenueRow[]);
    setFees((feeResult.data || []) as unknown as FeeRow[]);
    setRules((ruleResult.data || []) as unknown as RuleRow[]);
    setPlans((planResult.data || []) as unknown as PlanOption[]);
    setGrossProfit((gpResult.data || []) as unknown as GrossProfitRow[]);
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
    if (!r.change_reason?.trim()) {
      toast.error('Explicá por qué se propone este precio');
      return;
    }
    setSavingId(r.id);
    const { error } = await supabase.rpc('save_platform_commission_rule', commissionDraftArgs(r));
    setSavingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Propuesta guardada como borrador; no se está cobrando');
    load();
  }

  async function addRule() {
    const { error } = await supabase.rpc('save_platform_commission_rule', {
      p_plan_id: null,
      p_org_id: null,
      p_percent: 0,
      p_fixed: 0,
      p_max_per_transaction: null,
      p_min_per_transaction: 0,
      p_applies_to: 'online',
      p_change_reason: 'Nueva propuesta pendiente de definición',
    });
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function retireRule(r: RuleRow) {
    const reason = window.prompt('Motivo para retirar la regla (queda en el historial):');
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc('retire_platform_commission_rule', {
      p_rule_id: r.id,
      p_reason: reason,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Regla retirada; dejó de cobrar y conserva su auditoría');
    load();
  }

  function openApproval(r: RuleRow) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setApprovalRule(r);
    setApprovalTerms(r.terms_version || 'merchant-terms-v1');
    setApprovalTaxTreatment(r.tax_treatment || 'included');
    setApprovalTaxRate(Number(r.tax_rate_pct || 21));
    setApprovalStartsAt(now.toISOString().slice(0, 16));
    setApprovalEndsAt('');
  }

  async function approveRule() {
    if (!approvalRule || !approvalTerms.trim() || !approvalStartsAt) {
      toast.error('Completá términos y comienzo de vigencia');
      return;
    }
    setSavingId(approvalRule.id);
    // Persiste exactamente la propuesta visible antes de aprobar. Si esto
    // falla, la regla queda segura como borrador y no se intenta activarla.
    const { error: draftError } = await supabase.rpc(
      'save_platform_commission_rule',
      commissionDraftArgs(approvalRule),
    );
    if (draftError) {
      setSavingId(null);
      toast.error(draftError.message);
      return;
    }
    const { error } = await supabase.rpc('approve_platform_commission_rule', {
      p_rule_id: approvalRule.id,
      p_terms_version: approvalTerms.trim(),
      p_tax_treatment: approvalTaxTreatment,
      p_tax_rate_pct: approvalTaxRate,
      p_effective_from: new Date(approvalStartsAt).toISOString(),
      p_effective_until: approvalEndsAt ? new Date(approvalEndsAt).toISOString() : null,
    });
    setSavingId(null);
    if (error) { toast.error(error.message); return; }
    setApprovalRule(null);
    toast.success('Regla aprobada y activa dentro de su vigencia');
    load();
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

  const economicsBaseline = useMemo(() => {
    const current = revenue.find(row => row.currency === 'ARS');
    const proposedRule = rules
      .filter(rule => !rule.plan_id && !rule.org_id && rule.approval_status !== 'retired'
        && (rule.applies_to === 'online' || rule.applies_to === 'all'))
      .sort((a, b) => Number(Boolean(b.is_active)) - Number(Boolean(a.is_active))
        || b.created_at.localeCompare(a.created_at))[0] || null;
    const providerFee = resolveProviderFee(fees, {
      provider: 'mercadopago', method: 'credit', installments: 0,
    });
    return { current, proposedRule, providerFee };
  }, [fees, revenue, rules]);

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
        <TabsList className="bg-muted/50 max-w-full overflow-x-auto justify-start">
          <TabsTrigger value="reglas" className="gap-2"><Percent className="w-3.5 h-3.5" /> Nuestra comisión</TabsTrigger>
          <TabsTrigger value="aranceles" className="gap-2"><CreditCard className="w-3.5 h-3.5" /> Aranceles</TabsTrigger>
          <TabsTrigger value="revenue" className="gap-2"><TrendingUp className="w-3.5 h-3.5" /> Revenue mensual</TabsTrigger>
          <TabsTrigger value="simulador" className="gap-2"><Calculator className="w-3.5 h-3.5" /> Simulador</TabsTrigger>
          <TabsTrigger value="economics" className="gap-2"><Building2 className="w-3.5 h-3.5" /> Unit economics</TabsTrigger>
        </TabsList>

        {/* ── Reglas de comisión ─────────────────────────────────── */}
        <TabsContent value="reglas" className="mt-4 space-y-3">
          <div className="bg-primary/6 border border-primary/20 rounded-[10px] px-4 py-3 flex gap-2">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Una edición queda como borrador y cobra $0 hasta registrar términos,
              tratamiento fiscal y vigencia. Después se resuelve de lo más específico a lo más general:
              <span className="text-foreground"> acuerdo por org → plan → regla base</span>.
              El porcentaje de Mercado Pago lo paga el comercio por separado; no es costo de la plataforma.
            </p>
          </div>

          {rules.map(r => {
            const isBase = !r.plan_id && !r.org_id;
            const now = Date.now();
            const startsAt = r.effective_from ? new Date(r.effective_from).getTime() : null;
            const endsAt = r.effective_until ? new Date(r.effective_until).getTime() : null;
            const inForce = r.approval_status === 'approved'
              && startsAt != null && startsAt <= now
              && (endsAt == null || endsAt > now);
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
                  <Badge
                    variant={inForce ? 'secondary' : 'outline'}
                    className={inForce
                      ? 'text-[10px] border-emerald-500/30 text-emerald-400'
                      : r.approval_status === 'retired'
                        ? 'text-[10px] text-muted-foreground'
                        : 'text-[10px] border-amber-500/30 text-amber-400'}
                  >
                    {inForce
                      ? 'Aprobada · activa'
                      : r.approval_status === 'approved' && startsAt != null && startsAt > now
                        ? 'Aprobada · programada'
                        : r.approval_status === 'approved'
                          ? 'Aprobada · fuera de vigencia'
                      : r.approval_status === 'retired'
                        ? 'Retirada'
                        : 'Borrador · cobra $0'}
                  </Badge>
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

                <div>
                  <Label className="text-[10px]">Motivo y evidencia de la propuesta</Label>
                  <Input
                    className="h-8 text-xs"
                    value={r.change_reason || ''}
                    placeholder="Ej: cubre soporte de pagos; validado con contrato y modelo v1"
                    onChange={e => patchRule(r.id, { change_reason: e.target.value })}
                  />
                </div>

                {r.approval_status === 'approved' && (
                  <div className="rounded-[7px] bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-[11px] text-muted-foreground">
                    <span className="text-emerald-400 font-medium">{r.terms_version}</span>
                    {' · '}{r.tax_treatment === 'included' ? 'impuesto incluido' : 'impuesto adicional'} {r.tax_rate_pct}%
                    {' · desde '}{r.effective_from ? new Date(r.effective_from).toLocaleString('es-AR') : '—'}
                    {r.effective_until && <> · hasta {new Date(r.effective_until).toLocaleString('es-AR')}</>}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  {r.approval_status !== 'retired' && (
                    <Button variant="ghost" size="sm" className="text-destructive/70"
                      onClick={() => retireRule(r)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Retirar
                    </Button>
                  )}
                  {r.approval_status === 'draft' && (
                    <Button variant="outline" size="sm" onClick={() => openApproval(r)}
                      disabled={savingId === r.id || !r.change_reason?.trim()}>
                      <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Aprobar y activar
                    </Button>
                  )}
                  <Button size="sm" onClick={() => saveRule(r)}
                    disabled={savingId === r.id || r.approval_status === 'retired'}>
                    {savingId === r.id
                      ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      : <Save className="w-3.5 h-3.5 mr-1" />}
                    Guardar borrador
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
                Cada pago aprobado con confirmación de MercadoPago va a aparecer acá con su desglose de comisiones.
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
                        {monthLabel(r.month)}
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

          {/* ── Gross profit por pago ────────────────────────────────────── */}
          {grossProfit.length > 0 && (
            <div className="mt-4 bg-card border border-border/60 rounded-[10px]">
              <div className="px-4 py-3 border-b border-border/40">
                <h3 className="text-sm font-semibold">Gross profit por pago</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lo que cobramos menos el IVA de esa comisión, pago por pago. No resta la
                  comisión de MercadoPago: <strong>esa la paga el comercio</strong>, no la
                  plataforma. Es contribución <em>antes</em> de infraestructura, que todavía
                  no está medida por transacción.
                </p>
              </div>

              {grossProfit.every(g => g.monto_muy_chico_para_comparar) && (
                <div className="mx-4 mt-3 flex items-start gap-2 rounded-[8px] border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Todos los cobros son de menos de $1.000. El take rate de una prueba de $1
                    lo domina el redondeo a dos decimales: sirve para ver que el circuito
                    corre, no para compararlo contra el de nadie.
                  </p>
                </div>
              )}

              <div className="overflow-x-auto mt-3">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 border-y border-border/40">
                    <tr className="text-muted-foreground">
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Fecha</th>
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Comercio</th>
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Medio</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Bruto</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Comisión</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">IVA</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Gross profit</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Take rate</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Le costó al comercio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {grossProfit.map(g => (
                      <tr key={g.transaccion_id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(g.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                        </td>
                        <td className="px-3 py-2 max-w-[180px] truncate" title={g.comercio || ''}>
                          {g.comercio || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {METHOD_LABEL[g.medio || ''] || g.medio || '—'}
                          {(g.cuotas ?? 1) > 1 && <span className="ml-1">×{g.cuotas}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{fmtFino(Number(g.bruto_procesado))}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtFino(Number(g.comision_plataforma))}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {fmtFino(Number(g.iva_de_la_comision))}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-400 font-semibold">
                          {fmtFino(Number(g.gross_profit))}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {g.take_rate_pct === null
                            ? <span className="text-muted-foreground">—</span>
                            : `${Number(g.take_rate_pct)}%`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {fmtFino(Number(g.costo_del_comercio))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border/40">
                Últimos {grossProfit.length} cobros. El IVA sale de la regla que estaba
                vigente <strong>al momento del cobro</strong>: una regla nueva no reescribe
                lo que se ganó el mes pasado.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Simulador ─────────────────────────────────────────── */}
        <TabsContent value="simulador" className="mt-4">
          <div className="bg-card border border-border/60 rounded-[10px] p-4 space-y-4 max-w-2xl">
            <p className="text-xs text-muted-foreground">
              Corre exactamente el mismo cálculo que la confirmación de MercadoPago y el checkout. Sirve para ver el impacto de un cambio de comisión antes de aplicarlo.
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

        <TabsContent value="economics" className="mt-4">
          <UnitEconomicsWorkbench
            actualGmv={Number(economicsBaseline.current?.gross_processed || 0)}
            actualTransactions={Number(economicsBaseline.current?.transactions || 0)}
            actualMerchants={Number(economicsBaseline.current?.active_orgs || 0)}
            actualPeriodLabel={economicsBaseline.current?.month
              ? monthLabel(economicsBaseline.current.month)
              : null}
            proposedRule={economicsBaseline.proposedRule}
            providerFee={economicsBaseline.providerFee}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={!!approvalRule} onOpenChange={open => { if (!open) setApprovalRule(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Aprobar comisión comercial
            </DialogTitle>
          </DialogHeader>

          <div className="rounded-[8px] border border-amber-500/25 bg-amber-500/6 px-3 py-2 text-xs text-muted-foreground">
            Esta acción habilita el monto que Mercado Pago separa de cada venta.
            Confirmá primero contrato, factura de la plataforma y tratamiento impositivo con profesionales.
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Versión de términos aceptados</Label>
              <Input value={approvalTerms} onChange={e => setApprovalTerms(e.target.value)}
                placeholder="merchant-terms-v1" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tratamiento fiscal</Label>
                <Select value={approvalTaxTreatment}
                  onValueChange={v => setApprovalTaxTreatment(v as 'included' | 'added')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="included">Impuesto incluido</SelectItem>
                    <SelectItem value="added">Impuesto adicional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tasa fiscal %</Label>
                <Input type="number" min="0" max="100" step="0.5" value={approvalTaxRate}
                  onChange={e => setApprovalTaxRate(Number(e.target.value))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Comienza</Label>
                <Input type="datetime-local" value={approvalStartsAt}
                  onChange={e => setApprovalStartsAt(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Termina (opcional)</Label>
                <Input type="datetime-local" value={approvalEndsAt}
                  onChange={e => setApprovalEndsAt(e.target.value)} />
              </div>
            </div>

            {approvalRule && (
              <div className="rounded-[8px] border border-border/50 divide-y divide-border/30 text-xs">
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Propuesta</span>
                  <span className="font-mono">{approvalRule.percent}% + {fmt(approvalRule.fixed)}</span>
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span className="text-muted-foreground">Canal</span>
                  <span>{approvalRule.applies_to}</span>
                </div>
                <div className="px-3 py-2 text-muted-foreground">
                  {approvalRule.change_reason}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalRule(null)}>Cancelar</Button>
            <Button onClick={approveRule}
              disabled={!approvalTerms.trim() || !approvalStartsAt || savingId === approvalRule?.id}>
              {savingId === approvalRule?.id
                ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                : <Clock3 className="w-4 h-4 mr-1" />}
              Aprobar dentro de la vigencia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
