import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

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

const colorMap: Record<ColorVariant, { icon: string; bg: string; text: string }> = {
  primary:     { icon: "text-primary",     bg: "bg-primary/10",     text: "text-primary" },
  success:     { icon: "text-success",     bg: "bg-success/10",     text: "text-success" },
  destructive: { icon: "text-destructive", bg: "bg-destructive/10", text: "text-destructive" },
  warning:     { icon: "text-warning",     bg: "bg-warning/10",     text: "text-warning" },
  blue:        { icon: "text-blue-400",    bg: "bg-blue-500/10",    text: "text-blue-400" },
  purple:      { icon: "text-purple-400",  bg: "bg-purple-500/10",  text: "text-purple-400" },
};

export default function KPICard({ label, value, sub, icon: Icon, color = "primary", trend, onClick, footer }: KPICardProps) {
  const c = colorMap[color];
  return (
    <div
      onClick={onClick}
      className={`group bg-card border border-border rounded-xl p-3.5 md:p-4 shadow-card transition-all duration-200
        hover:border-primary/30 hover:shadow-gold/10 hover:-translate-y-0.5
        ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] md:text-[11px] text-muted-foreground font-medium uppercase tracking-wider leading-tight">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.bg} group-hover:scale-110 transition-transform duration-200`}>
          <Icon className={`w-4 h-4 ${c.icon}`} />
        </div>
      </div>
      <p className="text-xl md:text-2xl font-bold font-display tracking-tight leading-none">{value}</p>
      <div className="flex items-center gap-2 mt-1.5 min-h-[16px]">
        {sub && <p className="text-[10px] md:text-[11px] text-muted-foreground/70 truncate flex-1">{sub}</p>}
        {trend && (
          <span className={`text-[10px] font-bold shrink-0 flex items-center gap-0.5 ${trend.value >= 0 ? "text-success" : "text-destructive"}`}>
            {trend.value >= 0 ? "↑" : "↓"}{Math.abs(trend.value).toFixed(1)}%
            <span className="font-normal text-muted-foreground/60">{trend.label}</span>
          </span>
        )}
      </div>
      {footer && <div className="mt-2.5 pt-2.5 border-t border-border/60">{footer}</div>}
    </div>
  );
}
