import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileQuestion,
  FilterX,
  GitCompareArrows,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkspaceStateKind } from '@/components/shared/workspaceStateContract';
import { cn } from '@/lib/utils';

interface WorkspaceStateProps {
  kind: WorkspaceStateKind;
  title: string;
  description?: string;
  icon?: LucideIcon;
  layout?: 'panel' | 'embedded' | 'banner';
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
  loadingRows?: number;
}

const ICONS: Record<WorkspaceStateKind, LucideIcon> = {
  'initial-loading': Loader2,
  refreshing: RefreshCw,
  'empty-first-use': FileQuestion,
  'empty-filtered': FilterX,
  'error-recoverable': CircleAlert,
  permission: LockKeyhole,
  offline: WifiOff,
  stale: Clock3,
  partial: TriangleAlert,
  conflict: GitCompareArrows,
  'rate-limited': ShieldAlert,
  success: CheckCircle2,
};

const TONES: Record<WorkspaceStateKind, { border: string; background: string; foreground: string; icon: string }> = {
  'initial-loading': { border: 'border-border/70', background: 'bg-card', foreground: 'text-muted-foreground', icon: 'bg-muted text-muted-foreground' },
  refreshing: { border: 'border-blue-500/20', background: 'bg-blue-500/[0.04]', foreground: 'text-blue-700 dark:text-blue-300', icon: 'bg-blue-500/10 text-blue-600 dark:text-blue-300' },
  'empty-first-use': { border: 'border-primary/20', background: 'bg-primary/[0.035]', foreground: 'text-foreground', icon: 'bg-primary/10 text-primary' },
  'empty-filtered': { border: 'border-border/80', background: 'bg-muted/15', foreground: 'text-foreground', icon: 'bg-muted text-muted-foreground' },
  'error-recoverable': { border: 'border-destructive/30', background: 'bg-destructive/[0.045]', foreground: 'text-destructive', icon: 'bg-destructive/10 text-destructive' },
  permission: { border: 'border-amber-500/25', background: 'bg-amber-500/[0.045]', foreground: 'text-amber-700 dark:text-amber-300', icon: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  offline: { border: 'border-amber-500/25', background: 'bg-amber-500/[0.045]', foreground: 'text-amber-700 dark:text-amber-300', icon: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  stale: { border: 'border-amber-500/25', background: 'bg-amber-500/[0.045]', foreground: 'text-amber-700 dark:text-amber-300', icon: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  partial: { border: 'border-amber-500/25', background: 'bg-amber-500/[0.045]', foreground: 'text-amber-700 dark:text-amber-300', icon: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  conflict: { border: 'border-destructive/30', background: 'bg-destructive/[0.045]', foreground: 'text-destructive', icon: 'bg-destructive/10 text-destructive' },
  'rate-limited': { border: 'border-amber-500/25', background: 'bg-amber-500/[0.045]', foreground: 'text-amber-700 dark:text-amber-300', icon: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  success: { border: 'border-emerald-500/25', background: 'bg-emerald-500/[0.045]', foreground: 'text-emerald-700 dark:text-emerald-300', icon: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
};

const ASSERTIVE_STATES = new Set<WorkspaceStateKind>(['error-recoverable', 'offline', 'conflict']);

export default function WorkspaceState({
  kind,
  title,
  description,
  icon: IconOverride,
  layout = 'panel',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className,
  loadingRows = 4,
}: WorkspaceStateProps) {
  const tone = TONES[kind];

  if (kind === 'initial-loading') {
    return (
      <div
        data-workspace-state={kind}
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn(
          'overflow-hidden',
          layout === 'panel' && 'rounded-[12px] border border-border/70 bg-card shadow-card',
          layout === 'embedded' && 'bg-card',
          layout === 'banner' && 'rounded-[10px] border border-border/70 bg-card p-3',
          className,
        )}
      >
        <span className="sr-only">{title}</span>
        <div aria-hidden="true" className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
          </div>
          {Array.from({ length: loadingRows }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 border-t border-border/50 pt-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-[9px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const Icon = IconOverride || ICONS[kind];
  const isBanner = layout === 'banner';
  const isEmbedded = layout === 'embedded';
  const role = ASSERTIVE_STATES.has(kind) ? 'alert' : 'status';

  return (
    <div
      data-workspace-state={kind}
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        'border',
        tone.border,
        tone.background,
        isBanner ? 'flex items-start gap-3 rounded-[10px] p-3.5' : 'flex flex-col items-center justify-center px-6 py-12 text-center',
        !isBanner && !isEmbedded && 'rounded-[12px] border-dashed shadow-card',
        isEmbedded && 'border-x-0 border-b-0',
        className,
      )}
    >
      <span className={cn('flex shrink-0 items-center justify-center', tone.icon, isBanner ? 'h-8 w-8 rounded-[8px]' : 'h-12 w-12 rounded-[11px]')}>
        <Icon className={cn(isBanner ? 'h-4 w-4' : 'h-5 w-5', kind === 'refreshing' && 'animate-spin')} aria-hidden="true" />
      </span>
      <div className={cn('min-w-0', !isBanner && 'mt-3 max-w-lg')}>
        <p className={cn('font-semibold', tone.foreground, isBanner ? 'text-sm' : 'font-display text-base')}>{title}</p>
        {description && <p className={cn('leading-relaxed text-muted-foreground', isBanner ? 'mt-0.5 text-xs' : 'mt-1.5 text-sm')}>{description}</p>}
        {(actionLabel && onAction || secondaryActionLabel && onSecondaryAction) && (
          <div className={cn('flex flex-wrap gap-2', isBanner ? 'mt-2.5' : 'mt-5 justify-center')}>
            {actionLabel && onAction && <Button size="sm" onClick={onAction}>{actionLabel}</Button>}
            {secondaryActionLabel && onSecondaryAction && <Button size="sm" variant="outline" onClick={onSecondaryAction}>{secondaryActionLabel}</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
