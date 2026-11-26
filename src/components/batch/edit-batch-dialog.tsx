"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AI_TONES, FOLLOW_UP_DEPTHS, LANGUAGES } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export type EditableBatchSettings = {
  roleDescription?: string;
  jobDescription?: string;
  durationMinutes?: number;
  language?: string;
  interviewType?: "technical" | "behavioral" | "mixed" | "screening";
  chatEnabled?: boolean;
  voiceEnabled?: boolean;
  videoEnabled?: boolean;
  aiTone?: "CASUAL" | "PROFESSIONAL" | "FORMAL" | "FRIENDLY";
  aiGender?: "FEMALE" | "MALE";
  followUpDepth?: "LIGHT" | "MODERATE" | "DEEP";
  antiCheatingEnabled?: boolean;
  headMovementDetectionEnabled?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string;
  name: string;
  /** When set, dialog also edits these settings (detail page). List can pass name-only. */
  settings?: EditableBatchSettings | null;
  /** name = rename only; full = name + settings. */
  mode?: "name" | "full";
  onSaved?: () => void;
};

export function EditBatchDialog({
  open,
  onOpenChange,
  batchId,
  name: initialName,
  settings: initialSettings,
  mode = "full",
  onSaved,
}: Props) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [name, setName] = useState(initialName);
  const [roleDescription, setRoleDescription] = useState(initialSettings?.roleDescription ?? "");
  const [jobDescription, setJobDescription] = useState(initialSettings?.jobDescription ?? "");
  const [durationMinutes, setDurationMinutes] = useState(initialSettings?.durationMinutes ?? 20);
  const [language, setLanguage] = useState(initialSettings?.language ?? "en");
  const [interviewType, setInterviewType] = useState(initialSettings?.interviewType ?? "technical");
  const [chatEnabled, setChatEnabled] = useState(initialSettings?.chatEnabled ?? true);
  const [voiceEnabled, setVoiceEnabled] = useState(initialSettings?.voiceEnabled ?? true);
  const [videoEnabled, setVideoEnabled] = useState(initialSettings?.videoEnabled ?? true);
  const [aiTone, setAiTone] = useState(initialSettings?.aiTone ?? "FRIENDLY");
  const [aiGender, setAiGender] = useState(initialSettings?.aiGender ?? "FEMALE");
  const [followUpDepth, setFollowUpDepth] = useState(initialSettings?.followUpDepth ?? "MODERATE");
  const [antiCheatingEnabled, setAntiCheating] = useState(!!initialSettings?.antiCheatingEnabled);
  const [headMovementDetectionEnabled, setHeadMove] = useState(!!initialSettings?.headMovementDetectionEnabled);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setRoleDescription(initialSettings?.roleDescription ?? "");
    setJobDescription(initialSettings?.jobDescription ?? "");
    setDurationMinutes(initialSettings?.durationMinutes ?? 20);
    setLanguage(initialSettings?.language ?? "en");
    setInterviewType(initialSettings?.interviewType ?? "technical");
    setChatEnabled(initialSettings?.chatEnabled ?? true);
    setVoiceEnabled(initialSettings?.voiceEnabled ?? true);
    setVideoEnabled(initialSettings?.videoEnabled ?? true);
    setAiTone(initialSettings?.aiTone ?? "FRIENDLY");
    setAiGender(initialSettings?.aiGender ?? "FEMALE");
    setFollowUpDepth(initialSettings?.followUpDepth ?? "MODERATE");
    setAntiCheating(!!initialSettings?.antiCheatingEnabled);
    setHeadMove(!!initialSettings?.headMovementDetectionEnabled);
  }, [open, initialName, initialSettings]);

  const update = trpc.batch.update.useMutation({
    onSuccess: () => {
      void utils.batch.list.invalidate();
      void utils.batch.getById.invalidate({ id: batchId });
      toast({ title: "Batch updated" });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (e) => toast({ title: "Could not update batch", description: e.message, variant: "destructive" }),
  });

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (mode === "name") {
      update.mutate({ batchId, name: trimmed });
      return;
    }
    if (!roleDescription.trim()) {
      toast({ title: "Role description required", variant: "destructive" });
      return;
    }
    update.mutate({
      batchId,
      name: trimmed,
      settings: {
        roleDescription: roleDescription.trim(),
        jobDescription: jobDescription.trim() || undefined,
        durationMinutes,
        language,
        interviewType,
        chatEnabled,
        voiceEnabled,
        videoEnabled: voiceEnabled && videoEnabled,
        aiTone,
        aiGender,
        followUpDepth,
        antiCheatingEnabled,
        headMovementDetectionEnabled: antiCheatingEnabled && headMovementDetectionEnabled,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "name" ? "Rename batch" : "Edit batch"}</DialogTitle>
          <DialogDescription>
            {mode === "name"
              ? "Change how this batch appears in the list."
              : "Name and defaults for new candidates in this batch. Interviews already generated are not rewritten."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="batch-name">Batch name</Label>
            <Input
              id="batch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              placeholder="e.g. Frontend hiring — March"
              onKeyDown={(e) => {
                if (e.key === "Enter" && mode === "name") {
                  e.preventDefault();
                  save();
                }
              }}
            />
          </div>

          {mode === "full" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="batch-role">Role description</Label>
                <Textarea
                  id="batch-role"
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                  rows={3}
                  maxLength={4000}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batch-jd">Job description (optional)</Label>
                <Textarea
                  id="batch-jd"
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  rows={4}
                  maxLength={20_000}
                  placeholder="Paste JD text used when generating new candidates…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Duration (minutes)</Label>
                  <Input
                    type="number"
                    min={5}
                    max={120}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Math.min(120, Math.max(5, Number(e.target.value) || 20)))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Interview type</Label>
                  <Select value={interviewType} onValueChange={(v) => setInterviewType(v as typeof interviewType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="technical">Technical</SelectItem>
                      <SelectItem value="behavioral">Behavioral</SelectItem>
                      <SelectItem value="mixed">Mixed</SelectItem>
                      <SelectItem value="screening">Screening</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Language</Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>AI tone</Label>
                  <Select value={aiTone} onValueChange={(v) => setAiTone(v as typeof aiTone)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_TONES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Follow-up depth</Label>
                  <Select value={followUpDepth} onValueChange={(v) => setFollowUpDepth(v as typeof followUpDepth)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FOLLOW_UP_DEPTHS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Interviewer</Label>
                  <Select value={aiGender} onValueChange={(v) => setAiGender(v as typeof aiGender)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FEMALE">Sarah (female)</SelectItem>
                      <SelectItem value="MALE">Alex (male)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2 rounded-lg border p-3">
                <ToggleRow label="Chat" checked={chatEnabled} onChange={setChatEnabled} />
                <ToggleRow label="Voice" checked={voiceEnabled} onChange={setVoiceEnabled} />
                <ToggleRow
                  label="Video"
                  checked={voiceEnabled && videoEnabled}
                  onChange={setVideoEnabled}
                  disabled={!voiceEnabled}
                />
                <ToggleRow label="Anti-cheating" checked={antiCheatingEnabled} onChange={setAntiCheating} />
                <ToggleRow
                  label="Head movement detection"
                  checked={antiCheatingEnabled && headMovementDetectionEnabled}
                  onChange={setHeadMove}
                  disabled={!antiCheatingEnabled}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={update.isLoading}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={update.isLoading}>
            {update.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className={disabled ? "text-muted-foreground" : undefined}>{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
