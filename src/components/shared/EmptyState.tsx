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
    <div className="rounded-[12px] border border-dashed border-primary/20 bg-gradient-to-b from-primary/[0.035] to-transparent px-5 py-14 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[12px] border border-primary/15 bg-primary/8 text-primary shadow-[0_10px_24px_-18px_hsl(var(--primary)/0.85)]">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-1 font-display text-lg font-semibold tracking-tight">{title}</h3>
      {description && <p className="mx-auto mb-5 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {actionLabel && onAction && (
        <Button onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
