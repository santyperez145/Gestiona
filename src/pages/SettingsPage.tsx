import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getSettingsDB, saveSettingsDB, getProductsDB, formatARS } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, Database, Shield } from "lucide-react";
import { calculateProductProfits } from "@/lib/store";

export default function SettingsPage() {
  const { user } = useAuth();
  const [exchangeRate, setExchangeRate] = useState('');
  const [customsPercent, setCustomsPercent] = useState('');
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState('');
  const [productCount, setProductCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const s = await getSettingsDB(user.id);
      setExchangeRate(String(s.exchange_rate));
      setCustomsPercent(String(s.customs_percent));
      setDefaultDiscountPercent(String(s.default_discount_percent));
      const products = await getProductsDB(user.id);
      setProductCount(products.length);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    await saveSettingsDB(user.id, {
      exchange_rate: parseFloat(exchangeRate) || 1695,
      customs_percent: parseFloat(customsPercent) || 15,
      default_discount_percent: parseFloat(defaultDiscountPercent) || 20,
    });
    toast.success("Configuración guardada");
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

  return (
    <div>
      <h1 className="text-2xl md:text-3xl font-display font-bold mb-1">Ajustes</h1>
      <p className="text-muted-foreground mb-8">Configuración general de Exentry Imports</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6 space-y-5">
          <h2 className="font-display font-semibold text-lg">Parámetros Financieros</h2>
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
          <div className="flex gap-3">
            <Button onClick={handleSave} className="gradient-gold text-primary-foreground font-semibold shadow-gold flex-1">Guardar</Button>
            <Button variant="outline" onClick={handleRecalculate}><RefreshCw className="w-4 h-4 mr-2" />Recalcular</Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-display font-semibold text-lg mb-3 flex items-center gap-2"><Database className="w-4 h-4 text-primary" />Sistema</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Productos:</span><span className="font-medium">{productCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Almacenamiento:</span><span className="font-medium text-success">Lovable Cloud ☁️</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auth:</span><span className="font-medium text-success">Activo ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IA:</span><span className="font-medium text-success">Lovable AI ✓</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Versión:</span><span className="font-medium">3.0</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Usuario:</span><span className="font-medium text-xs truncate max-w-[150px]">{user?.email}</span></div>
            </div>
          </div>

          <div className="bg-card border border-success/30 rounded-lg p-6">
            <h2 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />Seguridad
            </h2>
            <p className="text-sm text-muted-foreground">
              Tus datos están protegidos en la nube con autenticación y cifrado.
              Cada usuario solo puede ver sus propios datos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
