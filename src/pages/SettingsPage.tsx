import { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function SettingsPage() {
  const [exchangeRate, setExchangeRate] = useState('');
  const [customsPercent, setCustomsPercent] = useState('');

  useEffect(() => {
    const s = getSettings();
    setExchangeRate(s.exchangeRate.toString());
    setCustomsPercent(s.customsPercent.toString());
  }, []);

  const handleSave = () => {
    saveSettings({
      exchangeRate: parseFloat(exchangeRate) || 1200,
      customsPercent: parseFloat(customsPercent) || 15,
    });
    toast.success("Configuración guardada");
  };

  return (
    <div>
      <h1 className="text-3xl font-display font-bold mb-1">Ajustes</h1>
      <p className="text-muted-foreground mb-8">Configuración general del sistema</p>

      <div className="bg-card border border-border rounded-lg p-6 max-w-md space-y-5">
        <div>
          <label className="text-sm text-muted-foreground">Tipo de Cambio (USD → ARS)</label>
          <Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="bg-muted border-border mt-1" />
          <p className="text-xs text-muted-foreground mt-1">Se usa como valor por defecto en nuevas compras</p>
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Porcentaje del Pasero (%)</label>
          <Input type="number" value={customsPercent} onChange={e => setCustomsPercent(e.target.value)} className="bg-muted border-border mt-1" />
          <p className="text-xs text-muted-foreground mt-1">Recargo que cobra el pasero sobre el valor del producto</p>
        </div>
        <Button onClick={handleSave} className="gradient-gold text-primary-foreground font-semibold shadow-gold">Guardar Cambios</Button>
      </div>
    </div>
  );
}
