"use client";

import {
  PageHeader,
  Panel,
  StatusPill,
  TacticalButton,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Bot,
  BrainCircuit,
  KeyRound,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type ProviderId = "openai" | "gemini" | "nvidia" | "anthropic" | "grok" | "custom";

export default function AdminOrgAiPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const org = trpc.platform.getOrganization.useQuery({ id });
  const ai = trpc.aiSettings.get.useQuery({ organizationId: id });

  const [slots, setSlots] = useState<Record<string, string[]>>({});
  const [baseUrl, setBaseUrl] = useState("");
  const [routing, setRouting] = useState<Record<string, ProviderId[]>>({});

  useEffect(() => {
    if (!ai.data) return;
    const next: Record<string, string[]> = {};
    for (const p of ai.data.providers) {
      next[p.id] = Array.from({ length: p.maxKeys }, () => "");
    }
    setSlots(next);
    setBaseUrl(
      ai.data.providers.find((p) => p.id === "custom")?.baseUrl ?? "",
    );
    setRouting(ai.data.routing as Record<string, ProviderId[]>);
  }, [ai.data]);

  const saveKeys = trpc.aiSettings.saveProviderKeys.useMutation({
    onSuccess: () => {
      toast({ title: "Provider keys saved successfully" });
      utils.aiSettings.get.invalidate({ organizationId: id });
    },
    onError: (err) =>
      toast({
        title: "Could not save keys",
        description: err.message,
        variant: "destructive",
      }),
  });

  const clearProvider = trpc.aiSettings.clearProvider.useMutation({
    onSuccess: () => {
      toast({ title: "Provider credentials cleared" });
      utils.aiSettings.get.invalidate({ organizationId: id });
    },
    onError: (err) =>
      toast({
        title: "Could not clear provider",
        description: err.message,
        variant: "destructive",
      }),
  });

  const saveRouting = trpc.aiSettings.saveRouting.useMutation({
    onSuccess: () => {
      toast({ title: "Inference routing pipeline updated" });
      utils.aiSettings.get.invalidate({ organizationId: id });
    },
    onError: (err) =>
      toast({
        title: "Could not save routing",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (org.isLoading || ai.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header & Breadcrumbs */}
      <PageHeader
        breadcrumbs={[
          { label: "Organizations", href: "/admin/organizations" },
          { label: org.data?.name ?? "Organization", href: `/admin/organizations/${id}` },
          { label: "AI Infrastructure" },
        ]}
        title="AI Models & Provider Keys"
        description="Override foundation model credentials, API endpoints, and inference routing rules specifically for this tenant."
      />

      {/* Provider API Key Slots */}
      <div className="space-y-4">
        {(ai.data?.providers ?? []).map((p) => (
          <Panel
            key={p.id}
            kicker="AI Provider"
            title={
              <div className="flex items-center gap-2">
                <span className="font-heading text-sm font-bold capitalize text-foreground">
                  {p.id}
                </span>
                <span className="rounded border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {p.keyCount}/{p.maxKeys} slots active
                </span>
                {p.configured ? (
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                    Configured
                  </span>
                ) : (
                  <span className="rounded border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Fallback Defaults
                  </span>
                )}
                {p.apiKeyHint ? (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    Hint: {p.apiKeyHint}
                  </span>
                ) : null}
              </div>
            }
            description={`Configure rotating API keys for ${p.id}. Leave existing slots empty to maintain currently stored secrets.`}
          >
            <div className="space-y-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {(slots[p.id] ?? []).map((value, idx) => (
                  <div key={`${p.id}-${idx}`} className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      type="password"
                      placeholder={`Key slot #${idx + 1} (leave empty to keep unchanged)`}
                      value={value}
                      onChange={(e) =>
                        setSlots((prev) => {
                          const list = [...(prev[p.id] ?? [])];
                          list[idx] = e.target.value;
                          return { ...prev, [p.id]: list };
                        })
                      }
                      className="h-8 pl-9 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                    />
                  </div>
                ))}
              </div>

              {p.id === "custom" ? (
                <div className="space-y-1 text-xs">
                  <span className="text-muted-foreground font-medium">Custom OpenAI-Compatible Base URL</span>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.together.xyz/v1 or local endpoint"
                    className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40 dark:border-white/[0.04]">
                <TacticalButton
                  size="sm"
                  loading={saveKeys.isPending && saveKeys.variables?.providerId === p.id}
                  onClick={() =>
                    saveKeys.mutate({
                      organizationId: id,
                      providerId: p.id as ProviderId,
                      keySlots: slots[p.id] ?? [],
                      baseUrl: p.id === "custom" ? baseUrl || null : undefined,
                    })
                  }
                  className="h-8 text-xs gap-1.5"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Save {p.id} Keys</span>
                </TacticalButton>

                <TacticalButton
                  size="sm"
                  variant="outline"
                  loading={clearProvider.isPending && clearProvider.variables?.providerId === p.id}
                  onClick={() =>
                    clearProvider.mutate({
                      organizationId: id,
                      providerId: p.id as ProviderId,
                    })
                  }
                  className="h-8 text-xs text-rose-500 hover:text-rose-600 gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Purge Provider Keys</span>
                </TacticalButton>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      {/* Task Routing Pipeline Panel */}
      <Panel
        kicker="Model Dispatcher"
        title="Inference Task Routing"
        description="Priority order of model providers for question generation, transcript evaluation, feedback synthesis, and voice avatars. Comma-separated order (first = primary fallback)."
      >
        <div className="space-y-4">
          <div className="space-y-3">
            {(ai.data?.taskKinds ?? []).map((kind) => (
              <label key={kind} className="block space-y-1 text-xs">
                <span className="font-semibold capitalize text-foreground">{kind} Pipeline</span>
                <Input
                  value={(routing[kind] ?? []).join(", ")}
                  onChange={(e) => {
                    const list = e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean) as ProviderId[];
                    setRouting((prev) => ({ ...prev, [kind]: list }));
                  }}
                  className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                />
              </label>
            ))}
          </div>

          <div className="pt-2 flex justify-end">
            <TacticalButton
              size="sm"
              loading={saveRouting.isPending}
              onClick={() =>
                saveRouting.mutate({
                  organizationId: id,
                  routing: routing as never,
                })
              }
              className="gap-1.5 text-xs h-8"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Routing Pipeline</span>
            </TacticalButton>
          </div>
        </div>
      </Panel>
    </div>
  );
}
