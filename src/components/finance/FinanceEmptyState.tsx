/**
 * FinanceEmptyState — Estado vacío estandarizado para Finance
 *
 * Uso en todas las páginas de Finance para consistencia visual
 */
import { LucideIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface FinanceEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: LucideIcon;
  };
}

export default function FinanceEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: FinanceEmptyStateProps) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 px-6">
        <div className="p-4 rounded-full bg-teal-500/10 mb-4">
          <Icon className="h-8 w-8 text-teal-600 dark:text-teal-400" />
        </div>
        <h3 className="text-lg font-semibold font-display mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground text-center max-w-md mb-6">{description}</p>
        {action && (
          <Button onClick={action.onClick} className="gap-2">
            {action.icon && <action.icon className="h-4 w-4" />}
            {action.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
