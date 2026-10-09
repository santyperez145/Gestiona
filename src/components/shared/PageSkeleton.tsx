import { Skeleton } from "@/components/ui/skeleton";
export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-in overflow-hidden rounded-[12px] border border-border/70 bg-card shadow-card fade-in duration-300">
      <div className="p-4 border-b border-border flex gap-3">
        {Array.from({ length: Math.min(cols, 4) }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-3 border-b border-border last:border-0">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="h-3 w-24 mb-2" />
          <Skeleton className="h-10 w-full rounded" />
        </div>
      ))}
      <Skeleton className="h-10 w-full rounded" />
    </div>
  );
}
