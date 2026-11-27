"use client";

import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronDown, Key, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/** Client-safe copies — do not import `@/lib/ai/credentials` (server-only). */
type AiProviderId = "openai" | "gemini" | "nvidia" | "anthropic" | "groq" | "custom";
type AiTaskKind =
  | "screening"
  | "standard"
  | "heavy"
  | "interview"
  | "report"
  | "resume"
  | "generate"
  | "voice"
  | "round2_live"
  | "round2_scoring"
  | "round2_report"
  | "round2_transcript";
type Hop = { provider: AiProviderId; model: string };

const PROVIDERS: AiProviderId[] = ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"];

export default function AiStudioPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const canEdit = currentOrg?.role === "OWNER" || currentOrg?.role === "ADMIN";
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const settings = trpc.aiSettings.get.useQuery({ organizationId: orgId }, { enabled: !!orgId });
  const presets = trpc.aiSettings.listSuggestedPresets.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId },
  );
  const catalog = trpc.aiSettings.listCatalog.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId },
  );

  const [taskModels, setTaskModels] = useState<Partial<Record<AiTaskKind, Hop[]>>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTask, setActiveTask] = useState<AiTaskKind>("voice");

  useEffect(() => {
    if (settings.data?.taskModels) setTaskModels(settings.data.taskModels);
  }, [settings.data?.taskModels]);

  const save = trpc.aiSettings.saveTaskModels.useMutation({
    onSuccess: async () => {
      toast({ title: "AI Studio saved" });
      await utils.aiSettings.get.invalidate({ organizationId: orgId });
    },
    onError: (e) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const applyPreset = trpc.aiSettings.applyPreset.useMutation({
    onSuccess: async (res) => {
      setTaskModels(res.taskModels ?? {});
      toast({ title: "Preset applied" });
      await utils.aiSettings.get.invalidate({ organizationId: orgId });
    },
    onError: (e) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const testProvider = trpc.aiSettings.testProvider.useMutation({
    onSuccess: async (res) => {
      toast({ title: "Models refreshed", description: `${res.count} models listed` });
      await utils.aiSettings.listCatalog.invalidate();
    },
    onError: (e) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const modules = settings.data?.modules ?? [];
  const product = modules.filter((m) => m.group === "product");
  const advanced = modules.filter((m) => m.group === "advanced");

  const suggestions = useMemo(() => {
    const models = catalog.data?.models ?? [];
    return models
      .filter((m) => m.rankLabel === "cheap" || m.rankLabel === "balanced" || m.rankLabel === "best")
      .filter((m) => {
        // listCatalog without task returns all "other"; refetch per task via client filter on suitableTasks
        const tasks = m.suitableTasks ?? [];
        return !tasks.length || tasks.includes(activeTask);
      })
      .slice(0, 12);
  }, [catalog.data?.models, activeTask]);

  const taskCatalog = trpc.aiSettings.listCatalog.useQuery(
    { organizationId: orgId, task: activeTask },
    { enabled: !!orgId },
  );

  const hopsFor = (task: AiTaskKind): Hop[] => taskModels[task] ?? [];

  const setHops = (task: AiTaskKind, hops: Hop[]) => {
    setTaskModels((prev) => ({ ...prev, [task]: hops }));
  };

  const addHop = (task: AiTaskKind) => {
    const configured = settings.data?.providers.find((p) => p.configured)?.id ?? "openai";
    setHops(task, [...hopsFor(task), { provider: configured, model: settings.data?.defaultModels?.[configured] || "gpt-4o-mini" }]);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Assign provider + model failover per section. Prices in ₹ (catalog as of{" "}
            {catalog.data?.pricesAsOf
              ? new Date(catalog.data.pricesAsOf).toLocaleDateString("en-IN")
              : "seed"}
            ). Keys live in{" "}
            <Link href="/settings/ai" className="font-medium text-foreground underline">
              AI Providers
            </Link>
            .
          </p>
        </div>
        {canEdit ? (
          <Button
            disabled={save.isLoading}
            onClick={() => save.mutate({ organizationId: orgId, taskModels })}
          >
            {save.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Studio
          </Button>
        ) : null}
      </div>

      {(presets.data?.length ?? 0) > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-4 w-4" /> Suggested templates
          </h2>
          <div className="flex flex-wrap gap-2">
            {presets.data!.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit || applyPreset.isLoading}
                onClick={() => applyPreset.mutate({ organizationId: orgId, presetId: p.id })}
                title={p.blurb || p.name}
              >
                {p.name}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Refresh models
        </h2>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((id) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canEdit || testProvider.isLoading}
              onClick={() => testProvider.mutate({ organizationId: orgId, providerId: id })}
            >
              <Key className="mr-1.5 h-3.5 w-3.5" />
              {id}
            </Button>
          ))}
        </div>
      </section>

      <ModuleList
        title="Product modules"
        modules={product}
        hopsFor={hopsFor}
        setHops={setHops}
        addHop={addHop}
        canEdit={!!canEdit}
        catalogModels={taskCatalog.data?.models ?? catalog.data?.models ?? []}
        onFocusTask={setActiveTask}
        activeTask={activeTask}
        suggestions={taskCatalog.data?.models?.filter((m) => m.rankLabel !== "other") ?? suggestions}
      />

      <div>
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <ChevronDown className={cn("h-4 w-4 transition", showAdvanced && "rotate-180")} />
          Advanced · follow-up depths
        </button>
        {showAdvanced ? (
          <div className="mt-4">
            <ModuleList
              title=""
              modules={advanced}
              hopsFor={hopsFor}
              setHops={setHops}
              addHop={addHop}
              canEdit={!!canEdit}
              catalogModels={taskCatalog.data?.models ?? catalog.data?.models ?? []}
              onFocusTask={setActiveTask}
              activeTask={activeTask}
              suggestions={taskCatalog.data?.models?.filter((m) => m.rankLabel !== "other") ?? []}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ModuleList({
  title,
  modules,
  hopsFor,
  setHops,
  addHop,
  canEdit,
  catalogModels,
  onFocusTask,
  activeTask,
  suggestions,
}: {
  title: string;
  modules: { id: string; title: string; hint: string; task: AiTaskKind }[];
  hopsFor: (t: AiTaskKind) => Hop[];
  setHops: (t: AiTaskKind, hops: Hop[]) => void;
  addHop: (t: AiTaskKind) => void;
  canEdit: boolean;
  catalogModels: {
    provider: string;
    modelId: string;
    displayName?: string | null;
    estimateInrLabel?: string;
    rankLabel?: string;
    description?: string | null;
  }[];
  onFocusTask: (t: AiTaskKind) => void;
  activeTask: AiTaskKind;
  suggestions: {
    provider: string;
    modelId: string;
    rankLabel?: string;
    estimateInrLabel?: string;
  }[];
}) {
  return (
    <section className="space-y-4">
      {title ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      ) : null}
      {modules.map((mod) => {
        const hops = hopsFor(mod.task);
        const focused = activeTask === mod.task;
        return (
          <div
            key={mod.id}
            className={cn(
              "rounded-xl border p-4 transition",
              focused ? "border-primary/40 bg-primary/5" : "border-border",
            )}
            onFocus={() => onFocusTask(mod.task)}
            onClick={() => onFocusTask(mod.task)}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{mod.title}</h3>
                <p className="text-sm text-muted-foreground">{mod.hint}</p>
              </div>
              {canEdit ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => addHop(mod.task)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add failover
                </Button>
              ) : null}
            </div>

            {focused && suggestions.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.slice(0, 3).map((s) => (
                  <button
                    key={`${s.provider}-${s.modelId}-${s.rankLabel}`}
                    type="button"
                    disabled={!canEdit}
                    className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHops(mod.task, [
                        { provider: s.provider as AiProviderId, model: s.modelId },
                        ...hops.filter((h) => !(h.provider === s.provider && h.model === s.modelId)),
                      ]);
                    }}
                  >
                    <Badge variant="secondary" className="mr-1 capitalize">
                      {s.rankLabel}
                    </Badge>
                    {s.provider}/{s.modelId}
                    {s.estimateInrLabel ? ` · ${s.estimateInrLabel}` : ""}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-3 space-y-2">
              {hops.length === 0 ? (
                <p className="text-sm text-muted-foreground">Using platform defaults for this section.</p>
              ) : null}
              {hops.map((hop, idx) => (
                <div key={`${mod.task}-${idx}`} className="grid gap-2 sm:grid-cols-[140px_1fr_auto_auto] sm:items-end">
                  <div>
                    <Label className="text-xs">Provider</Label>
                    <Select
                      disabled={!canEdit}
                      value={hop.provider}
                      onValueChange={(v) => {
                        const next = [...hops];
                        next[idx] = { ...hop, provider: v as AiProviderId };
                        setHops(mod.task, next);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDERS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Model</Label>
                    <Input
                      disabled={!canEdit}
                      value={hop.model}
                      list={`models-${mod.task}-${hop.provider}`}
                      onChange={(e) => {
                        const next = [...hops];
                        next[idx] = { ...hop, model: e.target.value };
                        setHops(mod.task, next);
                      }}
                    />
                    <datalist id={`models-${mod.task}-${hop.provider}`}>
                      {catalogModels
                        .filter((m) => m.provider === hop.provider)
                        .map((m) => (
                          <option key={m.modelId} value={m.modelId}>
                            {m.displayName || m.modelId}
                            {m.estimateInrLabel ? ` (${m.estimateInrLabel})` : ""}
                          </option>
                        ))}
                    </datalist>
                  </div>
                  <div className="pb-2 text-xs text-muted-foreground">
                    {catalogModels.find((m) => m.provider === hop.provider && m.modelId === hop.model)
                      ?.estimateInrLabel ?? ""}
                  </div>
                  {canEdit ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setHops(mod.task, hops.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
