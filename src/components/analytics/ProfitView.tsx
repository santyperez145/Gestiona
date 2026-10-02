import { useDateRangeFilter } from "@/components/shared/DateRangeFilter";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import { format } from "date-fns";
import ChannelMarginTab from "@/components/analytics/ChannelMarginTab";
import { useSearchParams } from "react-router-dom";
import type { ProfitMode } from "@/lib/profitPeriod";

export default function ProfitView() {
  const { from, to } = useDateRangeFilter();
  const [search, setSearch] = useSearchParams();
  const mode = search.get("profit_mode");
  const change = (key: string, value: string) => setSearch(previous => {
    const next = new URLSearchParams(previous);
    if (key === "profit_all") { next.delete("profit_store"); next.delete("profit_channel"); return next; }
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">Ventas asentadas de la organización</p>
      <DateRangeFilter label="Todo el período" />
    </div>
    <ChannelMarginTab enabled from={from ? format(from, "yyyy-MM-dd") : undefined} to={to ? format(to, "yyyy-MM-dd") : undefined}
      storeId={search.get("profit_store") || undefined} channel={search.get("profit_channel") || undefined}
      mode={mode === "sku" || mode === "products" || mode === "operations" ? mode as ProfitMode : undefined}
      onModeChange={value => change("profit_mode", value)} onFilterChange={(filter, value) => change(`profit_${filter}`, value)} />
  </div>;
}
