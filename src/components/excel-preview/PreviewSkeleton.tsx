import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PreviewSkeletonProps {
  className?: string;
}

export function PreviewSkeleton({ className }: PreviewSkeletonProps) {
  return (
    <div className={cn("h-full flex flex-col gap-3 min-h-0", className)}>
      <div className="shrink-0 glass rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-14 rounded-md" />
          <Skeleton className="h-4 flex-1 max-w-md" />
        </div>
        <Skeleton className="h-3 w-2/3" />
      </div>

      <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass rounded-lg p-2.5 space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 glass rounded-xl overflow-hidden">
        <div className="px-3 py-2.5 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)]">
          <Skeleton className="h-3 w-full max-w-2xl" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-[var(--glass-border)]"
          >
            <Skeleton
              className="h-3"
              style={{ width: `${40 + ((i * 13) % 7) * 10}%` }}
            />
            <Skeleton
              className="h-3 ml-auto"
              style={{ width: `${8 + ((i * 7) % 4) * 4}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
