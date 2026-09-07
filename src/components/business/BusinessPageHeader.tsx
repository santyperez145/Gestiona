/**
 * BusinessPageHeader — Header estandarizado para páginas de Business
 *
 * Uso en todas las páginas de Business para consistencia visual
 */
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Tab {
  to: string;
  label: string;
  icon?: LucideIcon;
}

interface Breadcrumb {
  label: string;
  to?: string;
}

interface BusinessPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  tabs?: Tab[];
  breadcrumbs?: Breadcrumb[];
  badge?: string;
}

export default function BusinessPageHeader({
  icon: Icon,
  title,
  description,
  actions,
  tabs,
  breadcrumbs,
  badge,
}: BusinessPageHeaderProps) {
  return (
    <div className="space-y-4">
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          {breadcrumbs.map((crumb, index) => (
            <div key={index} className="flex items-center gap-2">
              {crumb.to ? (
                <a href={crumb.to} className="hover:text-primary transition-colors">
                  {crumb.label}
                </a>
              ) : (
                <span>{crumb.label}</span>
              )}
              {index < breadcrumbs.length - 1 && <span>/</span>}
            </div>
          ))}
        </nav>
      )}

      {/* Header Principal */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold font-display">{title}</h1>
              {badge && (
                <Badge variant="secondary" className="text-xs">
                  {badge}
                </Badge>
              )}
            </div>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Tabs */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border/50 pb-0">
          {tabs.map((tab) => (
            <a
              key={tab.to}
              href={tab.to}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-primary border-b-2 border-transparent hover:border-primary transition-all"
            >
              {tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
