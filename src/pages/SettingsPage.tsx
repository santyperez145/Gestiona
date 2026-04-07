import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getSettingsDB, saveSettingsDB, getProductsDB, formatARS } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { RefreshCw, Database, Shield, Receipt, Palette, Building2, Upload, Keyboard, RotateCcw } from "lucide-react";
import { ColorPicker } from "@/components/shared/ColorPicker";
import { calculateProductProfits } from "@/lib/supabaseStore";
import { logAudit } from "@/lib/auditLog";
import { FormSkeleton } from "@/components/shared/PageSkeleton";

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

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s = await getSettingsDB(user.id);
      setExchangeRate(String(s.exchange_rate));
      setCustomsPercent(String(s.customs_percent));
      setDefaultDiscountPercent(String(s.default_discount_percent));
      setTaxEnabled(!!s.tax_enabled);
      setTaxIva(String(s.tax_iva_percent ?? 21));
      setTaxIibb(String(s.tax_iibb_percent ?? 3.5));
      setTaxMonotributo(String(s.tax_monotributo_monthly ?? 0));
      setBusinessName((s as any).business_name || 'Exentry Imports');
      setLogoUrl((s as any).logo_url || '');
      setPrimaryColor((s as any).primary_color || '#D4A843');
      setSecondaryColor((s as any).secondary_color || '#1A1A2E');
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
      });
      await logAudit(user.id, 'settings_change', 'settings', undefined, { exchangeRate, customsPercent, businessName, taxEnabled });
      toast.success("Configuración guardada correctamente");
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
    let count = 0;
    for (const p of products) {
      if (Number(p.cost_usd) <= 0) continue;
      const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
        Number(p.cost_usd), customs, Number(p.sale_price_ars), rate
      );
      await supabase.from('products').update({
        customs_fee: customsFee, total_cost_usd: totalCostUSD,
        profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
      }).eq('id', p.id);
      count++;
    }
    toast.success(`${count} productos recalculados con TC $${rate}`);
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
        {/* Left column */}
        <div className="space-y-4 md:space-y-6">
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
              <div>
                <label className="text-sm text-muted-foreground">Color Principal</label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded border-0 cursor-pointer" />
                  <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="bg-muted border-border flex-1" />
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Color Secundario</label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="color" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="w-10 h-10 rounded border-0 cursor-pointer" />
                  <Input value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="bg-muted border-border flex-1" />
                </div>
              </div>
            </div>
          </div>

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
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold shadow-gold flex-1">
                {saving ? 'Guardando...' : 'Guardar Configuración'}
              </Button>
              <Button variant="outline" onClick={handleRecalculate}><RefreshCw className="w-4 h-4 mr-2" />Recalcular</Button>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4 md:space-y-6">
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

          <div className="bg-card border border-border rounded-lg p-4 md:p-6">
            <h2 className="font-display font-semibold text-lg mb-3 flex items-center gap-2"><Database className="w-4 h-4 text-primary" />Sistema</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Negocio:</span><span className="font-medium">{businessName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Productos:</span><span className="font-medium">{productCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Almacenamiento:</span><span className="font-medium text-success">Cloud ☁️</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auth:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IA:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auditoría:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Versión:</span><span className="font-medium">6.0</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Usuario:</span><span className="font-medium text-xs truncate max-w-[150px]">{user?.email}</span></div>
            </div>
          </div>

          <div className="bg-card border border-success/30 rounded-lg p-4 md:p-6">
            <h2 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />Seguridad
            </h2>
            <p className="text-sm text-muted-foreground">
              Datos protegidos con autenticación, cifrado y auditoría de acciones. Cada usuario solo ve sus propios datos. Sistema multi-tenant con aislamiento completo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
