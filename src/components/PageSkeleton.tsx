import { Skeleton } from "@/components/ui/skeleton";

interface PageSkeletonProps {
  /** Number of card rows to show (default: 3) */
  rows?: number;
  /** Show a header skeleton above cards (default: true) */
  showHeader?: boolean;
}

/**
 * Reusable skeleton layout used across pages that are loading.
 * Renders a simple set of skeleton blocks mimicking card layouts.
 */
export function PageSkeleton({ rows = 3, showHeader = true }: PageSkeletonProps) {
  return (
    <div className="space-y-6 animate-pulse">
      {showHeader && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
      )}
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-10 w-full" />
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={`kpi-${i}`} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
