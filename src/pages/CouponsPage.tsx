/**
 * CouponsPage — /cupones
 *
 * Create, manage and track promotional discount codes.
 * Reads from the `coupons` table and `sales` table for usage analytics.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  Tag, Plus, Trash2, Copy, CheckCircle2, XCircle,
  RefreshCw, Percent, DollarSign, BarChart3, AlertTriangle,
  Clock, Infinity as InfinityIcon, Zap, ArrowRight,
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
  free_shipping: boolean;
  free_shipping_max_ars: number | null;
  max_uses: number | null;
  current_uses: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
  // Computed
  usageRevenue?: number;
  usageDiscount?: number;
  usageCount?: number;
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
  // Un cupón puede descontar mercadería, bonificar el envío, o las dos cosas.
  const partes: string[] = [];
  if (c.discount_percent > 0) partes.push(`${c.discount_percent}% OFF`);
  else if (c.discount_fixed_ars > 0) partes.push(`${formatARS(c.discount_fixed_ars)} OFF`);
  if (c.free_shipping) {
    partes.push(c.free_shipping_max_ars
      ? `Envío hasta ${formatARS(c.free_shipping_max_ars)}`
      : "Envío gratis");
  }
  return partes.length > 0 ? partes.join(" + ") : "—";
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
  minOrderValue: "",
  maxPorPersona: "",
  // A5: el cupón más usado del comercio argentino. Puede ir solo o sumado a un
  // descuento de mercadería.
  freeShipping: false,
  topeEnvio: "",
  validUntil: "",
  active: true,
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CouponsPage() {
  usePageTitle("Cupones & Descuentos");
  const { activeOrg } = useOrg();
  const { user } = useAuth();

  const { ask, dialog } = useConfirmDialog();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // code (uppercased) -> matching promotion, for the cross-link with /promociones
  const [promoByCode, setPromoByCode] = useState<Record<string, { id: string; name: string; status: string }>>({});

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);

    const [couponsRes, salesRes, promosRes] = await Promise.all([
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
      supabase
        .from("promotions")
        .select("id, name, status, coupon_code")
        .eq("org_id", activeOrg.id)
        .not("coupon_code", "is", null),
    ]);

    const promoMap: Record<string, { id: string; name: string; status: string }> = {};
    (promosRes.data || []).forEach((p: any) => {
      if (p.coupon_code) promoMap[p.coupon_code.toUpperCase()] = { id: p.id, name: p.name, status: p.status };
    });
    setPromoByCode(promoMap);

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
        usageCount: usage.count,
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
    setFormOpen(true);
  };

  const handleSave = async () => {
    // Un cupón de envío gratis no lleva porcentaje ni monto: el descuento es el
    // flete. Exigir un valor ahí haría imposible cargarlo.
    if (!activeOrg || !user || !form.code.trim()) return;
    if (!form.discountValue && !form.freeShipping) return;
    setSaving(true);

    const payload = {
      org_id: activeOrg.id,
      user_id: user.id,
      code: form.code.trim().toUpperCase(),
      discount_percent: form.discountType === "percent" ? Number(form.discountValue) : 0,
      discount_fixed_ars: form.discountType === "fixed" ? Number(form.discountValue) : 0,
      max_uses: form.maxUses ? Number(form.maxUses) : null,
      // Vacío = sin condición. Un 0 significaría "mínimo cero", que es lo mismo
      // que no tener mínimo pero se lee distinto en la tabla.
      min_order_value: form.minOrderValue ? Number(form.minOrderValue) : null,
      max_uses_per_customer: form.maxPorPersona ? Number(form.maxPorPersona) : null,
      free_shipping: form.freeShipping,
      // Vacío = se bonifica el envío entero.
      free_shipping_max_ars: form.freeShipping && form.topeEnvio ? Number(form.topeEnvio) : null,
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
      setFormOpen(false);
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
    if (!(await ask({ title: `¿Eliminar cupón ${code}?`, confirmText: "Eliminar", variant: "destructive" }))) return;
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
    <div className="space-y-6 pb-12">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Cupones activos" value={String(kpis.active)} icon={Tag} sub={`${coupons.length} total`} />
        <KPICard label="Usos totales" value={String(kpis.totalUses)} icon={BarChart3} sub="Veces canjeados" />
        <KPICard label="Revenue con cupones" value={formatARS(kpis.totalRevenue)} icon={DollarSign} sub="Ventas con código aplicado" color="success" />
        <KPICard label="Vencidos/Agotados" value={String(kpis.expired)} icon={AlertTriangle} sub="Ya no son canjeables" color="warning" />
      </div>

      {/* Cross-link banner to Promociones */}
      <Link
        to="/promociones"
        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-muted/20 hover:border-primary/40 hover:bg-primary/5 transition-colors group"
      >
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">¿Buscás crear una campaña con este cupón?</p>
          <p className="text-xs text-muted-foreground">Las promociones agrupan cupones en ofertas con vigencia, banner y cuenta regresiva.</p>
        </div>
        <span className="text-xs text-primary font-medium flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          Ir a Promociones <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </Link>

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
        <div className="space-y-3 pb-12">
          {coupons.map(c => {
            const stCfg = STATUS_CONFIG[c.status];
            const usagePct = c.max_uses ? Math.min((c.current_uses / c.max_uses) * 100, 100) : 0;
            const linkedPromo = promoByCode[c.code?.toUpperCase()];
            return (
              <div
                key={c.id}
                className={`bg-card border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition-colors ${
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
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {(c.usageCount || 0) > 0
                        ? <>Ventas atribuidas: <span className="font-semibold text-foreground">{c.usageCount}</span> · Ingresos: <span className="font-semibold text-emerald-400">{formatARS(c.usageRevenue || 0)}</span></>
                        : <span className="opacity-60">Sin ventas atribuidas todavía</span>}
                    </p>
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
                      {linkedPromo && (
                        <Link
                          to="/promociones"
                          className="text-[10px] text-primary hover:underline flex items-center gap-0.5 font-medium"
                          title={`Parte de la promoción "${linkedPromo.name}"`}
                        >
                          <Zap className="w-3 h-3" />Ver en Promociones
                        </Link>
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
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
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

            {/* Envío gratis — A5. Es el cupón más usado del comercio argentino:
                el envío es de las primeras razones por las que se abandona un
                carrito. Puede ir solo o sumado al descuento de arriba. */}
            <div className="rounded-xl border border-border/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm">Bonifica el envío</label>
                  <p className="text-[10px] text-muted-foreground">
                    El comprador ve “Gratis” y el costo lo absorbe el negocio.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, freeShipping: !f.freeShipping }))}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${form.freeShipping ? "bg-primary" : "bg-border/60"}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.freeShipping ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>

              {form.freeShipping && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    Bonificar hasta (vacío = el envío completo)
                  </label>
                  <Input
                    type="number"
                    placeholder="Sin tope"
                    value={form.topeEnvio}
                    onChange={e => setForm(f => ({ ...f, topeEnvio: e.target.value }))}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Un envío a Tierra del Fuego puede costar más que la venta. Con
                    tope, el comprador paga la diferencia.
                  </p>
                </div>
              )}
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

            {/* Compra mínima — sin esto, un cupón de $10.000 fijo se usa en una
                compra de $12.000 y el comercio regala el 83% de la venta. */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Compra mínima (vacío = sin mínimo)
              </label>
              <Input
                type="number"
                placeholder="Sin mínimo"
                value={form.minOrderValue}
                onChange={e => setForm(f => ({ ...f, minOrderValue: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se mide sobre los productos, sin contar el envío.
              </p>
            </div>

            {/* Límite por persona — sin esto, uno solo consume todos los usos. */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Usos por persona (vacío = sin límite)
              </label>
              <Input
                type="number"
                placeholder="Sin límite"
                value={form.maxPorPersona}
                onChange={e => setForm(f => ({ ...f, maxPorPersona: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se identifica por email. Con esto puesto, el comprador tiene que
                cargarlo antes de aplicar el cupón.
              </p>
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
            {form.code && (form.discountValue || form.freeShipping) && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs">
                <p className="font-semibold text-primary mb-0.5">Vista previa:</p>
                <p>
                  Código <span className="font-mono font-bold">{form.code}</span> →{" "}
                  {[
                    form.discountValue && (form.discountType === "percent"
                      ? `${form.discountValue}% de descuento`
                      : `${formatARS(Number(form.discountValue))} de descuento`),
                    form.freeShipping && (form.topeEnvio
                      ? `envío bonificado hasta ${formatARS(Number(form.topeEnvio))}`
                      : "envío gratis"),
                  ].filter(Boolean).join(" + ")}
                </p>
                {form.maxUses && <p className="text-muted-foreground mt-0.5">Máx {form.maxUses} uso{Number(form.maxUses) !== 1 ? "s" : ""}</p>}
                {form.validUntil && <p className="text-muted-foreground">Hasta {new Date(form.validUntil).toLocaleDateString("es-AR")}</p>}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setFormOpen(false)}>Cancelar</Button>
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
      {dialog}
    </div>
  );
}
