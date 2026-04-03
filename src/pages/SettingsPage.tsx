import { useState, useEffect } from "react";
import { getSettings, saveSettings, getProducts, saveProducts, calculateProductProfits } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle } from "lucide-react";

export default function SettingsPage() {
  const [exchangeRate, setExchangeRate] = useState('');
  const [customsPercent, setCustomsPercent] = useState('');
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState('');

  useEffect(() => {
    const s = getSettings();
    setExchangeRate(s.exchangeRate.toString());
    setCustomsPercent(s.customsPercent.toString());
    setDefaultDiscountPercent(s.defaultDiscountPercent.toString());
  }, []);

  const handleSave = () => {
    saveSettings({
      exchangeRate: parseFloat(exchangeRate) || 1695,
      customsPercent: parseFloat(customsPercent) || 15,
      defaultDiscountPercent: parseFloat(defaultDiscountPercent) || 20,
    });
    toast.success("Configuración guardada");
  };

  const handleRecalculate = () => {
    const settings = getSettings();
    const products = getProducts();
    // recalculate all
    const updated = products.map(p => {
      if (p.costUSD <= 0) return p;
      const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
        p.costUSD, settings.customsPercent, p.salePriceARS, settings.exchangeRate
      );
      return { ...p, customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD };
    });
    saveProducts(updated);
    toast.success(`${updated.length} productos recalculados con TC $${settings.exchangeRate}`);
  };

  const handleResetData = () => {
    if (!confirm('⚠️ Esto borrará TODOS los datos (productos, ventas, compras, deudas). ¿Estás seguro?')) return;
    localStorage.removeItem('exentry_products');
    localStorage.removeItem('exentry_purchases');
    localStorage.removeItem('exentry_sales');
    localStorage.removeItem('exentry_debts');
    toast.success("Datos borrados. Recargá la página para cargar datos del Excel.");
    setTimeout(() => window.location.reload(), 1000);
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
            <p className="text-xs text-muted-foreground mt-1">Se usa para calcular costos y ganancias en pesos</p>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Porcentaje del Pasero (%)</label>
            <Input type="number" value={customsPercent} onChange={e => setCustomsPercent(e.target.value)} className="bg-muted border-border mt-1" />
            <p className="text-xs text-muted-foreground mt-1">Recargo que cobra el pasero sobre el valor del producto</p>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Descuento por Defecto (%)</label>
            <Input type="number" value={defaultDiscountPercent} onChange={e => setDefaultDiscountPercent(e.target.value)} className="bg-muted border-border mt-1" />
            <p className="text-xs text-muted-foreground mt-1">Descuento sugerido al crear productos</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={handleSave} className="gradient-gold text-primary-foreground font-semibold shadow-gold flex-1">
              Guardar Cambios
            </Button>
            <Button variant="outline" onClick={handleRecalculate} title="Recalcular precios">
              <RefreshCw className="w-4 h-4 mr-2" />Recalcular
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-display font-semibold text-lg mb-3">Información del Sistema</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Productos cargados:</span><span className="font-medium">{getProducts().length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Almacenamiento:</span><span className="font-medium">LocalStorage (navegador)</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Versión:</span><span className="font-medium">2.0</span></div>
            </div>
          </div>

          <div className="bg-card border border-destructive/30 rounded-lg p-6">
            <h2 className="font-display font-semibold text-lg mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Zona de Peligro
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Resetear los datos borrará todo y volverá a cargar los productos del Excel original.
            </p>
            <Button variant="destructive" onClick={handleResetData}>
              Borrar Todo y Recargar del Excel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
