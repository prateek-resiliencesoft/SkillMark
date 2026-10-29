"use client";

import { useProject } from "@/components/project-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc/client";
import { CalendarDays, Files, Plus } from "lucide-react";
import Link from "next/link";

export default function BatchesPage() {
  const { currentProject } = useProject();
  const batches = trpc.batch.list.useQuery({ projectId: currentProject?.id }, { enabled: !!currentProject?.id });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Batches</h1>
          <p className="text-muted-foreground">Bulk interviews generated from candidate CVs.</p>
        </div>
        <Button asChild>
          <Link href="/interviews/new?tab=bulk">
            <Plus className="mr-2 h-4 w-4" />
            New batch
          </Link>
        </Button>
      </div>

      {batches.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !batches.data?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Files className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No batches yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Upload a stack of CVs and Skillmark creates a personalised interview and private link for each candidate.
            </p>
            <Button asChild variant="outline" className="mt-2">
              <Link href="/interviews/new?tab=bulk">Create your first batch</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {batches.data.map((b) => {
            const pct = b.counts.total ? Math.round((b.counts.completed / b.counts.total) * 100) : 0;
            return (
              <Link key={b.id} href={`/batches/${b.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-wrap items-center gap-6 p-5">
                    <div className="min-w-[200px] flex-1">
                      <p className="font-semibold">{b.name}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {new Date(b.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        {b.roleDescription && <span className="truncate">· {b.roleDescription.slice(0, 80)}</span>}
                      </p>
                    </div>
                    <Stat label="Candidates" value={b.counts.total} />
                    <Stat label="Invited" value={b.invited} />
                    <Stat label="Completed" value={b.counts.completed} />
                    <Stat label="Pending" value={b.counts.total - b.counts.completed - b.counts.disqualified} />
                    <div className="w-32">
                      <Progress value={pct} className="h-2" />
                      <p className="mt-1 text-right text-xs text-muted-foreground">{pct}% done</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
