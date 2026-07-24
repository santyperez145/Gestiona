import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "destructive";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: { label: string; variant?: BadgeVariant };
}

const BADGE: Record<BadgeVariant, string> = {
  default:     "bg-primary/12 text-primary border border-primary/20",
  success:     "bg-emerald-500/12 text-emerald-400 border border-emerald-500/20",
  warning:     "bg-warning/12 text-warning border border-warning/20",
  destructive: "bg-destructive/12 text-destructive border border-destructive/20",
};

export default function PageHeader({ icon: Icon, title, description, actions, badge }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 md:mb-8">

      {/* ── Left: icon + title + accent bar ─────────────────────── */}
      <div className="min-w-0">

        {/* Icon row */}
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="w-[15px] h-[15px] text-primary/60 shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50 font-display">
            {title}
          </span>
        </div>

        {/* Title */}
        <div className="flex items-end gap-3 flex-wrap">
          <h1 className={cn(
            "text-[1.7rem] md:text-[2rem] font-display font-bold tracking-[-0.03em] leading-none",
            "text-foreground",
          )}>
            {title}
          </h1>
          {badge && (
            <span className={cn(
              "text-[11px] font-semibold px-2 py-0.5 rounded-[5px] leading-none mb-[3px]",
              BADGE[badge.variant ?? "default"],
            )}>
              {badge.label}
            </span>
          )}
        </div>

        {/* Gold accent underline */}
        <div className="mt-2 h-[2px] w-8 rounded-full bg-primary/50" />

        {/* Description */}
        {description && (
          <p className="mt-2 text-[13px] text-muted-foreground/60 leading-relaxed max-w-[520px]">
            {description}
          </p>
        )}
      </div>

      {/* ── Right: actions ───────────────────────────────────────── */}
      {actions && (
        <div className="flex items-center gap-2 flex-wrap shrink-0 sm:pt-1">
          {actions}
        </div>
      )}
    </div>
  );
}
