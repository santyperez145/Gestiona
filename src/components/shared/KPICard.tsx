import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ColorVariant = "primary" | "success" | "destructive" | "warning" | "blue" | "purple";

interface KPICardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  color?: ColorVariant;
  trend?: { value: number; label: string };
  onClick?: () => void;
  footer?: ReactNode;
}

const colorMap: Record<ColorVariant, {
  bar: string;
  icon: string;
}> = {
  primary:     { bar: "bg-primary",     icon: "text-primary" },
  success:     { bar: "bg-emerald-500", icon: "text-emerald-600 dark:text-emerald-400" },
  destructive: { bar: "bg-destructive", icon: "text-destructive" },
  warning:     { bar: "bg-yellow-500",  icon: "text-yellow-600 dark:text-yellow-400" },
  blue:        { bar: "bg-blue-500",    icon: "text-blue-600 dark:text-blue-400" },
  purple:      { bar: "bg-primary",     icon: "text-primary" },
};

export default function KPICard({
  label, value, sub, icon: Icon, color = "primary", trend, onClick, footer,
}: KPICardProps) {
  const c = colorMap[color];

  return (
    <div
      onClick={onClick}
      className={cn(
        "workspace-kpi-card relative overflow-hidden bg-card border border-border/80",
        onClick && "cursor-pointer select-none",
      )}
    >
      <div className={cn("absolute left-0 top-0 bottom-0 w-[2px]", c.bar)} />

      <div className="pl-5 pr-4 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] leading-none text-muted-foreground font-display">
            {label}
          </span>
          <Icon className={cn("w-[15px] h-[15px] shrink-0 mt-0.5 opacity-55", c.icon)} />
        </div>

        <p className="text-[1.5rem] font-bold leading-none tracking-tight data-num text-foreground">
          {value}
        </p>

        <div className="flex items-end justify-between gap-2 mt-2 min-h-[18px]">
          {sub && (
            <p className="text-[11px] text-muted-foreground leading-snug flex-1 truncate">
              {sub}
            </p>
          )}
          {trend && (
            <span className={cn(
              "shrink-0 flex max-w-full items-center gap-0.5 text-[11px] font-bold leading-none font-mono",
              trend.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
            )} aria-label={`${trend.value >= 0 ? "Subió" : "Bajó"} ${Math.abs(trend.value).toFixed(1)}% ${trend.label}`}>
              <span className="text-[10px]">{trend.value >= 0 ? "↑" : "↓"}</span>
              {Math.abs(trend.value).toFixed(1)}%
              <span aria-hidden="true" className="hidden font-normal text-muted-foreground/70 ml-0.5 text-[10px] sm:inline">{trend.label}</span>
            </span>
          )}
        </div>

        {footer && (
          <div className="mt-3 pt-2.5 border-t border-border/50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
