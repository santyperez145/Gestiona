import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, X } from "lucide-react";
import { format, subDays, startOfMonth, startOfYear } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

const PRESETS = [
  { label: "Hoy", from: () => new Date(), to: () => new Date() },
  { label: "7 días", from: () => subDays(new Date(), 7), to: () => new Date() },
  { label: "30 días", from: () => subDays(new Date(), 30), to: () => new Date() },
  { label: "Este mes", from: () => startOfMonth(new Date()), to: () => new Date() },
  { label: "Este año", from: () => startOfYear(new Date()), to: () => new Date() },
];

interface DateRangePickerProps {
  from: Date | undefined;
  to: Date | undefined;
  onChange: (from: Date | undefined, to: Date | undefined) => void;
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const hasFilter = !!from;

  const handleSelect = (range: DateRange | undefined) => {
    onChange(range?.from, range?.to);
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("text-xs gap-1.5", hasFilter && "border-primary text-primary")}>
            <CalendarIcon className="w-3.5 h-3.5" />
            {hasFilter
              ? `${format(from!, "dd/MM", { locale: es })} – ${to ? format(to, "dd/MM", { locale: es }) : "..."}`
              : "Filtrar fechas"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <div className="flex flex-wrap gap-1 p-2 border-b border-border">
            {PRESETS.map(p => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => { onChange(p.from(), p.to()); setOpen(false); }}
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
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onChange(undefined, undefined)}>
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
