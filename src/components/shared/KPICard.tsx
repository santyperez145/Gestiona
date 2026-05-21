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
  bar:    string;   // left accent bar color
  icon:   string;   // icon color
  value:  string;   // value text color
  glow:   string;   // hover glow class
}> = {
  primary:     { bar: "bg-primary",     icon: "text-primary",     value: "text-primary",     glow: "hover:shadow-[0_0_32px_-4px_hsl(38_82%_52%/0.2)]" },
  success:     { bar: "bg-success",     icon: "text-success",     value: "text-success",     glow: "hover:shadow-[0_0_32px_-4px_hsl(155_55%_40%/0.2)]" },
  destructive: { bar: "bg-destructive", icon: "text-destructive", value: "text-destructive", glow: "hover:shadow-[0_0_32px_-4px_hsl(0_68%_50%/0.2)]" },
  warning:     { bar: "bg-warning",     icon: "text-warning",     value: "text-warning",     glow: "hover:shadow-[0_0_32px_-4px_hsl(38_90%_55%/0.2)]" },
  blue:        { bar: "bg-blue-500",    icon: "text-blue-400",    value: "text-blue-400",    glow: "hover:shadow-[0_0_32px_-4px_hsl(210_90%_60%/0.2)]" },
  purple:      { bar: "bg-violet-500",  icon: "text-violet-400",  value: "text-violet-400",  glow: "hover:shadow-[0_0_32px_-4px_hsl(265_85%_65%/0.2)]" },
};

export default function KPICard({
  label, value, sub, icon: Icon, color = "primary", trend, onClick, footer,
}: KPICardProps) {
  const c = colorMap[color];

  return (
    <div
      onClick={onClick}
      className={cn(
        /* Base */
        "relative group overflow-hidden rounded-[10px]",
        "bg-[hsl(228_24%_7%)] border border-border/60",
        "shadow-kpi transition-all duration-200",
        /* Hover */
        "hover:border-border/80 hover:-translate-y-[2px]",
        c.glow,
        onClick && "cursor-pointer select-none",
      )}
    >
      {/* ── Left accent bar ─────────────────────────────── */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[10px] transition-all duration-300",
        c.bar,
        "opacity-80 group-hover:opacity-100",
      )} />

      {/* ── Inner highlight (top edge) ───────────────────── */}
      <div className="absolute top-0 left-[3px] right-0 h-px bg-gradient-to-r from-white/6 via-white/4 to-transparent" />

      <div className="pl-5 pr-4 pt-4 pb-3.5">
        {/* ── Top row: label + icon ─────────────────────── */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className={cn(
            "text-[10px] font-semibold uppercase tracking-[0.12em] leading-none",
            "text-muted-foreground/70 font-display",
          )}>
            {label}
          </span>
          <Icon className={cn("w-[15px] h-[15px] shrink-0 mt-0.5 opacity-60 group-hover:opacity-90 transition-opacity", c.icon)} />
        </div>

        {/* ── Value — large mono number ────────────────── */}
        <p className={cn(
          "text-[1.6rem] font-bold leading-none tracking-tight data-num animate-number-up",
          c.value,
        )}>
          {value}
        </p>

        {/* ── Bottom row: sub + trend ───────────────────── */}
        <div className="flex items-end justify-between gap-2 mt-2 min-h-[18px]">
          {sub && (
            <p className="text-[11px] text-muted-foreground/55 leading-snug flex-1 truncate">
              {sub}
            </p>
          )}
          {trend && (
            <span className={cn(
              "shrink-0 flex items-center gap-0.5 text-[11px] font-bold leading-none font-mono",
              trend.value >= 0 ? "text-success" : "text-destructive",
            )}>
              <span className="text-[10px]">{trend.value >= 0 ? "↑" : "↓"}</span>
              {Math.abs(trend.value).toFixed(1)}%
              <span className="font-normal text-muted-foreground/50 ml-0.5 text-[10px]">{trend.label}</span>
            </span>
          )}
        </div>

        {/* ── Footer slot ──────────────────────────────── */}
        {footer && (
          <div className="mt-3 pt-2.5 border-t border-border/50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
