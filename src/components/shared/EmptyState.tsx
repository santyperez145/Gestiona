import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="text-center py-16 px-4">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
        <Icon className="w-8 h-8 text-muted-foreground/50" />
      </div>
      <h3 className="text-lg font-display font-semibold mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">{description}</p>}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="gradient-gold text-primary-foreground font-semibold shadow-gold">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
