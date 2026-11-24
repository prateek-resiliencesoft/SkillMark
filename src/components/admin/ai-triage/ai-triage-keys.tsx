"use client";

import { Panel, TacticalButton } from "@/components/admin/admin-ui";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { KeyRound, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";

type ProviderId = "openai" | "gemini" | "nvidia" | "anthropic" | "groq" | "custom";

/**
 * Platform LLM API keys for superadmin triage / chat (no org context).
 * Env keys remain fallback when slots empty.
 */
export function AiTriageKeysPanel() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const ai = trpc.bugTriage.platformAiGet.useQuery(undefined, { staleTime: 15_000 });

  const [slots, setSlots] = useState<Record<string, string[]>>({});
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    if (!ai.data || !("providers" in ai.data) || !Array.isArray(ai.data.providers)) return;
    const next: Record<string, string[]> = {};
    for (const p of ai.data.providers) {
      next[p.id] = Array.from({ length: p.maxKeys }, () => "");
    }
    setSlots(next);
    setBaseUrl(ai.data.providers.find((p) => p.id === "custom")?.baseUrl ?? "");
  }, [ai.data]);

  const saveKeys = trpc.bugTriage.platformAiSaveKeys.useMutation({
    onSuccess: () => {
      toast({ title: "Platform provider keys saved" });
      utils.bugTriage.platformAiGet.invalidate();
    },
    onError: (err) =>
      toast({ title: "Could not save keys", description: err.message, variant: "destructive" }),
  });

  const clearProvider = trpc.bugTriage.platformAiClearProvider.useMutation({
    onSuccess: () => {
      toast({ title: "Provider keys cleared" });
      utils.bugTriage.platformAiGet.invalidate();
    },
    onError: (err) =>
      toast({ title: "Could not clear provider", description: err.message, variant: "destructive" }),
  });

  if (ai.isLoading) {
    return <Panel className="p-5 text-sm text-muted-foreground">Loading platform AI keys…</Panel>;
  }

  const providers = ai.data && "providers" in ai.data ? ai.data.providers : [];
  const envFallback = ai.data && "envFallback" in ai.data ? ai.data.envFallback : {};

  if (!providers.length) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-2">
        <p>
          Platform AI key storage is not ready. Apply <code>db/init/45-platform-ai-providers.sql</code>{" "}
          (or <code>npm run db:migrate</code>).
        </p>
        <p className="text-muted-foreground">
          Until then triage uses <code>.env</code> keys only (
          {Object.entries(envFallback as Record<string, boolean>)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(", ") || "none detected"}
          ).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Panel className="p-4 text-sm text-muted-foreground">
        Keys here power <strong className="text-foreground">AI Triage</strong> classify + chat (no org).
        Empty slots keep stored secrets. If no platform key is set,{" "}
        <code className="text-xs">.env</code> fallbacks apply.
      </Panel>

      {providers.map((p) => {
        const envOn = !!(envFallback as Record<string, boolean>)[p.id];
        return (
          <Panel
            key={p.id}
            kicker="Platform provider"
            title={
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-heading text-sm font-bold capitalize">{p.id}</span>
                <span className="rounded border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {p.keyCount}/{p.maxKeys} slots
                </span>
                {p.configured ? (
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                    Configured
                  </span>
                ) : envOn ? (
                  <span className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                    Env fallback
                  </span>
                ) : (
                  <span className="rounded border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                    Not set
                  </span>
                )}
                {p.apiKeyHint ? (
                  <span className="text-[11px] font-mono text-muted-foreground">Hint: {p.apiKeyHint}</span>
                ) : null}
              </div>
            }
            description={`Rotating keys for ${p.id}. Leave a slot empty to keep the current secret.`}
          >
            <div className="space-y-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                {(slots[p.id] ?? []).map((value, idx) => (
                  <div key={`${p.id}-${idx}`} className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={`Key slot #${idx + 1} (empty = keep)`}
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
                  <span className="font-medium text-muted-foreground">Custom OpenAI-compatible base URL</span>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.together.xyz/v1"
                    className="h-8 text-xs font-mono border-border/70 dark:border-white/[0.08] dark:bg-zinc-900"
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2 dark:border-white/[0.04]">
                <TacticalButton
                  size="sm"
                  loading={saveKeys.isPending && saveKeys.variables?.providerId === p.id}
                  onClick={() =>
                    saveKeys.mutate({
                      providerId: p.id as ProviderId,
                      keySlots: slots[p.id] ?? [],
                      baseUrl: p.id === "custom" ? baseUrl || null : undefined,
                    })
                  }
                  className="h-8 gap-1.5 text-xs"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save {p.id} keys
                </TacticalButton>
                <TacticalButton
                  size="sm"
                  variant="outline"
                  loading={clearProvider.isPending && clearProvider.variables?.providerId === p.id}
                  onClick={() => clearProvider.mutate({ providerId: p.id as ProviderId })}
                  className="h-8 gap-1.5 text-xs text-rose-500 hover:text-rose-600"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Clear
                </TacticalButton>
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
