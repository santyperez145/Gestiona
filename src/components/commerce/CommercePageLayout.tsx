/**
 * CommercePageLayout — Layout completo para páginas de Commerce
 *
 * Reemplaza PageHeader con diseño específico de Commerce
 * Aplica consistencia visual a todas las páginas de Commerce
 */
import { ReactNode } from "react";
import CommercePageHeader from "./CommercePageHeader";
import { LucideIcon } from "lucide-react";

interface CommercePageLayoutProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
  tabs?: { to: string; label: string; icon?: LucideIcon }[];
  breadcrumbs?: { label: string; to?: string }[];
  badge?: string;
  children: ReactNode;
}

export default function CommercePageLayout({
  icon,
  title,
  description,
  actions,
  tabs,
  breadcrumbs,
  badge,
  children,
}: CommercePageLayoutProps) {
  return (
    <div className="space-y-6">
      <CommercePageHeader
        icon={icon}
        title={title}
        description={description}
        actions={actions}
        tabs={tabs}
        breadcrumbs={breadcrumbs}
        badge={badge}
      />
      {children}
    </div>
  );
}
