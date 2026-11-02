"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatLimit } from "@/lib/billing/catalog";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function OrgPlanSettingsPage() {
  const { currentOrg } = useOrg();
  const { locale } = useAppLocale();
  const isZh = locale === "zh";
  const { toast } = useToast();
  const search = useSearchParams();
  const utils = trpc.useUtils();

  const status = trpc.billing.status.useQuery(
    { organizationId: currentOrg?.id ?? "" },
    { enabled: !!currentOrg?.id, staleTime: 15_000 },
  );

  const checkout = trpc.billing.createCheckout.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => {
      toast({
        title: isZh ? "无法开始付款" : "Could not start checkout",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const portal = trpc.billing.createPortal.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => {
      toast({
        title: isZh ? "无法打开账单" : "Could not open billing",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const flag = search.get("checkout");
    if (flag === "success") {
      toast({
        title: isZh ? "计划已更新" : "Plan updated",
        description: isZh
          ? "如未立刻生效，请稍候刷新。"
          : "If it does not show yet, refresh in a moment.",
      });
      utils.billing.status.invalidate();
      utils.organization.list.invalidate();
    }
    if (flag === "cancelled") {
      toast({
        title: isZh ? "已取消" : "Checkout cancelled",
      });
    }
  }, [search, toast, isZh, utils]);

  if (!currentOrg) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {isZh ? "尚未选择组织" : "No organization selected"}
      </div>
    );
  }

  const isOwner = currentOrg.role === "OWNER";
  const busy = checkout.isPending || portal.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {isZh ? "计划与账单" : "Plan & billing"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isZh
            ? "查看当前用量上限，并在需要时升级。"
            : "See your current limits and upgrade when you need more room."}
        </p>
      </div>

      {status.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : status.isError || !status.data ? (
        <p className="text-sm text-muted-foreground">
          {isZh ? "无法加载计划信息。" : "Could not load plan details."}
        </p>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {isZh ? "当前计划" : "Current plan"}
                </CardTitle>
                <Badge variant="secondary">{status.data.planName}</Badge>
              </div>
              <CardDescription>{status.data.planBlurb}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <LimitStat
                label={isZh ? "人数" : "People"}
                value={status.data.limits.seatsLabel}
              />
              <LimitStat
                label={isZh ? "面试" : "Interviews"}
                value={status.data.limits.interviewsLabel}
              />
              <LimitStat
                label={isZh ? "项目" : "Projects"}
                value={status.data.limits.projectsLabel}
              />
            </CardContent>
          </Card>

          {!status.data.stripeEnabled ? (
            <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {isZh
                ? "此实例未开启在线付款。计划可由平台管理员调整，或继续使用自托管无限制模式。"
                : "Online billing is not enabled on this server. A platform admin can change your plan, or keep using self-hosted with no caps."}
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            {status.data.catalog
              .filter((p) => p.id !== "SELF_HOSTED")
              .map((p) => {
                const isCurrent = p.current;
                return (
                  <Card
                    key={p.id}
                    className={cn(
                      "transition-colors",
                      isCurrent && "border-primary/40 bg-primary/[0.03]",
                    )}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">{p.name}</CardTitle>
                        {isCurrent ? (
                          <Badge className="font-normal">
                            {isZh ? "当前" : "Current"}
                          </Badge>
                        ) : null}
                      </div>
                      <CardDescription>{p.blurb}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        <li>
                          {isZh ? "人数" : "People"}:{" "}
                          {formatLimit(p.limits.seats)}
                        </li>
                        <li>
                          {isZh ? "面试" : "Interviews"}:{" "}
                          {formatLimit(p.limits.interviews)}
                        </li>
                        <li>
                          {isZh ? "项目" : "Projects"}:{" "}
                          {formatLimit(p.limits.projects)}
                        </li>
                      </ul>
                      {isOwner &&
                      p.purchaseable &&
                      !isCurrent &&
                      (p.id === "PRO" || p.id === "ENTERPRISE") ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            checkout.mutate({
                              organizationId: currentOrg.id,
                              plan: p.id as "PRO" | "ENTERPRISE",
                            })
                          }
                        >
                          {checkout.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          {isZh ? "升级" : "Upgrade"}
                        </Button>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
          </div>

          {isOwner && status.data.stripeEnabled && status.data.hasCustomer ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                portal.mutate({ organizationId: currentOrg.id })
              }
            >
              {portal.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {isZh ? "管理付款方式" : "Manage payment methods"}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function LimitStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
