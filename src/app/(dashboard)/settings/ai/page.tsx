"use client";

import { useOrg } from "@/components/org-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Key,
  Loader2,
  Plus,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type ProviderId = "openai" | "gemini" | "nvidia" | "anthropic" | "custom";

// Official vector logos
function OpenAiLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("h-5 w-5", className)}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4947zm-9.66-4.1354a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1401-1.6564zm-1.1214-9.6108a4.4755 4.4755 0 0 1 2.3418-1.9729v.1656l.0048 5.5164a.7854.7854 0 0 0 .388.6766l5.8427 3.3685-2.02 1.1683a.0757.0757 0 0 1-.0663 0L3.86 14.5422a4.4992 4.4992 0 0 1-1.3815-5.8592zm16.5908 3.061l-5.8428-3.3733 2.02-1.1635a.0757.0757 0 0 1 .0663 0l4.8988 2.8291a4.504 4.504 0 0 1 1.3815 5.8592 4.4755 4.4755 0 0 1-2.3418 1.9729v-.1656l-.0048-5.5164a.7854.7854 0 0 0-.388-.6766zm2.4608-4.4755l-.142-.0852-4.783-2.7582a.7712.7712 0 0 0-.7806 0L9.969 7.8286V5.4962a.0804.0804 0 0 1 .0332-.0615l4.8797-2.8196a4.4992 4.4992 0 0 1 6.1401 1.6564 4.4708 4.4708 0 0 1 .5346 3.0137zM8.3077 12.871l-2.02-1.1635a.0804.0804 0 0 1-.038-.052V6.0728a4.504 4.504 0 0 1 4.4945-4.4947 4.4755 4.4755 0 0 1 2.8764 1.0408l-.1419.0804-4.7783 2.7582a.7948.7948 0 0 0-.3927.6813zm1.0978-2.0677l2.6074-1.5045 2.6074 1.5045v3.009l-2.6074 1.5045-2.6074-1.5045z" />
    </svg>
  );
}

function GeminiLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("h-5 w-5", className)}>
      <defs>
        <linearGradient id="gemini-bento-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1E88E5" />
          <stop offset="50%" stopColor="#8E24AA" />
          <stop offset="100%" stopColor="#E53935" />
        </linearGradient>
      </defs>
      <path
        d="M12 0C12 6.627 6.627 12 0 12C6.627 12 12 17.373 12 24C12 17.373 17.373 12 24 12C17.373 12 12 6.627 12 0Z"
        fill="url(#gemini-bento-grad)"
      />
    </svg>
  );
}

function NvidiaLogo({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("h-5 w-5 text-[#76B900]", className)}
    >
      <path d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z" />
    </svg>
  );
}

function AnthropicLogo({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("h-5 w-5 text-[#D97757]", className)}
    >
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

function CustomLlmLogo({ className }: { className?: string }) {
  return (
    <Server className={cn("h-5 w-5 text-indigo-500 dark:text-indigo-400", className)} />
  );
}

interface ProviderMeta {
  id: ProviderId;
  name: string;
  hint: string;
  howTo: string;
  consoleUrl: string;
  consoleLabel: string;
  logo: React.ComponentType<{ className?: string }>;
  badgeContainer: string;
  needsBaseUrl?: boolean;
  basePlaceholder?: string;
  keyPlaceholder: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "openai",
    name: "OpenAI",
    hint: "ChatGPT, GPT-4o, o1 & o3 models",
    howTo: "Sign in to the OpenAI Platform, open API keys, create a secret key, then paste it here.",
    consoleUrl: "https://platform.openai.com/api-keys",
    consoleLabel: "OpenAI API keys",
    logo: OpenAiLogo,
    badgeContainer: "bg-zinc-950 text-white dark:bg-zinc-900 border-zinc-800 shadow-sm",
    keyPlaceholder: "sk-...",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    hint: "Gemini Flash / Pro models",
    howTo: "Open Google AI Studio, create an API key for your Google account, then paste it here.",
    consoleUrl: "https://aistudio.google.com/apikey",
    consoleLabel: "Google AI Studio",
    logo: GeminiLogo,
    badgeContainer: "bg-blue-500/10 border-blue-500/20 shadow-sm",
    keyPlaceholder: "AIza...",
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    hint: "NVIDIA NIM / NGC microservices",
    howTo: "Sign in to NVIDIA Build, open API keys under settings, generate a key, then paste it here.",
    consoleUrl: "https://build.nvidia.com/settings/api-keys",
    consoleLabel: "NVIDIA API keys",
    logo: NvidiaLogo,
    badgeContainer: "bg-zinc-950 text-[#76B900] border-[#76B900]/30 shadow-sm",
    keyPlaceholder: "nvapi-...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    hint: "Claude Sonnet, Haiku, Opus",
    howTo: "Open the Anthropic Console, go to API keys, create a key, then paste it here.",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    consoleLabel: "Anthropic Console",
    logo: AnthropicLogo,
    badgeContainer: "bg-[#D97757]/10 border-[#D97757]/30 shadow-sm",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "custom",
    name: "Custom / Local Endpoint",
    hint: "Ollama, vLLM, LiteLLM, or any OpenAI-compatible server",
    howTo: "Point Base URL at your local or remote OpenAI-compatible API (e.g. Ollama on :11434/v1). API key is optional for many local setups.",
    consoleUrl: "https://ollama.com/download",
    consoleLabel: "Ollama download",
    logo: CustomLlmLogo,
    badgeContainer: "bg-indigo-500/10 border-indigo-500/25 shadow-sm",
    needsBaseUrl: true,
    basePlaceholder: "http://127.0.0.1:11434/v1",
    keyPlaceholder: "optional (ollama often unused)",
  },
];

const TASK_LABELS: Record<string, { title: string; hint: string }> = {
  screening: { title: "Screening (light)", hint: "Simple screens · interview follow-up LIGHT" },
  standard: { title: "Standard", hint: "Default rounds · follow-up MODERATE" },
  heavy: { title: "Heavy / multi-level", hint: "Deep probes · follow-up DEEP" },
  interview: { title: "Live interview override", hint: "Optional override for all live turns" },
  report: { title: "Reports & scoring", hint: "Post-interview analysis" },
  resume: { title: "Resume / CV parse", hint: "PDF extraction & profiling" },
  generate: { title: "Question generation", hint: "AI interview builder" },
};

const PROVIDER_SHORT: Record<ProviderId, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  nvidia: "NVIDIA",
  anthropic: "Anthropic",
  custom: "Custom",
};

export default function AiSettingsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const canEdit = currentOrg?.role === "OWNER" || currentOrg?.role === "ADMIN";
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const query = trpc.aiSettings.get.useQuery({ organizationId: orgId }, { enabled: !!orgId });

  const [keySlots, setKeySlots] = useState<Record<ProviderId, string[]>>({
    openai: [""],
    gemini: [""],
    nvidia: [""],
    anthropic: [""],
    custom: [""],
  });
  const [showKeys, setShowKeys] = useState<Record<ProviderId, boolean>>({
    openai: false,
    gemini: false,
    nvidia: false,
    anthropic: false,
    custom: false,
  });
  const [customBase, setCustomBase] = useState("");
  const [routing, setRouting] = useState<Record<string, ProviderId[]>>({});
  const [pendingAction, setPendingAction] = useState<{ id: ProviderId | "routing"; type: "save" | "clear" } | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const custom = query.data.providers.find((p) => p.id === "custom");
    setCustomBase(custom?.baseUrl ?? "");
    const nextSlots: Record<ProviderId, string[]> = {
      openai: [""],
      gemini: [""],
      nvidia: [""],
      anthropic: [""],
      custom: [""],
    };
    for (const p of query.data.providers) {
      const id = p.id as ProviderId;
      const n = Math.max(1, p.keyCount || 0);
      nextSlots[id] = Array.from({ length: n }, () => "");
    }
    setKeySlots(nextSlots);
    setRouting(query.data.routing as Record<string, ProviderId[]>);
  }, [query.data]);

  const saveKeys = trpc.aiSettings.saveProviderKeys.useMutation({
    onSuccess: () => {
      void utils.aiSettings.get.invalidate();
      toast({ title: "Provider keys saved" });
      setPendingAction(null);
    },
    onError: (e) => {
      toast({ title: "Could not save keys", description: e.message, variant: "destructive" });
      setPendingAction(null);
    },
  });
  const clearProvider = trpc.aiSettings.clearProvider.useMutation({
    onSuccess: () => {
      void utils.aiSettings.get.invalidate();
      toast({ title: "Provider keys cleared" });
      setPendingAction(null);
    },
    onError: (e) => {
      toast({ title: "Could not clear", description: e.message, variant: "destructive" });
      setPendingAction(null);
    },
  });
  const saveRouting = trpc.aiSettings.saveRouting.useMutation({
    onSuccess: () => {
      void utils.aiSettings.get.invalidate();
      toast({ title: "Task routing saved" });
      setPendingAction(null);
    },
    onError: (e) => {
      toast({ title: "Could not save routing", description: e.message, variant: "destructive" });
      setPendingAction(null);
    },
  });

  const busy = saveKeys.isLoading || clearProvider.isLoading || saveRouting.isLoading;
  const taskKinds = useMemo(() => query.data?.taskKinds ?? Object.keys(TASK_LABELS), [query.data?.taskKinds]);

  if (!orgId || query.isLoading || !query.data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const byId = Object.fromEntries(query.data.providers.map((p) => [p.id, p])) as unknown as Record<
    ProviderId,
    {
      apiKeyHint: string | null;
      apiKeyHints: (string | null)[];
      keyCount: number;
      maxKeys: number;
      baseUrl?: string;
      defaultModel?: string;
      configured: boolean;
    }
  >;
  const envFallback = query.data.envFallback;
  const maxKeys = query.data.providers[0]?.maxKeys ?? 5;

  const configuredCount = PROVIDERS.filter((p) => {
    const row = byId[p.id];
    const hasOrg = (row?.keyCount ?? 0) > 0 || (p.id === "custom" && !!row?.baseUrl);
    const hasEnv = !!envFallback[p.id];
    return hasOrg || hasEnv;
  }).length;

  const handleSaveKeys = (p: ProviderMeta) => {
    setPendingAction({ id: p.id, type: "save" });
    saveKeys.mutate({
      organizationId: orgId,
      providerId: p.id,
      keySlots: keySlots[p.id],
      ...(p.needsBaseUrl ? { baseUrl: customBase.trim() || null } : {}),
    });
  };

  const handleClear = (p: ProviderMeta) => {
    setPendingAction({ id: p.id, type: "clear" });
    clearProvider.mutate({ organizationId: orgId, providerId: p.id });
  };

  const moveRoute = (task: string, index: number, dir: -1 | 1) => {
    setRouting((prev) => {
      const list = [...(prev[task] ?? [])];
      const j = index + dir;
      if (j < 0 || j >= list.length) return prev;
      [list[index], list[j]] = [list[j], list[index]];
      return { ...prev, [task]: list };
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Project AI</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">AI Providers</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Add up to {maxKeys} API keys per provider. On errors or rate limits the next key, then the next backup
            provider, is tried automatically — candidates only see an error if every backup fails.
          </p>
        </div>
        <Badge variant="outline" className="px-2.5 py-1 text-xs">
          <span className="mr-1 font-semibold text-foreground">{configuredCount} / {PROVIDERS.length}</span>
          <span className="text-muted-foreground">Active</span>
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const row = byId[p.id];
          const slots = keySlots[p.id] ?? [""];
          const hints = row?.apiKeyHints ?? [];
          const hasOrg = (row?.keyCount ?? 0) > 0 || (p.id === "custom" && !!row?.baseUrl);
          const hasEnv = !!envFallback[p.id];
          const isCustom = p.id === "custom";
          const isCurrentSaving = pendingAction?.id === p.id && pendingAction.type === "save";
          const isCurrentClearing = pendingAction?.id === p.id && pendingAction.type === "clear";
          const LogoComponent = p.logo;

          return (
            <div
              key={p.id}
              className={cn(
                "group relative flex flex-col justify-between rounded-2xl border bg-card/70 p-5 transition-all duration-200 hover:border-border/80 hover:shadow-sm",
                isCustom && "bg-gradient-to-br from-card/80 to-muted/20 md:col-span-2",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-200 group-hover:scale-105",
                      p.badgeContainer,
                    )}
                  >
                    <LogoComponent />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground">{p.name}</h2>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{p.hint}</p>
                  </div>
                </div>
                <div className="shrink-0">
                  {hasOrg || hasEnv ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-500/25 bg-emerald-500/10 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                    >
                      <Check className="h-3 w-3" />
                      <span>
                        {hasOrg ? `${row?.keyCount ?? 0} key${(row?.keyCount ?? 0) === 1 ? "" : "s"}` : "Env"}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="py-0.5 text-[11px] font-normal text-muted-foreground">
                      Not configured
                    </Badge>
                  )}
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {p.howTo}{" "}
                <Link
                  href={p.consoleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                >
                  {p.consoleLabel}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </p>
              {row?.defaultModel && (
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  Model on this provider:{" "}
                  <span className="text-foreground/80">{row.defaultModel}</span>
                </p>
              )}

              <div className="mt-4 space-y-3">
                {isCustom && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Globe className="h-3 w-3 text-muted-foreground" />
                      <Label className="text-xs font-medium text-muted-foreground">Base URL</Label>
                    </div>
                    <Input
                      placeholder={p.basePlaceholder}
                      value={customBase}
                      onChange={(e) => setCustomBase(e.target.value)}
                      disabled={!canEdit || busy}
                      className="bg-background/80 font-mono text-xs"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Key className="h-3 w-3" />
                    API keys (failover order · max {maxKeys})
                  </Label>
                  {slots.map((val, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-[10px] text-muted-foreground">#{i + 1}</span>
                      <div className="relative min-w-0 flex-1">
                        <Input
                          type={showKeys[p.id] ? "text" : "password"}
                          autoComplete="off"
                          placeholder={
                            hints[i]
                              ? `Saved (${hints[i]}) — leave blank to keep`
                              : p.keyPlaceholder
                          }
                          value={val}
                          onChange={(e) =>
                            setKeySlots((prev) => {
                              const next = [...(prev[p.id] ?? [""])];
                              next[i] = e.target.value;
                              return { ...prev, [p.id]: next };
                            })
                          }
                          disabled={!canEdit || busy}
                          className="bg-background/80 pr-9 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeys((s) => ({ ...s, [p.id]: !s[p.id] }))}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                          tabIndex={-1}
                        >
                          {showKeys[p.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      {canEdit && slots.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          disabled={busy}
                          onClick={() =>
                            setKeySlots((prev) => ({
                              ...prev,
                              [p.id]: (prev[p.id] ?? []).filter((_, j) => j !== i),
                            }))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {canEdit && slots.length < maxKeys && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={busy}
                      onClick={() =>
                        setKeySlots((prev) => ({
                          ...prev,
                          [p.id]: [...(prev[p.id] ?? []), ""],
                        }))
                      }
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add backup key
                    </Button>
                  )}
                </div>

                {canEdit && (
                  <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
                    {hasOrg && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => handleClear(p)}
                        className="h-8 text-xs text-muted-foreground transition-colors hover:text-destructive"
                      >
                        {isCurrentClearing ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Clear all
                      </Button>
                    )}
                    <Button size="sm" disabled={busy} onClick={() => handleSaveKeys(p)} className="h-8 text-xs font-medium">
                      {isCurrentSaving ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        `Save ${p.name}`
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task routing */}
      <div className="rounded-2xl border bg-card/70 p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Task priority &amp; backups</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Top of each list = primary provider. Lower entries are backups if the primary hits limits or errors.
              Example: put Gemini first for screening, OpenAI first for heavy multi-level rounds.
            </p>
          </div>
          {canEdit && (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy}
              onClick={() => {
                setPendingAction({ id: "routing", type: "save" });
                saveRouting.mutate({ organizationId: orgId, routing });
              }}
            >
              {pendingAction?.id === "routing" && saveRouting.isLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save routing"
              )}
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {taskKinds.map((task) => {
            const meta = TASK_LABELS[task] ?? { title: task, hint: "" };
            const list = routing[task] ?? [];
            return (
              <div key={task} className="rounded-xl border bg-background/50 p-3">
                <div className="mb-2">
                  <div className="text-sm font-medium">{meta.title}</div>
                  <div className="text-[11px] text-muted-foreground">{meta.hint}</div>
                </div>
                <ol className="space-y-1.5">
                  {list.map((pid, index) => (
                    <li
                      key={`${task}-${pid}`}
                      className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
                    >
                      <span className="w-4 text-muted-foreground">{index + 1}.</span>
                      <span className="min-w-0 flex-1 font-medium">
                        {PROVIDER_SHORT[pid] ?? pid}
                        {index === 0 ? (
                          <span className="ml-1.5 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                            primary
                          </span>
                        ) : (
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">backup</span>
                        )}
                      </span>
                      {canEdit && (
                        <span className="flex shrink-0 gap-0.5">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={index === 0 || busy}
                            onClick={() => moveRoute(task, index, -1)}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={index === list.length - 1 || busy}
                            onClick={() => moveRoute(task, index, 1)}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
