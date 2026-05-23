/**
 * CouponsPage — /cupones
 *
 * Create, manage and track promotional discount codes.
 * Reads from the `coupons` table and `sales` table for usage analytics.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  Tag, Plus, Trash2, Copy, CheckCircle2, XCircle,
  RefreshCw, Percent, DollarSign, BarChart3, AlertTriangle,
  Clock, Infinity as InfinityIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Coupon {
  id: string;
  code: string;
  discount_percent: number;
  discount_fixed_ars: number;
  max_uses: number | null;
  current_uses: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
  // Computed
  usageRevenue?: number;
  usageDiscount?: number;
  status: "active" | "expired" | "exhausted" | "inactive";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCouponStatus(c: Coupon): "active" | "expired" | "exhausted" | "inactive" {
  if (!c.active) return "inactive";
  if (c.valid_until && new Date(c.valid_until) < new Date()) return "expired";
  if (c.max_uses !== null && c.current_uses >= c.max_uses) return "exhausted";
  return "active";
}

const STATUS_CONFIG = {
  active:    { label: "Activo",    color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/10" },
  expired:   { label: "Vencido",   color: "text-red-400",     border: "border-red-400/30",     bg: "bg-red-400/10" },
  exhausted: { label: "Agotado",   color: "text-orange-400",  border: "border-orange-400/30",  bg: "bg-orange-400/10" },
  inactive:  { label: "Inactivo",  color: "text-muted-foreground", border: "border-border/40", bg: "bg-muted/20" },
};

function formatDiscount(c: Coupon): string {
  if (c.discount_percent > 0) return `${c.discount_percent}% OFF`;
  if (c.discount_fixed_ars > 0) return `${formatARS(c.discount_fixed_ars)} OFF`;
  return "—";
}

function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── Dialog form ──────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  code: "",
  discountType: "percent" as "percent" | "fixed",
  discountValue: "",
  maxUses: "",
  validUntil: "",
  active: true,
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CouponsPage() {
  usePageTitle("Cupones & Descuentos");
  const { activeOrg } = useOrg();
  const { user } = useAuth();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);

    const [couponsRes, salesRes] = await Promise.all([
      supabase
        .from("coupons")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("sales")
        .select("coupon_code, total_ars, discount_applied")
        .eq("org_id", activeOrg.id)
        .not("coupon_code", "is", null),
    ]);

    // Map coupon_code → revenue + discount
    const salesMap: Record<string, { revenue: number; discount: number; count: number }> = {};
    (salesRes.data || []).forEach((s: any) => {
      if (!s.coupon_code) return;
      const k = s.coupon_code.toUpperCase();
      if (!salesMap[k]) salesMap[k] = { revenue: 0, discount: 0, count: 0 };
      salesMap[k].revenue += s.total_ars || 0;
      salesMap[k].count++;
    });

    const rows: Coupon[] = (couponsRes.data || []).map((c: any) => {
      const usage = salesMap[c.code?.toUpperCase()] || { revenue: 0, discount: 0, count: 0 };
      const coupon: Coupon = {
        ...c,
        usageRevenue: usage.revenue,
        usageDiscount: 0,
        status: "active",
      };
      coupon.status = getCouponStatus(coupon);
      return coupon;
    });

    setCoupons(rows);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const active = coupons.filter(c => c.status === "active").length;
    const totalUses = coupons.reduce((s, c) => s + c.current_uses, 0);
    const totalRevenue = coupons.reduce((s, c) => s + (c.usageRevenue || 0), 0);
    const expired = coupons.filter(c => c.status === "expired" || c.status === "exhausted").length;
    return { active, totalUses, totalRevenue, expired };
  }, [coupons]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, code: generateCode() });
    setDialog(true);
  };

  const handleSave = async () => {
    if (!activeOrg || !user || !form.code.trim() || !form.discountValue) return;
    setSaving(true);

    const payload = {
      org_id: activeOrg.id,
      user_id: user.id,
      code: form.code.trim().toUpperCase(),
      discount_percent: form.discountType === "percent" ? Number(form.discountValue) : 0,
      discount_fixed_ars: form.discountType === "fixed" ? Number(form.discountValue) : 0,
      max_uses: form.maxUses ? Number(form.maxUses) : null,
      valid_until: form.validUntil || null,
      active: form.active,
    };

    const { error } = await supabase.from("coupons").insert(payload);
    if (error) {
      if (error.code === "23505") {
        toast.error("Ya existe un cupón con ese código");
      } else {
        toast.error("Error al crear cupón");
      }
    } else {
      toast.success(`Cupón ${payload.code} creado`);
      setDialog(false);
      load();
    }
    setSaving(false);
  };

  const toggleActive = async (c: Coupon) => {
    await supabase.from("coupons").update({ active: !c.active }).eq("id", c.id);
    setCoupons(prev => prev.map(p => p.id === c.id ? { ...p, active: !p.active, status: getCouponStatus({ ...p, active: !p.active }) } : p));
    toast.success(c.active ? "Cupón desactivado" : "Cupón activado");
  };

  const deleteCoupon = async (id: string, code: string) => {
    if (!confirm(`¿Eliminar cupón ${code}?`)) return;
    await supabase.from("coupons").delete().eq("id", id);
    setCoupons(prev => prev.filter(c => c.id !== id));
    toast.success("Cupón eliminado");
  };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(`Código "${code}" copiado`);
  };

  return (
    <div>
      <PageHeader
        icon={Tag}
        title="Cupones & Descuentos"
        description="Creá y gestioná códigos de descuento para tus clientes"
        actions={
          <Button size="sm" className="gap-1.5 gradient-gold text-primary-foreground" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" /> Nuevo Cupón
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard title="Cupones activos" value={String(kpis.active)} icon={Tag} trend={`${coupons.length} total`} trendUp={kpis.active > 0} />
        <KPICard title="Usos totales" value={String(kpis.totalUses)} icon={BarChart3} trend="Veces canjeados" trendUp={kpis.totalUses > 0} />
        <KPICard title="Revenue con cupones" value={formatARS(kpis.totalRevenue)} icon={DollarSign} trend="Ventas con código aplicado" trendUp={kpis.totalRevenue > 0} />
        <KPICard title="Vencidos/Agotados" value={String(kpis.expired)} icon={AlertTriangle} trend="Ya no son canjeables" trendUp={kpis.expired === 0} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Cargando cupones…
        </div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-20">
          <Tag className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-muted-foreground">Sin cupones creados todavía</p>
          <Button size="sm" className="mt-4 gradient-gold text-primary-foreground" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Crear primer cupón
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map(c => {
            const stCfg = STATUS_CONFIG[c.status];
            const usagePct = c.max_uses ? Math.min((c.current_uses / c.max_uses) * 100, 100) : 0;
            return (
              <div
                key={c.id}
                className={`bg-[hsl(228_24%_7%)] border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition-colors ${
                  c.status === "active" ? "border-border/60" : "border-border/30 opacity-70"
                }`}
              >
                {/* Code + discount */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`px-3 py-1.5 rounded-lg border font-mono text-sm font-bold tracking-wider ${stCfg.bg} ${stCfg.border} ${stCfg.color}`}>
                    {c.code}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{formatDiscount(c)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className={`text-[9px] ${stCfg.color} ${stCfg.border}`}>
                        {stCfg.label}
                      </Badge>
                      {c.valid_until && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />
                          Vence {new Date(c.valid_until).toLocaleDateString("es-AR")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Usage stats */}
                <div className="flex items-center gap-6 sm:gap-8 shrink-0">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Usos</p>
                    <p className="text-sm font-bold">{c.current_uses}{c.max_uses ? `/${c.max_uses}` : ""}</p>
                    {c.max_uses && (
                      <div className="w-16 h-1 bg-border/40 rounded-full mt-1 overflow-hidden">
                        <div className={`h-full rounded-full ${usagePct >= 100 ? "bg-red-500" : "bg-primary"}`} style={{ width: `${usagePct}%` }} />
                      </div>
                    )}
                  </div>
                  {(c.usageRevenue || 0) > 0 && (
                    <div className="text-center hidden md:block">
                      <p className="text-xs text-muted-foreground">Revenue</p>
                      <p className="text-sm font-bold text-emerald-400">{formatARS(c.usageRevenue || 0)}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    title="Copiar código"
                    onClick={() => copyCode(c.code, c.id)}
                  >
                    {copiedId === c.id ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <button
                    onClick={() => toggleActive(c)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${c.active ? "bg-primary" : "bg-border/60"}`}
                    title={c.active ? "Desactivar" : "Activar"}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${c.active ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => deleteCoupon(c.id, c.code)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Create Dialog ─────────────────────────────────────────── */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" /> Nuevo Cupón de Descuento
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Code */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Código</label>
              <div className="flex gap-2">
                <Input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="DESCUENTO20"
                  className="font-mono uppercase"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setForm(f => ({ ...f, code: generateCode() }))}
                >
                  Generar
                </Button>
              </div>
            </div>

            {/* Discount type + value */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de descuento</label>
              <div className="flex gap-2">
                <Select value={form.discountType} onValueChange={v => setForm(f => ({ ...f, discountType: v as "percent" | "fixed" }))}>
                  <SelectTrigger className="w-32 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">% Porcentaje</SelectItem>
                    <SelectItem value="fixed">$ Monto fijo</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative flex-1">
                  <Input
                    type="number"
                    placeholder={form.discountType === "percent" ? "20" : "5000"}
                    value={form.discountValue}
                    onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    {form.discountType === "percent" ? "%" : "ARS"}
                  </span>
                </div>
              </div>
            </div>

            {/* Max uses */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Usos máximos (vacío = ilimitado)</label>
              <Input
                type="number"
                placeholder="Ilimitado"
                value={form.maxUses}
                onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}
              />
            </div>

            {/* Valid until */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Válido hasta (vacío = sin vencimiento)</label>
              <Input
                type="date"
                value={form.validUntil}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between">
              <label className="text-sm">Activo inmediatamente</label>
              <button
                onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.active ? "bg-primary" : "bg-border/60"}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.active ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            {/* Preview */}
            {form.code && form.discountValue && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs">
                <p className="font-semibold text-primary mb-0.5">Vista previa:</p>
                <p>Código <span className="font-mono font-bold">{form.code}</span> → {form.discountType === "percent" ? `${form.discountValue}% de descuento` : `${formatARS(Number(form.discountValue))} de descuento`}</p>
                {form.maxUses && <p className="text-muted-foreground mt-0.5">Máx {form.maxUses} uso{Number(form.maxUses) !== 1 ? "s" : ""}</p>}
                {form.validUntil && <p className="text-muted-foreground">Hasta {new Date(form.validUntil).toLocaleDateString("es-AR")}</p>}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setDialog(false)}>Cancelar</Button>
              <Button
                className="flex-1 gradient-gold text-primary-foreground"
                disabled={saving || !form.code.trim() || !form.discountValue}
                onClick={handleSave}
              >
                {saving ? "Guardando…" : "Crear Cupón"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
