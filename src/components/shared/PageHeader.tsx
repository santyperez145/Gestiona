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
  eyebrow?: string;
}

const BADGE: Record<BadgeVariant, string> = {
  default:     "bg-primary/12 text-primary border border-primary/20",
  success:     "bg-emerald-500/12 text-emerald-400 border border-emerald-500/20",
  warning:     "bg-warning/12 text-warning border border-warning/20",
  destructive: "bg-destructive/12 text-destructive border border-destructive/20",
};

export default function PageHeader({ icon: Icon, title, description, actions, badge, eyebrow = "Nerqia / Espacio de trabajo" }: PageHeaderProps) {
  return (
    <div className="page-header workspace-page-header flex flex-col sm:flex-row sm:items-start justify-between gap-5 mb-6 md:mb-8">

      {/* ── Left: icon + title + accent bar ─────────────────────── */}
      <div className="workspace-page-header__main min-w-0">

        {/* Compact context line keeps the title readable at a glance. */}
        <div className="page-header__context flex items-center gap-2 mb-2">
          <span className="page-header__icon flex h-7 w-7 items-center justify-center rounded-[7px] bg-primary/10 text-primary ring-1 ring-primary/15">
            <Icon className="w-3.5 h-3.5" />
          </span>
          <span className="page-header__eyebrow text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 font-display">
            {eyebrow}
          </span>
        </div>

        {/* Title */}
        <div className="workspace-page-header__title-row flex items-end gap-3 flex-wrap">
          <h1 className={cn(
            "page-header__title text-[1.6rem] md:text-[2rem] font-display font-bold tracking-[-0.03em] leading-none",
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

        {/* Description */}
        {description && (
          <p className="page-header__description mt-2 text-[13px] text-muted-foreground/75 leading-relaxed max-w-[560px]">
            {description}
          </p>
        )}
      </div>

      {/* ── Right: actions ───────────────────────────────────────── */}
      {/* w-full en mobile; en desktop se limita a 62% para que el título
          nunca colapse, y flex-wrap deja que las toolbars largas envuelvan. */}
      {actions && (
        <div className="page-header__actions flex items-center gap-2 flex-wrap w-full sm:w-auto sm:max-w-[62%] sm:justify-end sm:pt-1">
          {actions}
        </div>
      )}
    </div>
  );
}
