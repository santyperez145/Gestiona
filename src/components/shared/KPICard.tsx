import { LucideIcon } from "lucide-react";

interface KPICardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  color?: string;
  trend?: { value: number; label: string };
}

export default function KPICard({ label, value, sub, icon: Icon, color = "text-primary", trend }: KPICardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 md:p-4 shadow-card hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between mb-1 md:mb-2">
        <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider leading-tight">{label}</span>
        <Icon className={`w-3.5 h-3.5 md:w-4 md:h-4 ${color} shrink-0`} />
      </div>
      <p className="text-base md:text-xl font-bold font-display">{value}</p>
      <div className="flex items-center gap-2 mt-0.5">
        {sub && <p className="text-[10px] md:text-xs text-muted-foreground truncate">{sub}</p>}
        {trend && (
          <span className={`text-[10px] font-medium ${trend.value >= 0 ? 'text-success' : 'text-destructive'}`}>
            {trend.value >= 0 ? '↑' : '↓'}{Math.abs(trend.value).toFixed(1)}% {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}
