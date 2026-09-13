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
  green: { icon: "bg-success/10 text-success", value: "text-success", bar: "bg-success" },
  red: { icon: "bg-destructive/10 text-destructive", value: "text-destructive", bar: "bg-destructive" },
  yellow: { icon: "bg-warning/10 text-warning", value: "text-warning", bar: "bg-warning" },
  blue: { icon: "bg-primary/10 text-primary", value: "text-primary", bar: "bg-primary" },
  violet: { icon: "bg-muted/10 text-muted-foreground dark:text-primary", value: "text-primary dark:text-muted-foreground", bar: "bg-primary" },
  neutral: { icon: "bg-muted text-muted-foreground", value: "text-foreground", bar: "bg-muted-foreground/50" },
};

export default function MetricCard({
  label, value, sub, icon: Icon, tone = "amber", live = false, onClick,
}: MetricCardProps) {
  const colors = TONE[tone];

  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      data-tone={tone}
      className={cn(
        "workspace-metric-card nerqia-kpi group relative overflow-hidden border border-border/80 bg-card py-3.5 pl-5 pr-4",
        live && "border-emerald-500/35",
        onClick && "cursor-pointer",
      )}
    >
      {/* Acento lateral izquierdo: la firma del cockpit Nerqia, no una
          barra inferior que cualquier plantilla tiene. */}
      <div className={cn("absolute inset-y-0 left-0 w-[3px]", colors.bar)} />
      <div className="workspace-metric-card__content flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="workspace-metric-card__label truncate text-[10px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
              {label}
            </p>
            {live && (
              <span className="inline-flex shrink-0 items-center gap-1 border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 bg-emerald-500" />
                En vivo
              </span>
            )}
          </div>
          <p className={cn("workspace-metric-card__value mt-2 truncate font-display text-[1.5rem] font-bold leading-none tracking-[-0.03em]", colors.value)}>
            {value}
          </p>
          {sub && <p className="mt-2 truncate text-[11px] leading-snug text-muted-foreground/75">{sub}</p>}
        </div>
        <span className={cn("workspace-metric-card__icon flex h-8 w-8 shrink-0 items-center justify-center", colors.icon)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}