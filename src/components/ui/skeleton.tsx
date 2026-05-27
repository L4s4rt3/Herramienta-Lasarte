import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-xl bg-[var(--glass-bg-strong)]", className)} {...props} />;
}

export { Skeleton };
