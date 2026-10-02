import { useId } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROFIT_CHANNELS, type ProfitMode, type ProfitStore } from "@/lib/profitPeriod";

const modes = [{ value: "products", label: "Producto y canal" }, { value: "sku", label: "SKU y canal" }, { value: "operations", label: "Operaciones" }] as const;
type Props = { mode: ProfitMode; panelId: string; stores: ProfitStore[]; storeId?: string; channel?: string;
  onModeChange: (mode: ProfitMode) => void; onFilterChange?: (filter: "store" | "channel", value: string) => void };

export default function ProfitControls({ mode, panelId, stores, storeId, channel, onModeChange, onFilterChange }: Props) {
  const id = useId();
  return <div className="space-y-3">
    {onFilterChange && <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <div className="min-w-0"><label htmlFor={`${id}-store`} className="mb-1 block text-xs font-medium">Tienda</label>
        <Select value={storeId || "all"} onValueChange={value => onFilterChange("store", value === "all" ? "" : value)}>
          <SelectTrigger id={`${id}-store`} className="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas las tiendas</SelectItem>
            {storeId && !stores.some(store => store.id === storeId) && <SelectItem value={storeId} textValue="Tienda no disponible">Tienda no disponible</SelectItem>}
            {stores.map(store => <SelectItem key={store.id} value={store.id} textValue={`${store.name}${store.active ? "" : " (Inactiva)"}`}>
              {store.name}{store.active ? "" : " (Inactiva)"}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0"><label htmlFor={`${id}-channel`} className="mb-1 block text-xs font-medium">Canal</label>
        <Select value={channel || "all"} onValueChange={value => onFilterChange("channel", value === "all" ? "" : value)}>
          <SelectTrigger id={`${id}-channel`} className="min-h-11 w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos los canales</SelectItem>
            {channel && !(channel in PROFIT_CHANNELS) && <SelectItem value={channel} textValue="Canal no disponible">Canal no disponible</SelectItem>}
            {Object.entries(PROFIT_CHANNELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>}
    <div role="tablist" aria-label="Vista de rentabilidad" className="flex flex-wrap gap-1">
      {modes.map(({ value, label }, index) => <button key={value} type="button" role="tab"
        aria-selected={mode === value} aria-controls={panelId} tabIndex={mode === value ? 0 : -1}
        className={`min-h-11 rounded-md border px-3 text-sm font-medium ${mode === value ? "border-primary/40 bg-card text-primary dark:text-blue-300" : "border-border text-muted-foreground"}`}
        onClick={() => onModeChange(value)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + modes.length) % modes.length;
          onModeChange(modes[next].value);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{label}</button>)}
    </div>
  </div>;
}
