import { useDateRangeFilter } from "@/components/shared/DateRangeFilter";
import DateRangeFilter from "@/components/shared/DateRangeFilter";
import { format } from "date-fns";
import ChannelMarginTab from "@/components/analytics/ChannelMarginTab";

export default function ProfitView() {
  const { from, to } = useDateRangeFilter();
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">Todas las sucursales y canales de la organización</p>
      <DateRangeFilter label="Todo el período" />
    </div>
    <ChannelMarginTab enabled from={from ? format(from, "yyyy-MM-dd") : undefined} to={to ? format(to, "yyyy-MM-dd") : undefined} />
  </div>;
}
