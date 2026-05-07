import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: { label: string; variant?: "default" | "success" | "warning" | "destructive" };
}

const badgeStyles = {
  default: "bg-primary/15 text-primary border border-primary/20",
  success: "bg-success/15 text-success border border-success/20",
  warning: "bg-warning/15 text-warning border border-warning/20",
  destructive: "bg-destructive/15 text-destructive border border-destructive/20",
};

export default function PageHeader({ icon: Icon, title, description, actions, badge }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-display font-bold tracking-tight">{title}</h1>
            {badge && (
              <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${badgeStyles[badge.variant ?? "default"]}`}>
                {badge.label}
              </span>
            )}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
