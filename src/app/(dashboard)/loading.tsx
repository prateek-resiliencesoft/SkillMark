import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardRootLoading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top subtle indeterminate pulse bar */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted/40">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/40" />
      </div>

      {/* Universal Page Header Skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44 rounded-lg" />
          <Skeleton className="h-4 w-64 rounded-md" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Universal Content Skeletons */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40 rounded" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="space-y-3 pt-2">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
