"use client";

import { Panel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { useEffect, useState } from "react";

export function AiTriageSettingsPanel() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const settingsQ = trpc.bugTriage.settingsGet.useQuery(undefined, { staleTime: 30_000 });

  const [enabled, setEnabled] = useState(true);
  const [errorThreshold, setErrorThreshold] = useState(10);
  const [noiseThreshold, setNoiseThreshold] = useState(50);
  const [windowDays, setWindowDays] = useState(7);

  useEffect(() => {
    if (!settingsQ.data) return;
    setEnabled(settingsQ.data.enabled);
    setErrorThreshold(settingsQ.data.errorThreshold);
    setNoiseThreshold(settingsQ.data.noiseThreshold);
    setWindowDays(settingsQ.data.windowDays);
  }, [settingsQ.data]);

  const settingsMut = trpc.bugTriage.settingsSet.useMutation({
    onSuccess: async () => {
      await utils.bugTriage.settingsGet.invalidate();
      toast({ title: "Settings saved" });
    },
    onError: (e) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Panel className="max-w-xl space-y-5 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Triage enabled</div>
          <div className="text-xs text-muted-foreground">Kill switch — when off, cron leaves the queue alone.</div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Error / critical threshold</span>
        <Input
          type="number"
          min={1}
          value={errorThreshold}
          onChange={(e) => setErrorThreshold(Number(e.target.value) || 1)}
          className="h-9"
        />
        <span className="text-xs text-muted-foreground">Open GitHub issue at this many hits in the window.</span>
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Info / warning threshold</span>
        <Input
          type="number"
          min={1}
          value={noiseThreshold}
          onChange={(e) => setNoiseThreshold(Number(e.target.value) || 1)}
          className="h-9"
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Window (days)</span>
        <Input
          type="number"
          min={1}
          max={90}
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value) || 7)}
          className="h-9"
        />
      </label>
      <Button
        type="button"
        disabled={settingsMut.isLoading}
        onClick={() => settingsMut.mutate({ enabled, errorThreshold, noiseThreshold, windowDays })}
      >
        Save settings
      </Button>
    </Panel>
  );
}
