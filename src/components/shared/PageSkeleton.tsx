import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="animate-in fade-in duration-300">
      <div className="mb-6">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 mb-8">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-[12px] border border-border/70 bg-card p-4 shadow-card">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-6 w-28 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="rounded-[12px] border border-border/70 bg-card p-5 shadow-card lg:col-span-2">
          <Skeleton className="h-4 w-48 mb-4" />
          <Skeleton className="h-[220px] w-full rounded" />
        </div>
        <div className="rounded-[12px] border border-border/70 bg-card p-5 shadow-card">
          <Skeleton className="h-4 w-36 mb-4" />
          <Skeleton className="h-[200px] w-full rounded" />
        </div>
      </div>
    </div>
  );
}

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
