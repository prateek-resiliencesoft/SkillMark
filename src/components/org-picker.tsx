"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LAST_ORG_STORAGE_KEY } from "@/lib/active-org";
import { trpc } from "@/lib/trpc/client";
import {
  ArrowRight,
  Building2,
  FileText,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/** Only same-origin relative paths are allowed as the post-pick destination. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return "/dashboard";
  if (raw.startsWith("/organizations") || raw.startsWith("/org/new")) return "/dashboard";
  return raw;
}

/** Shown after every fresh login (and when the active org is missing/removed). */
export function OrgPicker({ next }: { next: string | null }) {
  const { orgs, setCurrentOrg, isLoading } = useOrg();
  const { locale } = useAppLocale();
  const isZh = locale === "zh";
  const { data: summary } = trpc.organization.pickerSummary.useQuery(undefined, {
    staleTime: 30_000,
  });
  const [query, setQuery] = useState("");
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  useEffect(() => {
    setLastUsed(localStorage.getItem(LAST_ORG_STORAGE_KEY));
  }, []);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? orgs.filter((o) => o.name.toLowerCase().includes(q)) : orgs;
    return [...list].sort((a, b) =>
      a.id === lastUsed ? -1 : b.id === lastUsed ? 1 : a.name.localeCompare(b.name),
    );
  }, [orgs, query, lastUsed]);

  const enter = (orgId: string) => {
    if (entering) return;
    setEntering(orgId);
    setCurrentOrg(orgId);
    // Full load so the dashboard (and project/org context) starts fresh in this org.
    window.location.href = safeNext(next);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">
          {isZh ? "选择组织" : "Choose an organization"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {isZh ? "选择你现在要工作的组织。" : "Pick where you want to work today."}
        </p>
      </div>

      {orgs.length > 4 && (
        <div className="relative mx-auto max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isZh ? "搜索组织…" : "Search organizations…"}
            className="pl-9"
            autoFocus
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {sorted.map((org) => {
          const counts = summary?.[org.id];
          const isLast = org.id === lastUsed;
          const busy = entering === org.id;
          return (
            <Card
              key={org.id}
              role="button"
              tabIndex={0}
              onClick={() => enter(org.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  enter(org.id);
                }
              }}
              className={`group relative cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isLast ? "border-primary ring-1 ring-primary/40" : ""
              } ${entering && !busy ? "pointer-events-none opacity-50" : ""}`}
            >
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg font-semibold text-primary">
                  {org.name.slice(0, 1).toUpperCase() || <Building2 className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{org.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {org.role}
                    </Badge>
                    {isLast && (
                      <Badge className="text-xs">{isZh ? "上次使用" : "Last used"}</Badge>
                    )}
                    {org.status === "SUSPENDED" && (
                      <Badge variant="destructive" className="text-xs">
                        {isZh ? "已暂停" : "Paused"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {counts ? counts.members : "–"} {isZh ? "成员" : "members"}
                    </span>
                    <span className="flex items-center gap-1">
                      <FolderKanban className="h-3.5 w-3.5" />
                      {counts ? counts.projects : "–"} {isZh ? "项目" : "projects"}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText className="h-3.5 w-3.5" />
                      {counts ? counts.interviews : "–"} {isZh ? "面试" : "interviews"}
                    </span>
                  </div>
                </div>
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                )}
              </CardContent>
            </Card>
          );
        })}

        <Link href="/org/new?create=1" className="block">
          <Card className="flex h-full cursor-pointer items-center justify-center border-dashed transition-colors hover:border-primary hover:bg-primary/5">
            <CardContent className="flex items-center gap-3 p-5 text-muted-foreground">
              <Plus className="h-5 w-5" />
              <span className="font-medium">
                {isZh ? "创建新组织" : "Create new organization"}
              </span>
            </CardContent>
          </Card>
        </Link>
      </div>

      {query && sorted.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          {isZh ? "没有匹配的组织。" : "No organizations match your search."}
        </p>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/organizations" className="underline-offset-4 hover:underline">
          {isZh ? "管理组织和项目" : "Manage organizations & projects"}
        </Link>
      </p>
    </div>
  );
}
