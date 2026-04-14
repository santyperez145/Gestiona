import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getSettingsDB, saveSettingsDB, getProductsDB, formatARS, calculateProductProfits, getCouponsDB, addCouponDB, updateCouponDB, deleteCouponDB } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { RefreshCw, Database, Shield, Receipt, Palette, Building2, Upload, Keyboard, RotateCcw, CreditCard, MessageCircle, ShoppingBag, Droplets, Ticket, Plus, Trash2 } from "lucide-react";
import { ColorPicker } from "@/components/shared/ColorPicker";
import { applyColors } from "@/lib/useBusinessConfig";
import { logAudit } from "@/lib/auditLog";
import { FormSkeleton } from "@/components/shared/PageSkeleton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function SettingsPage() {
  const { user } = useAuth();
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

          {/* Coupons CRUD */}
          <CouponsManager userId={user!.id} />
        </div>
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
          <DialogContent className="bg-card border-border">
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
