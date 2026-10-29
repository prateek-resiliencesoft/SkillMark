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
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Key,
  Loader2,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import React, { useEffect, useState } from "react";

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

export default function AiSettingsPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";
  const canEdit = currentOrg?.role === "OWNER" || currentOrg?.role === "ADMIN";
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const query = trpc.aiSettings.get.useQuery({ organizationId: orgId }, { enabled: !!orgId });

  const [keys, setKeys] = useState<Record<ProviderId, string>>({
    openai: "",
    gemini: "",
    nvidia: "",
    anthropic: "",
    custom: "",
  });
  const [showKeys, setShowKeys] = useState<Record<ProviderId, boolean>>({
    openai: false,
    gemini: false,
    nvidia: false,
    anthropic: false,
    custom: false,
  });
  const [customBase, setCustomBase] = useState("");
  const [pendingAction, setPendingAction] = useState<{ id: ProviderId; type: "save" | "clear" } | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const custom = query.data.providers.find((p) => p.id === "custom");
    setCustomBase(custom?.baseUrl ?? "");
  }, [query.data]);

  const save = trpc.aiSettings.save.useMutation({
    onSuccess: () => {
      setKeys({ openai: "", gemini: "", nvidia: "", anthropic: "", custom: "" });
      void utils.aiSettings.get.invalidate();
      toast({ title: "AI settings saved successfully" });
      setPendingAction(null);
    },
    onError: (e) => {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
      setPendingAction(null);
    },
  });

  if (!orgId || query.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const byId = Object.fromEntries(query.data!.providers.map((p) => [p.id, p])) as unknown as Record<
    ProviderId,
    { apiKeyHint: string | null; baseUrl?: string; configured: boolean }
  >;
  const envFallback = query.data!.envFallback;

  const configuredCount = PROVIDERS.filter((p) => {
    const row = byId[p.id];
    const hasOrg = !!row?.apiKeyHint || (p.id === "custom" && !!row?.baseUrl);
    const hasEnv = !!envFallback[p.id];
    return hasOrg || hasEnv;
  }).length;

  const handleSave = (p: ProviderMeta) => {
    setPendingAction({ id: p.id, type: "save" });
    save.mutate({
      organizationId: orgId,
      providers: {
        [p.id]: {
          ...(keys[p.id].trim() ? { apiKey: keys[p.id].trim() } : {}),
          ...(p.needsBaseUrl ? { baseUrl: customBase.trim() || null } : {}),
        },
      },
    });
  };

  const handleClear = (p: ProviderMeta) => {
    setPendingAction({ id: p.id, type: "clear" });
    save.mutate({
      organizationId: orgId,
      providers: {
        [p.id]: {
          apiKey: null,
          ...(p.needsBaseUrl ? { baseUrl: null } : {}),
        },
      },
    });
  };

  const toggleShowKey = (id: ProviderId) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-10">
      {/* Header section */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Project AI</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">AI Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Add API keys for the providers you want this organization to use. Models stay on server defaults — you only connect credentials here.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs px-2.5 py-1">
            <span className="font-semibold text-foreground mr-1">{configuredCount} / {PROVIDERS.length}</span>
            <span className="text-muted-foreground">Active</span>
          </Badge>
        </div>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDERS.map((p) => {
          const row = byId[p.id];
          const hasOrg = !!row?.apiKeyHint || (p.id === "custom" && !!row?.baseUrl);
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
                isCustom && "md:col-span-2 bg-gradient-to-br from-card/80 to-muted/20"
              )}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-200 group-hover:scale-105",
                      p.badgeContainer
                    )}
                  >
                    <LogoComponent />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground">
                      {p.name}
                    </h2>
                    <p className="text-xs text-muted-foreground line-clamp-1">
                      {p.hint}
                    </p>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="shrink-0">
                  {(hasOrg || hasEnv) ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/25 bg-emerald-500/10 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 gap-1 py-0.5"
                    >
                      <Check className="h-3 w-3" />
                      <span>Connected</span>
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-[11px] font-normal text-muted-foreground py-0.5"
                    >
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

              {/* Card Body / Inputs */}
              <div className="mt-4 space-y-4">
                {isCustom ? (
                  // Custom Provider: Side-by-side inputs
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Globe className="h-3 w-3 text-muted-foreground" />
                        <Label className="text-xs font-medium text-muted-foreground">
                          Base URL
                        </Label>
                      </div>
                      <Input
                        placeholder={p.basePlaceholder}
                        value={customBase}
                        onChange={(e) => setCustomBase(e.target.value)}
                        disabled={!canEdit || save.isLoading}
                        className="font-mono text-xs bg-background/80"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Key className="h-3 w-3 text-muted-foreground" />
                          <Label className="text-xs font-medium text-muted-foreground">
                            API Key (optional)
                          </Label>
                        </div>
                        {row?.apiKeyHint && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Saved ({row.apiKeyHint})
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <Input
                          type={showKeys[p.id] ? "text" : "password"}
                          autoComplete="off"
                          placeholder={
                            row?.apiKeyHint
                              ? `Saved (${row.apiKeyHint}) — leave blank to keep`
                              : p.keyPlaceholder
                          }
                          value={keys[p.id]}
                          onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                          disabled={!canEdit || save.isLoading}
                          className="pr-9 font-mono text-xs bg-background/80"
                        />
                        <button
                          type="button"
                          onClick={() => toggleShowKey(p.id)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                          title={showKeys[p.id] ? "Hide API key" : "Show API key"}
                        >
                          {showKeys[p.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Standard Provider Input
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Key className="h-3 w-3" />
                        <span>API Key</span>
                      </Label>
                      {row?.apiKeyHint && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          Saved ({row.apiKeyHint})
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        type={showKeys[p.id] ? "text" : "password"}
                        autoComplete="off"
                        placeholder={
                          row?.apiKeyHint
                            ? `Saved (${row.apiKeyHint}) — leave blank to keep`
                            : p.keyPlaceholder
                        }
                        value={keys[p.id]}
                        onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                        disabled={!canEdit || save.isLoading}
                        className="pr-9 font-mono text-xs bg-background/80"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey(p.id)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                        title={showKeys[p.id] ? "Hide API key" : "Show API key"}
                      >
                        {showKeys[p.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Card Action Footer */}
                {canEdit && (
                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
                    {hasOrg && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={save.isLoading}
                        onClick={() => handleClear(p)}
                        className="h-8 text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        {isCurrentClearing ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Clear key
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={save.isLoading}
                      onClick={() => handleSave(p)}
                      className="h-8 text-xs font-medium"
                    >
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

    </div>
  );
}
