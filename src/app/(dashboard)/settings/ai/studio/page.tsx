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
import {
  Calculator,
  ChevronDown,
  FlaskConical,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
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

type CatalogModel = {
  provider: string;
  modelId: string;
  displayName?: string | null;
  estimateInrLabel?: string;
  estimateInr?: number | null;
  estimateUsd?: number | null;
  rankLabel?: string;
  description?: string | null;
  inputUsdPerMtok?: number | null;
  outputUsdPerMtok?: number | null;
  perMinuteUsd?: number | null;
  audioInUsdPerMtok?: number | null;
  audioOutUsdPerMtok?: number | null;
};

type StudioModule = {
  id: string;
  title: string;
  hint: string;
  task: AiTaskKind;
  group: "product" | "advanced";
  workload:
    | { kind: "text"; inputTokens: number; outputTokens: number }
    | { kind: "audio_min"; minutes: number };
};

const PROVIDERS: AiProviderId[] = ["openai", "gemini", "anthropic", "groq", "nvidia", "custom"];

function formatInr(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  if (amount < 0.01) return `₹${amount.toFixed(4)}`;
  if (amount < 1) return `₹${amount.toFixed(2)}`;
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function estimateUsd(model: CatalogModel, workload: StudioModule["workload"]): number | null {
  if (workload.kind === "audio_min") {
    if (model.perMinuteUsd != null && Number.isFinite(model.perMinuteUsd)) {
      return model.perMinuteUsd * workload.minutes;
    }
    const ain = model.audioInUsdPerMtok;
    const aout = model.audioOutUsdPerMtok;
    if (ain == null || aout == null) return null;
    const tokensPerMin = 25 * 60;
    return (
      ((tokensPerMin * workload.minutes) / 1_000_000) * ain +
      ((tokensPerMin * workload.minutes) / 1_000_000) * aout
    );
  }
  const inn = model.inputUsdPerMtok;
  const out = model.outputUsdPerMtok;
  if (inn == null || out == null) return null;
  return (workload.inputTokens / 1_000_000) * inn + (workload.outputTokens / 1_000_000) * out;
}

function workloadLabel(w: StudioModule["workload"]): string {
  if (w.kind === "audio_min") return `~${w.minutes} min live audio`;
  return `~${(w.inputTokens / 1000).toFixed(0)}k in · ${(w.outputTokens / 1000).toFixed(1)}k out tokens`;
}

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
  const [activeTask, setActiveTask] = useState<AiTaskKind>("report");

  // Playground
  const [playModuleId, setPlayModuleId] = useState("r1_report");
  const [playProvider, setPlayProvider] = useState<AiProviderId>("openai");
  const [playModelId, setPlayModelId] = useState("gpt-4o");
  const [customIn, setCustomIn] = useState(12_000);
  const [customOut, setCustomOut] = useState(3_000);
  const [useCustomTokens, setUseCustomTokens] = useState(false);

  useEffect(() => {
    if (settings.data?.taskModels) setTaskModels(settings.data.taskModels);
  }, [settings.data?.taskModels]);

  const save = trpc.aiSettings.saveTaskModels.useMutation({
    onSuccess: async () => {
      toast({ title: "Studio saved" });
      await utils.aiSettings.get.invalidate({ organizationId: orgId });
    },
    onError: (e) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const applyPreset = trpc.aiSettings.applyPreset.useMutation({
    onSuccess: async (res) => {
      setTaskModels(res.taskModels ?? {});
      toast({ title: "Template applied" });
      await utils.aiSettings.get.invalidate({ organizationId: orgId });
    },
    onError: (e) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const testProvider = trpc.aiSettings.testProvider.useMutation({
    onSuccess: async (res) => {
      toast({ title: "Models refreshed", description: `${res.count} models listed from provider` });
      await utils.aiSettings.listCatalog.invalidate();
    },
    onError: (e) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const modules = (settings.data?.modules ?? catalog.data?.modules ?? []) as StudioModule[];
  const product = modules.filter((m) => m.group === "product");
  const advanced = modules.filter((m) => m.group === "advanced");

  const playModule = modules.find((m) => m.id === playModuleId) ?? product[0];
  const playTask = playModule?.task ?? "report";

  const taskCatalog = trpc.aiSettings.listCatalog.useQuery(
    { organizationId: orgId, task: activeTask },
    { enabled: !!orgId },
  );
  const playCatalog = trpc.aiSettings.listCatalog.useQuery(
    { organizationId: orgId, task: playTask },
    { enabled: !!orgId && !!playModule },
  );

  const usdInr = catalog.data?.usdInr ?? playCatalog.data?.usdInr ?? 93;
  const allModels = (playCatalog.data?.models ?? catalog.data?.models ?? []) as CatalogModel[];
  const playModelsForProvider = allModels.filter((m) => m.provider === playProvider);

  useEffect(() => {
    if (!playModule) return;
    setActiveTask(playModule.task);
    if (playModule.workload.kind === "text") {
      setCustomIn(playModule.workload.inputTokens);
      setCustomOut(playModule.workload.outputTokens);
    }
  }, [playModuleId]); // eslint-disable-line react-hooks/exhaustive-deps -- only when module id changes

  const selectedModel =
    playModelsForProvider.find((m) => m.modelId === playModelId) ??
    allModels.find((m) => m.provider === playProvider && m.modelId === playModelId) ??
    null;

  const playWorkload: StudioModule["workload"] = useMemo(() => {
    if (!playModule) return { kind: "text", inputTokens: customIn, outputTokens: customOut };
    if (playModule.workload.kind === "audio_min") return playModule.workload;
    if (useCustomTokens) return { kind: "text", inputTokens: customIn, outputTokens: customOut };
    return playModule.workload;
  }, [playModule, useCustomTokens, customIn, customOut]);

  const playEstimate = selectedModel ? estimateUsd(selectedModel, playWorkload) : null;
  const playInr = playEstimate != null ? playEstimate * usdInr : null;

  const hopsFor = (task: AiTaskKind): Hop[] => taskModels[task] ?? [];
  const setHops = (task: AiTaskKind, hops: Hop[]) => {
    setTaskModels((prev) => ({ ...prev, [task]: hops }));
  };
  const addHop = (task: AiTaskKind) => {
    const configured = settings.data?.providers.find((p) => p.configured)?.id ?? "openai";
    setHops(task, [
      ...hopsFor(task),
      { provider: configured as AiProviderId, model: settings.data?.defaultModels?.[configured] || "gpt-4o-mini" },
    ]);
  };

  const configuredProviders = settings.data?.providers.filter((p) => p.configured).map((p) => p.id) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Studio</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Pick the model for each SkillMark job (report, voice, CV…). First hop runs first; later hops are
            backups. Prices use catalog FX{" "}
            <span className="font-medium text-foreground">₹{usdInr}/USD</span>
            {catalog.data?.pricesAsOf
              ? ` · updated ${new Date(catalog.data.pricesAsOf).toLocaleDateString("en-IN")}`
              : ""}
            . Keys live under{" "}
            <Link href="/settings/ai" className="font-medium text-foreground underline underline-offset-2">
              Providers
            </Link>
            .
          </p>
        </div>
        {canEdit ? (
          <Button disabled={save.isLoading} onClick={() => save.mutate({ organizationId: orgId, taskModels })}>
            {save.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Studio
          </Button>
        ) : null}
      </div>

      {/* ── Playground ───────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-muted/20 p-4 sm:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold">Workload playground</h3>
            <p className="text-sm text-muted-foreground">
              Estimate ₹ cost for one run. No API call — uses catalog rates. Refresh models to pull live IDs from
              your keys.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">What to cost</Label>
            <Select value={playModuleId} onValueChange={setPlayModuleId}>
              <SelectTrigger>
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Provider</Label>
            <Select
              value={playProvider}
              onValueChange={(v) => {
                setPlayProvider(v as AiProviderId);
                const first = allModels.find((m) => m.provider === v);
                if (first) setPlayModelId(first.modelId);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                    {configuredProviders.includes(p) ? "" : " (no key)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
            <Label className="text-xs">Model</Label>
            <Select value={playModelId} onValueChange={setPlayModelId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick model" />
              </SelectTrigger>
              <SelectContent>
                {playModelsForProvider.length === 0 ? (
                  <SelectItem value={playModelId}>{playModelId}</SelectItem>
                ) : (
                  playModelsForProvider.map((m) => (
                    <SelectItem key={m.modelId} value={m.modelId}>
                      {m.displayName || m.modelId}
                      {m.rankLabel && m.rankLabel !== "other" ? ` · ${m.rankLabel}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {playModule?.workload.kind === "text" ? (
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useCustomTokens}
                onChange={(e) => setUseCustomTokens(e.target.checked)}
                className="rounded border-border"
              />
              Override token sizes
            </label>
            {useCustomTokens ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Input tokens</Label>
                  <Input
                    type="number"
                    min={100}
                    step={500}
                    value={customIn}
                    onChange={(e) => setCustomIn(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Output tokens</Label>
                  <Input
                    type="number"
                    min={50}
                    step={100}
                    value={customOut}
                    onChange={(e) => setCustomOut(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-background p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estimated cost / run</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              {playInr != null ? formatInr(playInr) : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {playModule ? workloadLabel(playWorkload) : "Pick a module"}
              {playEstimate != null ? ` · $${playEstimate.toFixed(4)}` : ""}
              {!selectedModel ? " · model rates missing in catalog" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={testProvider.isLoading}
                onClick={() => testProvider.mutate({ organizationId: orgId, providerId: playProvider })}
              >
                {testProvider.isLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Test & refresh {playProvider}
              </Button>
            ) : null}
            {canEdit && playModule ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setHops(playModule.task, [
                    { provider: playProvider, model: playModelId },
                    ...hopsFor(playModule.task).filter(
                      (h) => !(h.provider === playProvider && h.model === playModelId),
                    ),
                  ]);
                  setActiveTask(playModule.task);
                  toast({ title: "Applied to Studio", description: `${playModule.title} → ${playProvider}/${playModelId}` });
                }}
              >
                <Calculator className="mr-1.5 h-3.5 w-3.5" />
                Use for {playModule.title.split("·")[0]?.trim() ?? "module"}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Templates ────────────────────────────────────────── */}
      {(presets.data?.length ?? 0) > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              Quick-start templates
            </h3>
            <p className="text-sm text-muted-foreground">One click fills every module with a recommended stack.</p>
          </div>
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

      {/* ── Modules ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Assign models by feature</h3>
          <p className="text-sm text-muted-foreground">
            Empty = platform defaults. Cheap / Balanced / Best chips use catalog prices for that feature&apos;s
            typical size.
          </p>
        </div>
        <ModuleList
          modules={product}
          hopsFor={hopsFor}
          setHops={setHops}
          addHop={addHop}
          canEdit={!!canEdit}
          catalogModels={(taskCatalog.data?.models ?? catalog.data?.models ?? []) as CatalogModel[]}
          onFocusTask={setActiveTask}
          activeTask={activeTask}
          suggestions={
            ((taskCatalog.data?.models ?? []) as CatalogModel[]).filter(
              (m) => m.rankLabel === "cheap" || m.rankLabel === "balanced" || m.rankLabel === "best",
            ) ?? []
          }
        />
      </section>

      <div>
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <ChevronDown className={cn("h-4 w-4 transition", showAdvanced && "rotate-180")} />
          Advanced · follow-up depth models
        </button>
        {showAdvanced ? (
          <div className="mt-4">
            <ModuleList
              modules={advanced}
              hopsFor={hopsFor}
              setHops={setHops}
              addHop={addHop}
              canEdit={!!canEdit}
              catalogModels={(taskCatalog.data?.models ?? catalog.data?.models ?? []) as CatalogModel[]}
              onFocusTask={setActiveTask}
              activeTask={activeTask}
              suggestions={
                ((taskCatalog.data?.models ?? []) as CatalogModel[]).filter(
                  (m) => m.rankLabel === "cheap" || m.rankLabel === "balanced" || m.rankLabel === "best",
                ) ?? []
              }
            />
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        <Key className="mr-1 inline h-3 w-3" />
        Need a key first?{" "}
        <Link href="/settings/ai" className="underline underline-offset-2">
          Add it under Providers
        </Link>
        , then refresh models in the playground.
      </p>
    </div>
  );
}

function ModuleList({
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
  modules: { id: string; title: string; hint: string; task: AiTaskKind }[];
  hopsFor: (t: AiTaskKind) => Hop[];
  setHops: (t: AiTaskKind, hops: Hop[]) => void;
  addHop: (t: AiTaskKind) => void;
  canEdit: boolean;
  catalogModels: CatalogModel[];
  onFocusTask: (t: AiTaskKind) => void;
  activeTask: AiTaskKind;
  suggestions: CatalogModel[];
}) {
  return (
    <div className="space-y-3">
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
                <h4 className="font-medium">{mod.title}</h4>
                <p className="text-sm text-muted-foreground">{mod.hint}</p>
              </div>
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    addHop(mod.task);
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add backup
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
                    className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
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
                <p className="text-sm text-muted-foreground">Using platform defaults for this feature.</p>
              ) : null}
              {hops.map((hop, idx) => (
                <div
                  key={`${mod.task}-${idx}`}
                  className="grid gap-2 sm:grid-cols-[120px_1fr_auto_auto] sm:items-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div>
                    <Label className="text-xs">{idx === 0 ? "Primary" : `Backup ${idx}`}</Label>
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
                  <div className="pb-2 text-xs tabular-nums text-muted-foreground">
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
    </div>
  );
}
