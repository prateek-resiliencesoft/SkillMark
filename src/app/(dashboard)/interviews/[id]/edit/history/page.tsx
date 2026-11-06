"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getSessionOverallScore } from "@/lib/session-score";
import { trpc } from "@/lib/trpc/client";
import { useParams } from "next/navigation";

export default function InterviewHistoryPage() {
  const params = useParams<{ id: string }>();
  const history = trpc.session.listHistory.useQuery({ interviewId: params.id });

  if (history.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const rows = history.data?.sessions ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">History</h2>
        <p className="text-sm text-muted-foreground">
          Candidates whose recordings and transcript were deleted. Only the name and score remain.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No deleted interview data yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Candidate</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Deleted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const score = getSessionOverallScore(
                  row.insights as {
                    questionEvaluations?: { score?: number | string | null }[] | null;
                    criteriaEvaluations?: { score?: number | string | null }[] | null;
                  } | null,
                );
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.participantName || "Anonymous"}</p>
                      {row.participantEmail ? (
                        <p className="text-xs text-muted-foreground">{row.participantEmail}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {score == null ? "No score" : score.toFixed(1)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {row.status === "COMPLETED" ? "Completed" : row.status === "IN_PROGRESS" ? "In progress" : row.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(row.dataArchivedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
