"use client";

import { PageHeader } from "@/components/admin/admin-ui";
import { AiTriageBucketsPanel } from "@/components/admin/ai-triage/ai-triage-buckets";
import { AiTriageChatPanel } from "@/components/admin/ai-triage/ai-triage-chat";
import { AiTriageKeysPanel } from "@/components/admin/ai-triage/ai-triage-keys";
import { AiTriageSettingsPanel } from "@/components/admin/ai-triage/ai-triage-settings";
import { Button } from "@/components/ui/button";
import { KeyRound, MessageSquare, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";

type Tab = "buckets" | "keys" | "settings" | "chat";

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: "buckets", label: "Buckets", icon: Sparkles },
  { id: "keys", label: "API Keys", icon: KeyRound },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "chat", label: "Chat", icon: MessageSquare },
];

export default function AdminAiTriagePage() {
  const [tab, setTab] = useState<Tab>("buckets");

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Platform"
        title="AI Triage"
        description="Platform AI keys, bug clustering from feedback + error logs, thresholds, and GitHub issue automation."
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={tab === id ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => setTab(id)}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Button>
        ))}
      </div>

      {tab === "buckets" ? <AiTriageBucketsPanel /> : null}
      {tab === "keys" ? <AiTriageKeysPanel /> : null}
      {tab === "settings" ? <AiTriageSettingsPanel /> : null}
      {tab === "chat" ? <AiTriageChatPanel /> : null}
    </div>
  );
}
