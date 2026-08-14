import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type MetricTone = "amber" | "green" | "red" | "yellow" | "blue" | "violet" | "neutral";

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  tone?: MetricTone;
  live?: boolean;
  onClick?: () => void;
}

const TONE: Record<MetricTone, { icon: string; value: string; bar: string }> = {
  amber: { icon: "bg-primary/10 text-primary", value: "text-foreground", bar: "bg-primary" },
  green: { icon: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", value: "text-emerald-800 dark:text-emerald-300", bar: "bg-emerald-500" },
  red: { icon: "bg-destructive/10 text-destructive", value: "text-destructive", bar: "bg-destructive" },
  yellow: { icon: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400", value: "text-yellow-800 dark:text-yellow-300", bar: "bg-yellow-500" },
  blue: { icon: "bg-blue-500/10 text-blue-700 dark:text-blue-400", value: "text-blue-800 dark:text-blue-300", bar: "bg-blue-500" },
  violet: { icon: "bg-violet-500/10 text-violet-700 dark:text-violet-400", value: "text-violet-800 dark:text-violet-300", bar: "bg-violet-500" },
  neutral: { icon: "bg-muted text-muted-foreground", value: "text-foreground", bar: "bg-muted-foreground/50" },
};

export default function MetricCard({
  label, value, sub, icon: Icon, tone = "amber", live = false, onClick,
}: MetricCardProps) {
  const colors = TONE[tone];

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-[8px] border border-border/80 bg-card px-4 py-3.5",
        "shadow-kpi transition-all duration-200 hover:-translate-y-px hover:border-primary/35 hover:shadow-card",
        live && "border-emerald-500/35 ring-1 ring-emerald-500/10",
        onClick && "cursor-pointer",
      )}
    >
      <div className={cn("absolute inset-x-0 bottom-0 h-[2px] opacity-70 transition-opacity group-hover:opacity-100", colors.bar)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              {label}
            </p>
            {live && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                En vivo
              </span>
            )}
          </div>
          <p className={cn("mt-2 truncate text-[1.45rem] font-bold leading-none tracking-[-0.02em]", colors.value)}>
            {value}
          </p>
          {sub && <p className="mt-2 truncate text-[11px] leading-snug text-muted-foreground/75">{sub}</p>}
        </div>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] transition-transform duration-200 group-hover:scale-105", colors.icon)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}
