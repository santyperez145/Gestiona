import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  Zap, Plus, X, Save, Search, Trash2, Edit2, Clock, CheckCircle,
  PauseCircle, XCircle, RefreshCw, Tag, DollarSign, Users,
  ChevronDown, ChevronUp, Calendar, Copy, BarChart3, Percent,
  Gift, ShoppingBag, Timer, Play, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, formatDistanceToNow, differenceInSeconds, isPast, isFuture } from "date-fns";
import { es } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────
type PromoStatus = 'scheduled' | 'active' | 'paused' | 'ended' | 'cancelled';
type PromoType = 'percentage' | 'fixed' | 'buy_x_get_y' | 'free_shipping' | 'bundle_price';

interface Promotion {
  id: string;
  name: string;
  description: string | null;
  type: PromoType;
  status: PromoStatus;
  discount_value: number;
  min_order_value: number;
  max_uses: number | null;
  uses_count: number;
  uses_per_customer: number;
  applies_to: string;
  coupon_code: string | null;
  starts_at: string;
  ends_at: string | null;
  banner_text: string | null;
  banner_color: string;
  show_countdown: boolean;
  created_at: string;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<PromoStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  scheduled: { label: 'Programada', color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',     icon: Clock },
  active:    { label: 'Activa',     color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: Play },
  paused:    { label: 'Pausada',    color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',    icon: PauseCircle },
  ended:     { label: 'Finalizada', color: 'text-slate-400',   bg: 'bg-slate-500/10 border-slate-500/20',    icon: CheckCircle },
  cancelled: { label: 'Cancelada',  color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',        icon: XCircle },
};

const TYPE_CFG: Record<PromoType, { label: string; icon: React.ElementType; description: string }> = {
  percentage:    { label: 'Descuento %',     icon: Percent,    description: 'X% sobre el total' },
  fixed:         { label: 'Monto fijo',      icon: DollarSign, description: 'Descuento en ARS fijo' },
  buy_x_get_y:   { label: '2x1 / nxm',       icon: Gift,       description: 'Llevás X pagás Y' },
  free_shipping: { label: 'Envío gratis',     icon: ShoppingBag,description: 'Elimina costo de envío' },
  bundle_price:  { label: 'Precio bundle',   icon: Tag,        description: 'Precio especial por conjunto' },
};

const COLORS = ['#e11d48','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899'];

const emptyForm = () => ({
  name: '', description: '', type: 'percentage' as PromoType, discount_value: '',
  min_order_value: '0', max_uses: '', uses_per_customer: '0',
  applies_to: 'all', coupon_code: '', starts_at: '', ends_at: '',
  banner_text: '', banner_color: '#e11d48', show_countdown: true,
});

// ── Countdown hook ────────────────────────────────────────────────────────────
function useCountdown(endsAt: string | null) {
  const [secs, setSecs] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) return;
    const update = () => {
      const s = differenceInSeconds(new Date(endsAt), new Date());
      setSecs(s > 0 ? s : 0);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (secs === null || secs <= 0) return null;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// ── Countdown cell ────────────────────────────────────────────────────────────
function Countdown({ endsAt }: { endsAt: string | null }) {
  const countdown = useCountdown(endsAt);
  if (!countdown) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
      <Timer className="w-2.5 h-2.5" /> {countdown}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PromotionsPage() {
  usePageTitle("Promociones & Flash Sales");
  const { activeOrg } = useOrg();
  const { isAdmin } = useUserRole();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | PromoStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // coupon_code (uppercased) -> count of matching rows in `coupons`, for the
  // "Cupones asociados" cross-link with /cupones
  const [couponCountByCode, setCouponCountByCode] = useState<Record<string, number>>({});

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const [{ data, error }, couponsRes] = await Promise.all([
        supabase
          .from("promotions")
          .select("*")
          .eq("org_id", activeOrg.id)
          .order("starts_at", { ascending: false }),
        supabase.from("coupons").select("code").eq("org_id", activeOrg.id),
      ]);
      if (error) throw error;
      // type/applies_to/status son TEXT con CHECK en DB → llegan como string
      setPromotions((data ?? []) as Promotion[]);
      const counts: Record<string, number> = {};
      (couponsRes.data || []).forEach((c: any) => {
        if (!c.code) return;
        const k = c.code.toUpperCase();
        counts[k] = (counts[k] || 0) + 1;
      });
      setCouponCountByCode(counts);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (p: Promotion) => {
    setEditing(p);
    setForm({
      name: p.name, description: p.description ?? '', type: p.type,
      discount_value: p.discount_value.toString(), min_order_value: p.min_order_value.toString(),
      max_uses: p.max_uses?.toString() ?? '', uses_per_customer: p.uses_per_customer.toString(),
      applies_to: p.applies_to, coupon_code: p.coupon_code ?? '',
      starts_at: p.starts_at.slice(0, 16), ends_at: p.ends_at?.slice(0, 16) ?? '',
      banner_text: p.banner_text ?? '', banner_color: p.banner_color,
      show_countdown: p.show_countdown,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (!form.starts_at) { toast.error("La fecha de inicio es obligatoria"); return; }
    if (!activeOrg?.id) return;
    setSaving(true);
    try {
      // Auto-determine initial status
      const startsAt = new Date(form.starts_at);
      const endsAt = form.ends_at ? new Date(form.ends_at) : null;
      let status: PromoStatus = 'scheduled';
      if (endsAt && isPast(endsAt)) status = 'ended';
      else if (!isFuture(startsAt)) status = 'active';

      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        type: form.type,
        status,
        discount_value: parseFloat(form.discount_value) || 0,
        min_order_value: parseFloat(form.min_order_value) || 0,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
        uses_per_customer: parseInt(form.uses_per_customer) || 0,
        applies_to: form.applies_to,
        coupon_code: form.coupon_code.trim() || null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt?.toISOString() ?? null,
        banner_text: form.banner_text.trim() || null,
        banner_color: form.banner_color,
        show_countdown: form.show_countdown,
      };

      if (editing) {
        const { error } = await supabase.from("promotions").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Promoción actualizada");
      } else {
        const { error } = await supabase.from("promotions").insert({ ...payload, org_id: activeOrg.id });
        if (error) throw error;
        toast.success("Promoción creada");
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (p: Promotion) => {
    const newStatus = p.status === 'paused' ? 'active' : 'paused';
    await supabase.from("promotions").update({ status: newStatus }).eq("id", p.id);
    load();
    toast.success(`Promoción ${newStatus === 'active' ? 'reanudada' : 'pausada'}`);
  };

  const deletePromo = async (id: string) => {
    if (!confirm("¿Eliminar esta promoción?")) return;
    await supabase.from("promotions").delete().eq("id", id);
    load();
    toast.success("Promoción eliminada");
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Código "${code}" copiado`);
  };

  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setForm(f => ({ ...f, coupon_code: code }));
  };

  const discountLabel = (p: Promotion) => {
    if (p.type === 'percentage') return `${p.discount_value}% OFF`;
    if (p.type === 'fixed') return `-$${p.discount_value.toLocaleString("es-AR")}`;
    if (p.type === 'free_shipping') return 'Envío gratis';
    if (p.type === 'buy_x_get_y') return `${p.discount_value}x1`;
    return `$${p.discount_value.toLocaleString("es-AR")}`;
  };

  const filtered = useMemo(() => {
    return promotions.filter(p => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
        || (p.coupon_code ?? '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === 'all' || p.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [promotions, search, filterStatus]);

  // KPIs
  const kpis = useMemo(() => {
    const active = promotions.filter(p => p.status === 'active').length;
    const scheduled = promotions.filter(p => p.status === 'scheduled').length;
    const totalUses = promotions.reduce((s, p) => s + p.uses_count, 0);
    const expiringSoon = promotions.filter(p => {
      if (p.status !== 'active' || !p.ends_at) return false;
      return differenceInSeconds(new Date(p.ends_at), new Date()) <= 86400; // 24h
    }).length;
    return { active, scheduled, totalUses, expiringSoon };
  }, [promotions]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Zap}
        title="Promociones & Flash Sales"
        description="Descuentos, cupones y ofertas por tiempo limitado"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isAdmin && (
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-1" /> Nueva promoción
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Activas ahora" value={kpis.active} icon={Play} color="success" />
        <KPICard label="Programadas" value={kpis.scheduled} icon={Clock} color="blue" />
        <KPICard label="Vencen en 24h" value={kpis.expiringSoon} icon={Timer} color="warning" />
        <KPICard label="Usos totales" value={kpis.totalUses} icon={BarChart3} color="primary" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar promoción o código..." className="pl-8 bg-muted" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...Object.keys(STATUS_CFG)] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filterStatus === s ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}>
              {s === 'all' ? 'Todas' : STATUS_CFG[s as PromoStatus].label}
            </button>
          ))}
        </div>
      </div>

      {/* Form Dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-display font-bold">{editing ? 'Editar promoción' : 'Nueva promoción'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nombre *</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-muted" placeholder="Ej: Cyber Monday, 2x1 en Perfumes..." autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tipo de descuento</label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as PromoType }))}>
                    <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TYPE_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {form.type === 'percentage' ? 'Porcentaje (%)' : form.type === 'fixed' ? 'Monto ARS' : 'Valor'}
                  </label>
                  <Input type="number" value={form.discount_value} onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))} className="bg-muted" placeholder={form.type === 'percentage' ? '20' : '5000'} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Compra mínima (ARS)</label>
                  <Input type="number" value={form.min_order_value} onChange={e => setForm(f => ({ ...f, min_order_value: e.target.value }))} className="bg-muted" placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Máx. usos (0 = ilimitado)</label>
                  <Input type="number" value={form.max_uses} onChange={e => setForm(f => ({ ...f, max_uses: e.target.value }))} className="bg-muted" placeholder="∞" />
                </div>
              </div>

              {/* Coupon code */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Código de cupón (opcional)</label>
                <div className="flex gap-2">
                  <Input value={form.coupon_code} onChange={e => setForm(f => ({ ...f, coupon_code: e.target.value.toUpperCase() }))} className="bg-muted flex-1" placeholder="Dejar vacío para aplicación automática" />
                  <Button type="button" size="sm" variant="outline" onClick={generateCode} className="shrink-0">
                    Generar
                  </Button>
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Inicio *</label>
                  <Input type="datetime-local" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} className="bg-muted" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Fin (opcional)</label>
                  <Input type="datetime-local" value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} className="bg-muted" />
                </div>
              </div>

              {/* Banner */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Texto del banner (storefront)</label>
                <Input value={form.banner_text} onChange={e => setForm(f => ({ ...f, banner_text: e.target.value }))} className="bg-muted" placeholder="Ej: ¡Aprovechá! 20% OFF este fin de semana" />
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Color del banner</label>
                  <div className="flex gap-1.5">
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setForm(f => ({ ...f, banner_color: c }))}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${form.banner_color === c ? 'border-white scale-110' : 'border-transparent'}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm ml-4">
                  <input type="checkbox" checked={form.show_countdown} onChange={e => setForm(f => ({ ...f, show_countdown: e.target.checked }))} className="w-4 h-4 accent-primary" />
                  <Timer className="w-3.5 h-3.5" /> Mostrar cuenta regresiva
                </label>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Descripción interna</label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="bg-muted resize-none" rows={2} />
              </div>
            </div>

            {/* Preview banner */}
            {form.banner_text && (
              <div className="mx-5 mb-3 rounded-lg p-3 text-white text-sm font-semibold flex items-center justify-between" style={{ background: form.banner_color }}>
                <span>{form.banner_text}</span>
                {form.show_countdown && form.ends_at && <span className="text-xs font-mono opacity-80">⏱ 23h 59m 59s</span>}
              </div>
            )}

            <div className="flex gap-2 px-5 pb-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? 'Guardar' : 'Crear promoción'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground">
          <Zap className="w-8 h-8 mx-auto mb-3 animate-pulse text-red-400" />
          <p className="text-sm">Cargando promociones...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay promociones. Creá tu primera oferta.</p>
        </div>
      ) : (
        <div className="space-y-2 pb-12">
          {filtered.map(promo => {
            const sc = STATUS_CFG[promo.status];
            const tc = TYPE_CFG[promo.type];
            const StatusIcon = sc.icon;
            const TypeIcon = tc.icon;
            const isExpanded = expandedId === promo.id;
            const linkedCouponCount = promo.coupon_code ? (couponCountByCode[promo.coupon_code.toUpperCase()] || 0) : 0;

            return (
              <div key={promo.id} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Banner preview */}
                {promo.banner_text && promo.status === 'active' && (
                  <div className="px-4 py-2 text-white text-xs font-semibold flex items-center justify-between"
                    style={{ background: promo.banner_color }}>
                    <span>{promo.banner_text}</span>
                    {promo.show_countdown && promo.ends_at && <Countdown endsAt={promo.ends_at} />}
                  </div>
                )}

                <button className="w-full text-left p-4 flex items-start gap-3" onClick={() => setExpandedId(isExpanded ? null : promo.id)}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sc.bg}`}>
                    <StatusIcon className={`w-4 h-4 ${sc.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1"><TypeIcon className="w-3 h-3" />{tc.label}</span>
                      {promo.coupon_code && (
                        <button onClick={e => { e.stopPropagation(); copyCode(promo.coupon_code!); }}
                          className="text-[10px] font-mono bg-muted border border-border px-1.5 py-0.5 rounded flex items-center gap-1 hover:bg-muted/80">
                          <Copy className="w-2.5 h-2.5" /> {promo.coupon_code}
                        </button>
                      )}
                    </div>
                    <p className="font-semibold text-sm">{promo.name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="font-bold text-foreground">{discountLabel(promo)}</span>
                      <span>{promo.uses_count}{promo.max_uses ? `/${promo.max_uses}` : ''} usos</span>
                      {promo.ends_at && promo.status === 'active' && <Countdown endsAt={promo.ends_at} />}
                      {promo.ends_at && promo.status !== 'active' && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Hasta: {format(new Date(promo.ends_at), "d MMM yyyy HH:mm", { locale: es })}
                        </span>
                      )}
                      {promo.coupon_code && (
                        <span className={`flex items-center gap-1 ${linkedCouponCount > 0 ? "text-primary" : "text-muted-foreground/70"}`}>
                          <Tag className="w-3 h-3" />
                          Cupones asociados: {linkedCouponCount}
                        </span>
                      )}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
                             : <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-3">
                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      {['active', 'paused'].includes(promo.status) && (
                        <Button size="sm" variant="outline" onClick={() => togglePause(promo)} className="gap-1.5 text-xs">
                          {promo.status === 'active'
                            ? <><PauseCircle className="w-3.5 h-3.5 text-amber-400" /> Pausar</>
                            : <><Play className="w-3.5 h-3.5 text-emerald-400" /> Reanudar</>}
                        </Button>
                      )}
                      {isAdmin && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(promo)} className="gap-1.5 text-xs">
                            <Edit2 className="w-3.5 h-3.5" /> Editar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => deletePromo(promo.id)} className="gap-1.5 text-xs text-destructive/70 hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" /> Eliminar
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Details */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div><p className="text-xs text-muted-foreground">Descuento</p><p className="font-bold text-lg text-primary">{discountLabel(promo)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Usos</p><p className="font-semibold">{promo.uses_count}{promo.max_uses ? ` / ${promo.max_uses}` : ' / ∞'}</p></div>
                      <div><p className="text-xs text-muted-foreground">Inicio</p><p className="font-medium text-xs">{format(new Date(promo.starts_at), "d MMM yyyy HH:mm", { locale: es })}</p></div>
                      {promo.ends_at && <div><p className="text-xs text-muted-foreground">Fin</p><p className="font-medium text-xs">{format(new Date(promo.ends_at), "d MMM yyyy HH:mm", { locale: es })}</p></div>}
                      {promo.min_order_value > 0 && <div><p className="text-xs text-muted-foreground">Compra mínima</p><p className="font-semibold">${promo.min_order_value.toLocaleString("es-AR")}</p></div>}
                    </div>
                    {promo.description && <p className="text-sm text-muted-foreground">{promo.description}</p>}

                    {/* Cross-link to Cupones */}
                    {promo.coupon_code && (
                      <Link
                        to="/cupones"
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors text-xs w-fit"
                      >
                        <Tag className="w-3.5 h-3.5 text-primary" />
                        {linkedCouponCount > 0
                          ? `Cupones asociados: ${linkedCouponCount} — Ver en Cupones`
                          : `Sin cupón "${promo.coupon_code}" creado — Ir a Cupones`}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
