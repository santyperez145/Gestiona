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
    <div className="group bg-card border border-border rounded-xl p-3.5 md:p-4 shadow-card hover:border-primary/30 hover:shadow-gold/10 transition-all duration-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] md:text-[11px] text-muted-foreground font-medium uppercase tracking-wider leading-tight">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color === 'text-primary' ? 'bg-primary/10' : color === 'text-success' ? 'bg-success/10' : color === 'text-destructive' ? 'bg-destructive/10' : color === 'text-warning' ? 'bg-warning/10' : 'bg-accent/10'} group-hover:scale-110 transition-transform duration-200`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
      </div>
      <p className="text-lg md:text-xl font-bold font-display tracking-tight">{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {sub && <p className="text-[10px] md:text-[11px] text-muted-foreground/70 truncate">{sub}</p>}
        {trend && (
          <span className={`text-[10px] font-semibold ${trend.value >= 0 ? 'text-success' : 'text-destructive'}`}>
            {trend.value >= 0 ? '↑' : '↓'}{Math.abs(trend.value).toFixed(1)}% {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}
