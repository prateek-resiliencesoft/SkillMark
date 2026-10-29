import { Skeleton } from "@/components/ui/skeleton";

export default function QuestionsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="h-4 w-64 rounded-md" />
        </div>
        <Skeleton className="h-10 w-36 rounded-xl" />
      </div>

      {/* Segmented View Switcher Tabs */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-40 rounded-lg" />
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 flex-1 min-w-[200px] rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>

      {/* Questions Table Skeleton */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        {/* Table Header */}
        <div className="flex items-center border-b border-border/60 bg-muted/30 px-4 py-3 gap-4">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-44 rounded" />
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-4 w-32 rounded hidden sm:block" />
          <Skeleton className="h-4 w-24 rounded hidden md:block" />
          <Skeleton className="h-4 w-10 rounded ml-auto" />
        </div>

        {/* 8 Table Rows */}
        <div className="divide-y divide-border/40">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center px-4 py-3.5 gap-4 hover:bg-muted/10 transition-colors"
            >
              <Skeleton className="h-4 w-4 rounded shrink-0" />
              <div className="space-y-1.5 flex-1 min-w-[180px]">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded hidden sm:block" />
              </div>
              <Skeleton className="h-6 w-24 rounded-full shrink-0" />
              <Skeleton className="h-4 w-28 rounded hidden sm:block shrink-0" />
              <Skeleton className="h-4 w-20 rounded hidden md:block shrink-0" />
              <Skeleton className="h-7 w-7 rounded-md shrink-0 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
