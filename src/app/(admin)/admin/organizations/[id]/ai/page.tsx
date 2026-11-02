"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type ProviderId = "openai" | "gemini" | "nvidia" | "anthropic" | "custom";

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
      toast({ title: "Provider keys saved" });
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
      toast({ title: "Provider cleared" });
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
      toast({ title: "Routing saved" });
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
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/admin/organizations/${id}`}>← {org.data?.name ?? "Organization"}</Link>
        </Button>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          AI settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Same provider keys and task routing as the user panel AI page.
          Leave a slot blank to keep the existing key.
        </p>
      </div>

      <section className="space-y-4">
        {(ai.data?.providers ?? []).map((p) => (
          <div key={p.id} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium capitalize">{p.id}</p>
              <Badge variant="outline" className="text-[10px]">
                {p.keyCount}/{p.maxKeys} keys
              </Badge>
              {p.configured ? (
                <Badge className="text-[10px]">Configured</Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  Empty
                </Badge>
              )}
              {p.apiKeyHint ? (
                <span className="text-xs text-muted-foreground">
                  Last hint {p.apiKeyHint}
                </span>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(slots[p.id] ?? []).map((value, idx) => (
                <Input
                  key={`${p.id}-${idx}`}
                  type="password"
                  placeholder={`Key slot ${idx + 1}`}
                  value={value}
                  onChange={(e) =>
                    setSlots((prev) => {
                      const list = [...(prev[p.id] ?? [])];
                      list[idx] = e.target.value;
                      return { ...prev, [p.id]: list };
                    })
                  }
                />
              ))}
            </div>
            {p.id === "custom" ? (
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="Custom base URL"
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={saveKeys.isPending}
                onClick={() =>
                  saveKeys.mutate({
                    organizationId: id,
                    providerId: p.id as ProviderId,
                    keySlots: slots[p.id] ?? [],
                    baseUrl: p.id === "custom" ? baseUrl || null : undefined,
                  })
                }
              >
                Save {p.id}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={clearProvider.isPending}
                onClick={() =>
                  clearProvider.mutate({
                    organizationId: id,
                    providerId: p.id as ProviderId,
                  })
                }
              >
                Clear
              </Button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="text-sm font-medium">Task routing</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Comma-separated provider order (first = primary). Valid ids:{" "}
            {(ai.data?.providers ?? []).map((p) => p.id).join(", ")}.
          </p>
        </div>
        <div className="space-y-3">
          {(ai.data?.taskKinds ?? []).map((kind) => (
            <label key={kind} className="block space-y-1.5 text-xs">
              <span className="capitalize text-muted-foreground">{kind}</span>
              <Input
                value={(routing[kind] ?? []).join(", ")}
                onChange={(e) => {
                  const list = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean) as ProviderId[];
                  setRouting((prev) => ({ ...prev, [kind]: list }));
                }}
              />
            </label>
          ))}
        </div>
        <Button
          size="sm"
          disabled={saveRouting.isPending}
          onClick={() =>
            saveRouting.mutate({
              organizationId: id,
              routing: routing as never,
            })
          }
        >
          Save routing
        </Button>
      </section>
    </div>
  );
}
