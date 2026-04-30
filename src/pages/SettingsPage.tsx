import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useEntitlements } from "@/lib/useEntitlements";
import { getSettingsDB, saveSettingsDB, getProductsDB, formatARS, calculateProductProfits, getCouponsDB, addCouponDB, updateCouponDB, deleteCouponDB, getSalesDB, getPurchasesDB, getDebtsDB, getExpensesDB, getCustomerNotesDB, buildExpenseCategories } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { RefreshCw, Database, Shield, Receipt, Palette, Building2, Upload, Keyboard, RotateCcw, CreditCard, MessageCircle, ShoppingBag, Droplets, Ticket, Plus, Trash2, FileSpreadsheet, FileJson, Download, Bell, DollarSign, Tags, Cloud, Zap, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { ColorPicker } from "@/components/shared/ColorPicker";
import { applyColors } from "@/lib/useBusinessConfig";
import { logAudit } from "@/lib/auditLog";
import { FormSkeleton } from "@/components/shared/PageSkeleton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function SettingsPage() {
  const { user, session } = useAuth();
  const [exchangeRate, setExchangeRate] = useState('');
  const [customsPercent, setCustomsPercent] = useState('');
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxIva, setTaxIva] = useState('21');
  const [taxIibb, setTaxIibb] = useState('3.5');
  const [taxMonotributo, setTaxMonotributo] = useState('0');
  const [productCount, setProductCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [businessName, setBusinessName] = useState('Exentry Imports');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4A843');
  const [secondaryColor, setSecondaryColor] = useState('#1A1A2E');
  const [uploading, setUploading] = useState(false);

  // Payment method discounts
  const [discountCash, setDiscountCash] = useState('10');
  const [discountTransfer, setDiscountTransfer] = useState('5');
  const [discountDebit, setDiscountDebit] = useState('0');
  const [discountCredit, setDiscountCredit] = useState('0');
  const [whatsappNumber, setWhatsappNumber] = useState('');

  // Volume / wholesale discount
  const [volumeThreshold, setVolumeThreshold] = useState('3');
  const [volumeDiscount, setVolumeDiscount] = useState('10');

  // Decant margins
  const [decantMargin10, setDecantMargin10] = useState('250');
  const [decantMargin5, setDecantMargin5] = useState('350');
  const [decantMargin2_5, setDecantMargin2_5] = useState('500');

  // Track original values for auto-recalculate prompt
  const [origRate, setOrigRate] = useState('');
  const [origCustoms, setOrigCustoms] = useState('');
  const [origDiscount, setOrigDiscount] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s: any = await getSettingsDB(user.id);
      setExchangeRate(String(s.exchange_rate));
      setCustomsPercent(String(s.customs_percent));
      setDefaultDiscountPercent(String(s.default_discount_percent));
      setTaxEnabled(!!s.tax_enabled);
      setTaxIva(String(s.tax_iva_percent ?? 21));
      setTaxIibb(String(s.tax_iibb_percent ?? 3.5));
      setTaxMonotributo(String(s.tax_monotributo_monthly ?? 0));
      setBusinessName(s.business_name || 'Exentry Imports');
      setLogoUrl(s.logo_url || '');
      setPrimaryColor(s.primary_color || '#D4A843');
      setSecondaryColor(s.secondary_color || '#1A1A2E');
      setDiscountCash(String(s.discount_cash_percent ?? 10));
      setDiscountTransfer(String(s.discount_transfer_percent ?? 5));
      setDiscountDebit(String(s.discount_debit_percent ?? 0));
      setDiscountCredit(String(s.discount_credit_percent ?? 0));
      setWhatsappNumber(s.whatsapp_number || '');
      setVolumeThreshold(String(s.volume_discount_threshold ?? 3));
      setVolumeDiscount(String(s.volume_discount_percent ?? 10));
      setDecantMargin10(String(s.decant_margin_10ml ?? 250));
      setDecantMargin5(String(s.decant_margin_5ml ?? 350));
      setDecantMargin2_5(String(s.decant_margin_2_5ml ?? 500));
      setOrigRate(String(s.exchange_rate));
      setOrigCustoms(String(s.customs_percent));
      setOrigDiscount(String(s.default_discount_percent));
      const products = await getProductsDB(user.id);
      setProductCount(products.length);
      setLoading(false);
    })();
  }, [user]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/logo.${ext}`;
      const { error } = await supabase.storage.from('marketing-images').upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('marketing-images').getPublicUrl(path);
      setLogoUrl(urlData.publicUrl);
      toast.success("Logo subido correctamente");
    } catch (err: any) {
      toast.error("Error al subir logo: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveSettingsDB(user.id, {
        exchange_rate: parseFloat(exchangeRate) || 1695,
        customs_percent: parseFloat(customsPercent) || 15,
        default_discount_percent: parseFloat(defaultDiscountPercent) || 20,
        tax_enabled: taxEnabled,
        tax_iva_percent: parseFloat(taxIva) || 21,
        tax_iibb_percent: parseFloat(taxIibb) || 3.5,
        tax_monotributo_monthly: parseFloat(taxMonotributo) || 0,
        business_name: businessName || 'Exentry Imports',
        logo_url: logoUrl || null,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        discount_cash_percent: parseFloat(discountCash) || 0,
        discount_transfer_percent: parseFloat(discountTransfer) || 0,
        discount_debit_percent: parseFloat(discountDebit) || 0,
        discount_credit_percent: parseFloat(discountCredit) || 0,
        whatsapp_number: whatsappNumber || null,
        volume_discount_threshold: parseInt(volumeThreshold) || 3,
        volume_discount_percent: parseFloat(volumeDiscount) || 10,
        decant_margin_10ml: parseFloat(decantMargin10) || 250,
        decant_margin_5ml: parseFloat(decantMargin5) || 350,
        decant_margin_2_5ml: parseFloat(decantMargin2_5) || 500,
      });
      await logAudit(user.id, 'settings_change', 'settings', undefined, { exchangeRate, customsPercent, businessName, taxEnabled });
      toast.success("Configuración guardada correctamente");

      // Check if pricing-related settings changed → prompt recalculate
      if (exchangeRate !== origRate || customsPercent !== origCustoms || defaultDiscountPercent !== origDiscount) {
        toast("Los parámetros financieros cambiaron", {
          description: "¿Recalcular todos los precios de productos?",
          action: { label: "Recalcular", onClick: () => handleRecalculate() },
          duration: 10000,
        });
      }
      setOrigRate(exchangeRate);
      setOrigCustoms(customsPercent);
      setOrigDiscount(defaultDiscountPercent);
    } catch (err: any) {
      toast.error("Error al guardar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    if (!user) return;
    const products = await getProductsDB(user.id);
    const rate = parseFloat(exchangeRate) || 1695;
    const customs = parseFloat(customsPercent) || 15;
    const discPct = parseFloat(defaultDiscountPercent) || 40;
    let count = 0;
    for (const p of products) {
      if (Number(p.cost_usd) <= 0) continue;
      const costUsd = Number(p.cost_usd);
      // Auto-calculate sale price: (cost + pasero) * TC * 2
      const newSalePrice = Math.round((costUsd + costUsd * customs / 100) * rate * 2);
      // Auto-calculate discount price
      const newDiscountPrice = Math.round(newSalePrice * (1 - discPct / 100));
      const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
        costUsd, customs, newSalePrice, rate
      );
      await supabase.from('products').update({
        customs_fee: customsFee, total_cost_usd: totalCostUSD,
        sale_price_ars: newSalePrice,
        discount_price_ars: newDiscountPrice,
        profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
      }).eq('id', p.id);
      count++;
    }
    setProductCount(count);
    toast.success(`${count} productos recalculados con TC $${rate}, pasero ${customs}%, desc. ${discPct}%`);
  };

  if (loading) return (
    <div>
      <h1 className="text-2xl md:text-3xl font-display font-bold mb-1">Ajustes</h1>
      <p className="text-muted-foreground mb-6 md:mb-8">Cargando configuración...</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><FormSkeleton /><FormSkeleton /></div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl md:text-3xl font-display font-bold">Ajustes</h1>
        <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
          <Keyboard className="w-3 h-3" />Ctrl+K búsqueda rápida
        </div>
      </div>
      <p className="text-muted-foreground mb-6 md:mb-8">Configuración general de {businessName}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="space-y-4 md:space-y-6">
          {/* Brand */}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />Marca del Negocio
            </h2>
            <div>
              <label className="text-sm text-muted-foreground">Nombre del Negocio</label>
              <Input value={businessName} onChange={e => setBusinessName(e.target.value)} className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Logo</label>
              <div className="flex items-center gap-3 mt-1">
                {logoUrl && <img src={logoUrl} alt="Logo" className="w-12 h-12 rounded-lg object-cover border border-border" />}
                <label className="flex items-center gap-2 px-3 py-2 bg-muted border border-border rounded-lg cursor-pointer hover:bg-accent text-sm transition-colors">
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Subiendo...' : 'Subir logo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ColorPicker label="Color Principal" value={primaryColor} onChange={(c) => { setPrimaryColor(c); applyColors(c, secondaryColor); }} />
              <ColorPicker label="Color Secundario" value={secondaryColor} onChange={(c) => { setSecondaryColor(c); applyColors(primaryColor, c); }} />
            </div>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setPrimaryColor('#D4A843'); setSecondaryColor('#1A1A2E'); applyColors('#D4A843', '#1A1A2E'); }}>
              <RotateCcw className="w-3 h-3 mr-1" />Restaurar colores originales
            </Button>
            <div>
              <label className="text-sm text-muted-foreground flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" />WhatsApp (catálogo público)</label>
              <Input value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)} placeholder="+5491112345678" className="bg-muted border-border mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">Número con código de país. Aparecerá como botón flotante en tu catálogo público.</p>
            </div>
          </div>

          {/* Financial params */}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-4 md:space-y-5">
            <h2 className="font-display font-semibold text-lg flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" />Parámetros Financieros
            </h2>
            <div>
              <label className="text-sm text-muted-foreground">Tipo de Cambio (USD → ARS)</label>
              <Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Porcentaje del Pasero (%)</label>
              <Input type="number" value={customsPercent} onChange={e => setCustomsPercent(e.target.value)} className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Descuento por Defecto (%)</label>
              <Input type="number" value={defaultDiscountPercent} onChange={e => setDefaultDiscountPercent(e.target.value)} className="bg-muted border-border mt-1" />
              <p className="text-[10px] text-muted-foreground mt-1">Se aplica al calcular precio c/descuento: Venta × (1 - {defaultDiscountPercent}%)</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold shadow-gold flex-1">
                {saving ? 'Guardando...' : 'Guardar Configuración'}
              </Button>
              <Button variant="outline" onClick={handleRecalculate}><RefreshCw className="w-4 h-4 mr-2" />Recalcular Todo</Button>
            </div>
          </div>

          {/* Payment method discounts */}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />Descuentos por Medio de Pago
            </h2>
            <p className="text-xs text-muted-foreground">Estos descuentos se aplican sobre el precio de venta al registrar una venta. Efectivo y transferencia usan el precio c/descuento del producto.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-muted-foreground">Efectivo (%)</label>
                <Input type="number" step="0.1" value={discountCash} onChange={e => setDiscountCash(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Transferencia (%)</label>
                <Input type="number" step="0.1" value={discountTransfer} onChange={e => setDiscountTransfer(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Débito (%)</label>
                <Input type="number" step="0.1" value={discountDebit} onChange={e => setDiscountDebit(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Crédito (%)</label>
                <Input type="number" step="0.1" value={discountCredit} onChange={e => setDiscountCredit(e.target.value)} className="bg-muted border-border mt-1" /></div>
            </div>
          </div>

          {/* Volume / Wholesale discount */}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-primary" />Descuento Mayorista
            </h2>
            <p className="text-xs text-muted-foreground">Se aplica sobre el precio efectivo/con descuento cuando el cliente lleva X+ unidades. Piso de rentabilidad: costo + 20%.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-muted-foreground">Cantidad mínima</label>
                <Input type="number" min="2" value={volumeThreshold} onChange={e => setVolumeThreshold(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">Descuento (%)</label>
                <Input type="number" step="0.5" value={volumeDiscount} onChange={e => setVolumeDiscount(e.target.value)} className="bg-muted border-border mt-1" /></div>
            </div>
          </div>

          {/* Decant margins */}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-4">
            <h2 className="font-display font-semibold text-lg flex items-center gap-2">
              <Droplets className="w-4 h-4 text-primary" />Márgenes de Decants
            </h2>
            <p className="text-xs text-muted-foreground">Margen (%) sobre el costo proporcional por ml. El precio se calcula: (costo/ml × tamaño) × TC × (1 + margen%).</p>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-sm text-muted-foreground">10ml (%)</label>
                <Input type="number" value={decantMargin10} onChange={e => setDecantMargin10(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">5ml (%)</label>
                <Input type="number" value={decantMargin5} onChange={e => setDecantMargin5(e.target.value)} className="bg-muted border-border mt-1" /></div>
              <div><label className="text-sm text-muted-foreground">2.5ml (%)</label>
                <Input type="number" value={decantMargin2_5} onChange={e => setDecantMargin2_5(e.target.value)} className="bg-muted border-border mt-1" /></div>
            </div>
          </div>
        </div>

        <div className="space-y-4 md:space-y-6">
          {/* Subscription */}
          <SubscriptionPanel session={session} />

          {/* Taxes */}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-lg flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />Impuestos (Argentina)</h2>
              <Switch checked={taxEnabled} onCheckedChange={setTaxEnabled} />
            </div>
            {taxEnabled ? (
              <div className="space-y-3">
                <div><label className="text-sm text-muted-foreground">IVA (%)</label><Input type="number" step="0.1" value={taxIva} onChange={e => setTaxIva(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Ingresos Brutos (%)</label><Input type="number" step="0.1" value={taxIibb} onChange={e => setTaxIibb(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Monotributo mensual (ARS)</label><Input type="number" value={taxMonotributo} onChange={e => setTaxMonotributo(e.target.value)} className="bg-muted border-border mt-1" /></div>
                <p className="text-xs text-muted-foreground">Los impuestos se descontarán de la ganancia bruta en reportes y dashboard.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Activá esta opción para descontar impuestos de tus ganancias.</p>
            )}
          </div>

          {/* System info */}
          <div className="bg-card border border-border rounded-lg p-4 md:p-6">
            <h2 className="font-display font-semibold text-lg mb-3 flex items-center gap-2"><Database className="w-4 h-4 text-primary" />Sistema</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Negocio:</span><span className="font-medium">{businessName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Productos:</span><span className="font-medium">{productCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Almacenamiento:</span><span className="font-medium text-success">Cloud ☁️</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auth:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IA:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auditoría:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Versión:</span><span className="font-medium">7.5</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Usuario:</span><span className="font-medium text-xs truncate max-w-[150px]">{user?.email}</span></div>
            </div>
          </div>

          <div className="bg-card border border-success/30 rounded-lg p-4 md:p-6">
            <h2 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />Seguridad
            </h2>
            <p className="text-sm text-muted-foreground">
              Datos protegidos con autenticación, cifrado y auditoría. Cada usuario solo ve sus propios datos. Sistema multi-tenant con aislamiento completo.
            </p>
          </div>

          {/* USD Real-time Quote */}
          <USDQuoteSection userId={user!.id} onApply={(rate) => setExchangeRate(String(rate))} />

          {/* Thresholds & Alerts */}
          <ThresholdsSection userId={user!.id} />

          {/* Expense Categories CRUD */}
          <ExpenseCategoriesSection userId={user!.id} />

          {/* Backup / Export */}
          <BackupExport userId={user!.id} />

          {/* Cloud Backups */}
          <CloudBackupsSection userId={user!.id} />

          {/* Coupons CRUD */}
          <CouponsManager userId={user!.id} />
        </div>
      </div>
    </div>
  );
}

// ===== Subscription Panel =====
function SubscriptionPanel({ session }: { session: any }) {
  const { activeOrg } = useOrg();
  const { plan, subscription, isTrialing, trialDaysLeft, loading, refresh } = useEntitlements();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      toast.success('¡Suscripción activada! Gracias por confiar en Gestiona.');
      refresh();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleUpgrade = async (planCode: string) => {
    if (!activeOrg || !session) return;
    setCheckingOut(planCode);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { planCode, orgId: activeOrg.id, yearly: false },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || !data?.url) { toast.error('No se pudo iniciar el pago.'); return; }
      window.location.href = data.url;
    } catch { toast.error('Error al conectar con pagos.'); }
    finally { setCheckingOut(null); }
  };

  const handleCancel = async () => {
    if (!subscription?.stripe_subscription_id) return;
    setCanceling(true);
    try {
      const { error } = await supabase.functions.invoke('cancel-subscription', {
        body: { subscriptionId: subscription.stripe_subscription_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      toast.success('Suscripción cancelada. Seguirás teniendo acceso hasta el fin del período.');
      await refresh();
    } catch { toast.error('Error al cancelar.'); }
    finally { setCanceling(false); }
  };

  const statusColor = {
    active: 'text-green-500',
    trialing: 'text-blue-500',
    past_due: 'text-yellow-500',
    canceled: 'text-red-500',
    paused: 'text-muted-foreground',
  }[subscription?.status ?? 'canceled'] ?? 'text-muted-foreground';

  const StatusIcon = subscription?.status === 'active' ? CheckCircle2
    : subscription?.status === 'trialing' ? Zap
    : subscription?.status === 'past_due' ? AlertTriangle
    : XCircle;

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-4">
      <h2 className="font-display font-semibold text-lg flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-primary" />Suscripción
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{plan?.name ?? 'Sin plan'}</p>
              <div className={`flex items-center gap-1.5 text-sm mt-0.5 ${statusColor}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                <span>
                  {subscription?.status === 'trialing' ? `Trial — ${trialDaysLeft} días restantes`
                    : subscription?.status === 'active' ? 'Activo'
                    : subscription?.status === 'past_due' ? 'Pago pendiente'
                    : subscription?.status === 'canceled' ? 'Cancelado'
                    : 'Sin suscripción'}
                </span>
              </div>
              {subscription?.current_period_end && subscription.status !== 'canceled' && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Próximo cobro: {new Date(subscription.current_period_end).toLocaleDateString('es-AR')}
                </p>
              )}
            </div>
            <div className="text-right">
              {plan && plan.price_usd_monthly > 0 && (
                <p className="text-2xl font-bold">${plan.price_usd_monthly}<span className="text-sm font-normal text-muted-foreground">/mes</span></p>
              )}
            </div>
          </div>

          {/* Plan limits */}
          {plan && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Productos', val: plan.max_products ?? '∞' },
                { label: 'Usuarios', val: plan.max_users ?? '∞' },
                { label: 'IA', val: plan.ai_enabled ? 'Sí' : 'No' },
              ].map(item => (
                <div key={item.label} className="bg-muted rounded-lg p-2">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="font-semibold text-sm">{String(item.val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {(!subscription || subscription.status === 'canceled' || subscription.status === 'trialing') && (
              <Button onClick={() => handleUpgrade('pro')} disabled={!!checkingOut} className="w-full gradient-gold text-primary-foreground font-semibold">
                {checkingOut === 'pro' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirigiendo...</> : <><Zap className="w-4 h-4 mr-2" />Actualizar al plan Pro</>}
              </Button>
            )}
            {subscription?.status === 'active' && !subscription.cancel_at_period_end && (
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleCancel} disabled={canceling}>
                {canceling ? 'Cancelando...' : 'Cancelar suscripción'}
              </Button>
            )}
            {subscription?.cancel_at_period_end && (
              <p className="text-xs text-yellow-500 text-center">Cancelación programada al fin del período</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ===== USD Real-time Quote =====
function USDQuoteSection({ userId, onApply }: { userId: string; onApply: (rate: number) => void }) {
  const [loading, setLoading] = useState(false);
  const [rates, setRates] = useState<{ oficial?: number; blue?: number; mep?: number; updated?: string }>({});

  useEffect(() => {
    (async () => {
      const s: any = await getSettingsDB(userId);
      setRates({
        oficial: s.usd_rate_oficial ? Number(s.usd_rate_oficial) : undefined,
        blue: s.usd_rate_blue ? Number(s.usd_rate_blue) : undefined,
        mep: s.usd_rate_mep ? Number(s.usd_rate_mep) : undefined,
        updated: s.usd_rate_updated_at,
      });
    })();
  }, [userId]);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-usd-rate', { body: { user_id: userId } });
      if (error) throw error;
      setRates({ oficial: data?.oficial, blue: data?.blue, mep: data?.mep, updated: new Date().toISOString() });
      toast.success('Cotizaciones actualizadas');
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-3">
      <h2 className="font-display font-semibold text-lg flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-primary" />Cotización USD (tiempo real)
      </h2>
      <p className="text-xs text-muted-foreground">Datos públicos de mercado. Aplicá la cotización que usás operativamente.</p>
      <div className="grid grid-cols-3 gap-2">
        {(['oficial', 'blue', 'mep'] as const).map(k => (
          <button
            key={k}
            disabled={!rates[k]}
            onClick={() => rates[k] && onApply(rates[k]!)}
            className="bg-muted border border-border rounded-lg p-2.5 hover:border-primary/50 transition-colors disabled:opacity-50 text-left"
          >
            <p className="text-[10px] uppercase text-muted-foreground">{k}</p>
            <p className="text-sm font-bold">{rates[k] ? `$${rates[k]!.toLocaleString('es-AR')}` : '—'}</p>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">{rates.updated ? `Última: ${new Date(rates.updated).toLocaleString('es-AR')}` : 'Sin datos'}</p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Actualizar
        </Button>
      </div>
    </div>
  );
}

// ===== Thresholds / Alerts =====
function ThresholdsSection({ userId }: { userId: string }) {
  const [s, setS] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => setS(await getSettingsDB(userId)))(); }, [userId]);

  if (!s) return null;

  const update = (k: string, v: any) => setS({ ...s, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      await saveSettingsDB(userId, {
        initial_cash_ars: Number(s.initial_cash_ars) || 0,
        low_stock_threshold: parseInt(s.low_stock_threshold) || 3,
        large_sale_threshold_ars: Number(s.large_sale_threshold_ars) || 50000,
        margin_alert_percent: Number(s.margin_alert_percent) || 30,
        expense_ratio_alert_percent: Number(s.expense_ratio_alert_percent) || 40,
        overdue_check_window_hours: parseInt(s.overdue_check_window_hours) || 24,
        cash_flow_warning_threshold_ars: Number(s.cash_flow_warning_threshold_ars) || 0,
      });
      toast.success('Umbrales guardados');
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-3">
      <h2 className="font-display font-semibold text-lg flex items-center gap-2">
        <Bell className="w-4 h-4 text-primary" />Umbrales y Alertas
      </h2>
      <p className="text-xs text-muted-foreground">Configurables. Los triggers de notificaciones (stock bajo, ventas grandes, deudas vencidas) usan estos valores.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-muted-foreground">Caja inicial (ARS)</label>
          <Input type="number" value={s.initial_cash_ars ?? 0} onChange={e => update('initial_cash_ars', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Stock bajo (≤)</label>
          <Input type="number" value={s.low_stock_threshold ?? 3} onChange={e => update('low_stock_threshold', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Venta grande ≥ (ARS)</label>
          <Input type="number" value={s.large_sale_threshold_ars ?? 50000} onChange={e => update('large_sale_threshold_ars', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Margen mínimo (%)</label>
          <Input type="number" value={s.margin_alert_percent ?? 30} onChange={e => update('margin_alert_percent', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Ratio gastos/ventas alerta (%)</label>
          <Input type="number" value={s.expense_ratio_alert_percent ?? 40} onChange={e => update('expense_ratio_alert_percent', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div><label className="text-xs text-muted-foreground">Ventana deuda vencida (h)</label>
          <Input type="number" value={s.overdue_check_window_hours ?? 24} onChange={e => update('overdue_check_window_hours', e.target.value)} className="bg-muted border-border mt-1" /></div>
        <div className="col-span-2"><label className="text-xs text-muted-foreground">Aviso flujo caja (ARS mín. proyectado)</label>
          <Input type="number" value={s.cash_flow_warning_threshold_ars ?? 0} onChange={e => update('cash_flow_warning_threshold_ars', e.target.value)} className="bg-muted border-border mt-1" /></div>
      </div>
      <Button onClick={save} disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">{saving ? 'Guardando...' : 'Guardar Umbrales'}</Button>
    </div>
  );
}

// ===== Expense Categories CRUD =====
function ExpenseCategoriesSection({ userId }: { userId: string }) {
  const [cats, setCats] = useState<string[]>([]);
  const [newCat, setNewCat] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const s: any = await getSettingsDB(userId);
      setCats(buildExpenseCategories(s).map(c => c.value));
    })();
  }, [userId]);

  const add = () => {
    const slug = newCat.trim().toLowerCase().replace(/\s+/g, '_');
    if (!slug || cats.includes(slug)) return;
    setCats([...cats, slug]);
    setNewCat('');
  };

  const remove = (c: string) => setCats(cats.filter(x => x !== c));

  const save = async () => {
    setSaving(true);
    try {
      await saveSettingsDB(userId, { expense_categories: cats });
      toast.success('Categorías guardadas');
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6 space-y-3">
      <h2 className="font-display font-semibold text-lg flex items-center gap-2">
        <Tags className="w-4 h-4 text-primary" />Categorías de Gastos
      </h2>
      <p className="text-xs text-muted-foreground">Personalizá las categorías disponibles al cargar gastos.</p>
      <div className="flex flex-wrap gap-2">
        {cats.map(c => (
          <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted rounded-full text-xs">
            {c}
            <button onClick={() => remove(c)} className="text-destructive hover:text-destructive/80"><Trash2 className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="nueva_categoria"
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
          className="bg-muted border-border" />
        <Button variant="outline" onClick={add}><Plus className="w-3.5 h-3.5" /></Button>
      </div>
      <Button onClick={save} disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">{saving ? 'Guardando...' : 'Guardar Categorías'}</Button>
    </div>
  );
}

function BackupExport({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);

  const collectAll = async () => {
    const [products, sales, purchases, debts, settings, expenses, notes] = await Promise.all([
      getProductsDB(userId), getSalesDB(userId), getPurchasesDB(userId),
      getDebtsDB(userId), getSettingsDB(userId), getExpensesDB(userId), getCustomerNotesDB(userId),
    ]);
    return { products, sales, purchases, debts, settings, expenses, customer_notes: notes };
  };

  const exportExcel = async () => {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const data = await collectAll();
      const wb = XLSX.utils.book_new();
      const sheets: Record<string, any[]> = {
        Productos: data.products,
        Ventas: data.sales,
        Compras: data.purchases,
        Deudas: data.debts,
        Gastos: data.expenses,
        Notas_Clientes: data.customer_notes,
      };
      Object.entries(sheets).forEach(([name, rows]) => {
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ vacio: 'Sin datos' }]);
        XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      });
      const fileName = `exentry-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, fileName);
      toast.success(`Excel descargado: ${fileName}`);
    } catch (err: any) {
      toast.error("Error al exportar: " + err.message);
    } finally { setBusy(false); }
  };

  const exportJSON = async () => {
    setBusy(true);
    try {
      const data = await collectAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exentry-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup JSON descargado");
    } catch (err: any) {
      toast.error("Error al exportar: " + err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6">
      <h2 className="font-display font-semibold text-lg mb-3 flex items-center gap-2">
        <Download className="w-4 h-4 text-primary" />Backup y Exportación
      </h2>
      <p className="text-xs text-muted-foreground mb-4">Descargá toda tu base de datos para análisis externo o respaldo.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={exportExcel} disabled={busy} variant="outline" className="flex-1">
          <FileSpreadsheet className="w-4 h-4 mr-2" />Excel (.xlsx)
        </Button>
        <Button onClick={exportJSON} disabled={busy} variant="outline" className="flex-1">
          <FileJson className="w-4 h-4 mr-2" />JSON
        </Button>
      </div>
    </div>
  );
}

function CouponsManager({ userId }: { userId: string }) {
  const [coupons, setCoupons] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountFixed, setDiscountFixed] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const load = async () => {
    const data = await getCouponsDB(userId);
    setCoupons(data);
  };

  useEffect(() => { load(); }, [userId]);

  const handleCreate = async () => {
    if (!code.trim()) { toast.error('Ingresá un código'); return; }
    try {
      await addCouponDB({
        user_id: userId,
        code: code.toUpperCase().trim(),
        discount_percent: parseFloat(discountPercent) || 0,
        discount_fixed_ars: parseFloat(discountFixed) || 0,
        max_uses: maxUses ? parseInt(maxUses) : null,
        valid_until: validUntil || null,
      });
      toast.success(`Cupón ${code.toUpperCase()} creado`);
      setOpen(false); setCode(''); setDiscountPercent(''); setDiscountFixed(''); setMaxUses(''); setValidUntil('');
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await updateCouponDB(id, { active: !active });
    load();
  };

  const handleDelete = async (id: string) => {
    await deleteCouponDB(id);
    toast.success('Cupón eliminado');
    load();
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-lg flex items-center gap-2">
          <Ticket className="w-4 h-4 text-primary" />Cupones de Descuento
        </h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gradient-gold text-primary-foreground"><Plus className="w-3.5 h-3.5 mr-1" />Nuevo</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">Crear Cupón</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><label className="text-sm text-muted-foreground">Código</label>
                <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="EXENTRY10" className="bg-muted border-border mt-1" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm text-muted-foreground">Descuento %</label>
                  <Input type="number" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} placeholder="10" className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Desc. fijo ARS</label>
                  <Input type="number" value={discountFixed} onChange={e => setDiscountFixed(e.target.value)} placeholder="5000" className="bg-muted border-border mt-1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm text-muted-foreground">Usos máximos</label>
                  <Input type="number" value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="Ilimitado" className="bg-muted border-border mt-1" /></div>
                <div><label className="text-sm text-muted-foreground">Válido hasta</label>
                  <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="bg-muted border-border mt-1" /></div>
              </div>
              <p className="text-[10px] text-muted-foreground">Si ponés % y monto fijo, se aplica el porcentaje. Dejá vacío lo que no uses.</p>
              <Button onClick={handleCreate} className="w-full gradient-gold text-primary-foreground font-semibold">Crear Cupón</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {coupons.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No hay cupones creados. Creá uno para compartir con tus clientes.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map(c => (
            <div key={c.id} className={`flex items-center justify-between p-3 rounded-lg border ${c.active ? 'bg-muted/50 border-border' : 'bg-muted/20 border-border/50 opacity-60'}`}>
              <div>
                <p className="font-mono font-bold text-sm">{c.code}</p>
                <p className="text-[10px] text-muted-foreground">
                  {c.discount_percent > 0 ? `${c.discount_percent}% OFF` : `${formatARS(Number(c.discount_fixed_ars))} OFF`}
                  {c.max_uses ? ` · ${c.current_uses}/${c.max_uses} usos` : ` · ${c.current_uses} usos`}
                  {c.valid_until ? ` · Hasta ${new Date(c.valid_until).toLocaleDateString('es-AR')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={c.active} onCheckedChange={() => handleToggle(c.id, c.active)} />
                <ConfirmDialog
                  trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                  title="¿Eliminar cupón?"
                  confirmText="Eliminar"
                  onConfirm={() => handleDelete(c.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Cloud Backups =====
function CloudBackupsSection({ userId }: { userId: string }) {
  const [files, setFiles] = useState<Array<{ name: string; created_at?: string; size?: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from('backups').list(userId, {
        limit: 100, sortBy: { column: 'created_at', order: 'desc' },
      });
      if (error) throw error;
      setFiles((data || []).filter(f => f.name?.endsWith('.json')).map(f => ({
        name: f.name, created_at: (f as any).created_at, size: (f.metadata as any)?.size,
      })));
    } catch (e: any) {
      // bucket may be empty or RLS denial — silent
      setFiles([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [userId]);

  const downloadFile = async (name: string) => {
    try {
      const { data, error } = await supabase.storage.from('backups').createSignedUrl(`${userId}/${name}`, 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (e: any) { toast.error('Error: ' + e.message); }
  };

  const runManual = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('weekly-backup');
      if (error) throw error;
      toast.success('Backup generado. Refrescando lista…');
      setTimeout(load, 1500);
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold text-lg flex items-center gap-2">
          <Cloud className="w-4 h-4 text-primary" />Backups en la Nube
        </h2>
        <Button size="sm" variant="outline" onClick={runManual} disabled={running}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Generando…' : 'Backup ahora'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Respaldo automático cada domingo 23:59 UTC. Conservás los últimos 100 archivos.</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No hay backups todavía. Generá el primero manualmente.</p>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {files.map(f => (
            <div key={f.name} className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/50 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-mono truncate">{f.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {f.created_at ? new Date(f.created_at).toLocaleString('es-AR') : '—'}
                  {f.size ? ` · ${(f.size / 1024).toFixed(1)} KB` : ''}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => downloadFile(f.name)}>
                <Download className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
