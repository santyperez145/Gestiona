/**
 * DateRangeFilter — shared, URL-persisted date range filter.
 *
 * Renders a popover with quick presets ("Este mes", "Últimos 30 días", "Este año",
 * "Últimos 90 días") plus a custom range calendar. Selection is written to the
 * `df` (date-from) and `dt` (date-to) URL search params via `useSearchParams`,
 * so the filter survives navigation and page refresh.
 *
 * Use the `useDateRangeFilter()` hook in the page to read the selected range
 * and filter its data — `inRange(dateValue)` is a convenience helper for that.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, X } from "lucide-react";
import { format, startOfMonth, startOfYear, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

export const DATE_RANGE_PARAM_FROM = "df";
export const DATE_RANGE_PARAM_TO = "dt";

const PRESETS: { label: string; from: () => Date; to: () => Date }[] = [
  { label: "Este mes", from: () => startOfMonth(new Date()), to: () => new Date() },
  { label: "Últimos 30 días", from: () => subDays(new Date(), 29), to: () => new Date() },
  { label: "Últimos 90 días", from: () => subDays(new Date(), 89), to: () => new Date() },
  { label: "Este año", from: () => startOfYear(new Date()), to: () => new Date() },
];

function parseParamDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? undefined : d;
}
function toParam(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Reads/writes the shared date-range URL params and exposes a small API
 * pages can use to actually filter their (already-loaded) rows client-side.
 */
export function useDateRangeFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const from = parseParamDate(searchParams.get(DATE_RANGE_PARAM_FROM));
  const to = parseParamDate(searchParams.get(DATE_RANGE_PARAM_TO));

  const setRange = (nextFrom: Date | undefined, nextTo: Date | undefined) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextFrom) next.set(DATE_RANGE_PARAM_FROM, toParam(nextFrom));
        else next.delete(DATE_RANGE_PARAM_FROM);
        if (nextTo) next.set(DATE_RANGE_PARAM_TO, toParam(nextTo));
        else next.delete(DATE_RANGE_PARAM_TO);
        return next;
      },
      { replace: true }
    );
  };

  /** True if `dateVal` falls within the selected range (always true when no filter is active). */
  const inRange = (dateVal: string | Date | null | undefined): boolean => {
    if (!from && !to) return true;
    if (!dateVal) return false;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return true;
    if (from && d < from) return false;
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      if (d > end) return false;
    }
    return true;
  };

  return { from, to, setRange, inRange, active: !!from || !!to };
}

export default function DateRangeFilter({ label = "Filtrar fechas" }: { label?: string }) {
  const { from, to, setRange } = useDateRangeFilter();
  const [open, setOpen] = useState(false);
  const hasFilter = !!from || !!to;
  const displayFrom = from ?? to;
  const displayTo = to ?? from;

  const handleSelect = (range: DateRange | undefined) => {
    setRange(range?.from, range?.to);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("text-xs gap-1.5 min-h-11 bg-card", hasFilter && "border-primary text-primary")}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            {hasFilter
              ? `${format(displayFrom!, "dd/MM/yy", { locale: es })} – ${format(displayTo!, "dd/MM/yy", { locale: es })}`
              : label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <div className="flex flex-wrap gap-1 p-2 border-b border-border max-w-[260px]">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                className="text-xs min-h-11"
                onClick={() => {
                  setRange(p.from(), p.to());
                  setOpen(false);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            selected={{ from, to }}
            onSelect={handleSelect}
            numberOfMonths={1}
            locale={es}
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
      {hasFilter && (
        <Button variant="ghost" size="sm" className="min-h-11 min-w-11 p-0" onClick={() => setRange(undefined, undefined)} title="Limpiar filtro de fechas" aria-label="Limpiar filtro de fechas">
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
