"use client";

import { PageHeader } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const EXAMPLE_PAYLOAD = `{
  "taskModels": {
    "voice": [{ "provider": "gemini", "model": "gemini-3.1-flash-live-preview" }],
    "report": [{ "provider": "openai", "model": "gpt-4o" }],
    "generate": [{ "provider": "openai", "model": "gpt-4o-mini" }],
    "resume": [{ "provider": "gemini", "model": "gemini-3.6-flash" }],
    "round2_transcript": [{ "provider": "groq", "model": "whisper-large-v3-turbo" }]
  }
}`;

export default function AdminAiPresetsPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const list = trpc.aiPresets.list.useQuery();

  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [payloadText, setPayloadText] = useState(EXAMPLE_PAYLOAD);
  const [published, setPublished] = useState(false);

  const upsert = trpc.aiPresets.upsert.useMutation({
    onSuccess: async () => {
      toast({ title: "Preset saved" });
      setName("");
      setBlurb("");
      await utils.aiPresets.list.invalidate();
    },
    onError: (e) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const setPub = trpc.aiPresets.setPublished.useMutation({
    onSuccess: async () => {
      await utils.aiPresets.list.invalidate();
    },
    onError: (e) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const del = trpc.aiPresets.delete.useMutation({
    onSuccess: async () => {
      toast({ title: "Deleted" });
      await utils.aiPresets.list.invalidate();
    },
    onError: (e) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Platform"
        title="AI preset templates"
        description="Publish suggested AI Studio templates for orgs to copy. Templates never include API keys."
      />
      <p className="text-sm text-muted-foreground">
        <Link href="/admin/ai" className="underline">
          ← AI Triage
        </Link>
      </p>

      <section className="max-w-2xl space-y-3 rounded-xl border p-4">
        <h2 className="font-medium">New template</h2>
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cheap Gemini voice" />
        </div>
        <div className="space-y-2">
          <Label>Blurb</Label>
          <Input value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="Shown under Suggested templates" />
        </div>
        <div className="space-y-2">
          <Label>Payload JSON (`taskModels`)</Label>
          <Textarea
            className="min-h-[180px] font-mono text-xs"
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Publish immediately (visible to orgs)
        </label>
        <Button
          disabled={!name.trim() || upsert.isLoading}
          onClick={() => {
            let payload: unknown;
            try {
              payload = JSON.parse(payloadText);
            } catch {
              toast({ title: "Invalid JSON", variant: "destructive" });
              return;
            }
            upsert.mutate({
              name: name.trim(),
              blurb: blurb.trim(),
              published,
              payload: payload as { taskModels?: Record<string, { provider: string; model: string }[]> },
            });
          }}
        >
          {upsert.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Create preset
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">All presets</h2>
        {(list.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No presets yet. Apply SQL migration `54-ai-studio-catalog.sql` if the table is missing.</p>
        ) : null}
        <ul className="space-y-2">
          {(list.data ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant={p.published ? "default" : "secondary"}>
                    {p.published ? "Published" : "Draft"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{p.blurb || p.slug}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPub.mutate({ id: p.id, published: !p.published })}
                >
                  {p.published ? "Unpublish" : "Publish"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => del.mutate({ id: p.id })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
