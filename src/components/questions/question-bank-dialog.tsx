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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export interface QuestionBankItemData {
  id?: string;
  sectionId: string;
  organizationId: string;
  text: string;
  description?: string | null;
  type: "OPEN_ENDED" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "CODING" | "WHITEBOARD" | "RESEARCH";
  options?: { options: string[] } | null;
  starterCode?: { language: string; code: string } | null;
  isEnabled?: boolean;
}

interface QuestionBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  sectionName?: string;
  organizationId: string;
  initialData?: QuestionBankItemData | null;
  onSuccess?: () => void;
}

export function QuestionBankDialog({
  open,
  onOpenChange,
  sectionId,
  sectionName,
  organizationId,
  initialData,
  onSuccess,
}: QuestionBankDialogProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<QuestionBankItemData["type"]>("OPEN_ENDED");
  const [options, setOptions] = useState<string[]>(["Option 1", "Option 2"]);
  const [codeLanguage, setCodeLanguage] = useState("typescript");
  const [starterCode, setStarterCode] = useState("// Write your solution here\n");
  const [isEnabled, setIsEnabled] = useState(true);

  useEffect(() => {
    if (initialData) {
      setText(initialData.text || "");
      setDescription(initialData.description || "");
      setType(initialData.type || "OPEN_ENDED");
      setIsEnabled(initialData.isEnabled ?? true);
      const optsObj = initialData.options as { options?: string[] } | null | undefined;
      if (optsObj && Array.isArray(optsObj.options)) {
        setOptions(optsObj.options);
      } else {
        setOptions(["Option 1", "Option 2"]);
      }
      if (initialData.starterCode) {
        setCodeLanguage(initialData.starterCode.language || "typescript");
        setStarterCode(initialData.starterCode.code || "");
      }
    } else {
      setText("");
      setDescription("");
      setType("OPEN_ENDED");
      setOptions(["Option 1", "Option 2"]);
      setCodeLanguage("typescript");
      setStarterCode("// Write your solution here\n");
      setIsEnabled(true);
    }
  }, [initialData, open]);

  const createMutation = trpc.questionBank.createItem.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
      toast({
        title: "Question Created",
        description: "Added to " + (sectionName || "section"),
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = trpc.questionBank.updateItem.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
      toast({
        title: "Question Updated",
        description: "Saved changes to question",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter the question text",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      text: text.trim(),
      description: description.trim() || undefined,
      type,
      isEnabled,
      options:
        type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE"
          ? { options: options.filter((o) => o.trim().length > 0) }
          : undefined,
      starterCode:
        type === "CODING"
          ? { language: codeLanguage, code: starterCode }
          : undefined,
    };

    if (initialData?.id) {
      await updateMutation.mutateAsync({
        id: initialData.id,
        ...payload,
      });
    } else {
      await createMutation.mutateAsync({
        sectionId,
        organizationId,
        ...payload,
      });
    }
  };

  const isSaving = createMutation.isLoading || updateMutation.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData?.id ? "Edit Premade Question" : "Add Premade Question"}
          </DialogTitle>
          <DialogDescription>
            {sectionName ? `Round: ${sectionName}. ` : ""}
            Standardized question added to interviews when this round is enabled.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Question Text */}
          <div className="space-y-1.5">
            <Label htmlFor="q-text" className="text-sm font-semibold">
              Question Prompt <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="q-text"
              placeholder="e.g. Please introduce yourself and your background."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              required
            />
          </div>

          {/* Helper / Evaluation Description */}
          <div className="space-y-1.5">
            <Label htmlFor="q-desc" className="text-xs text-muted-foreground font-medium">
              Objective / Evaluation Helper (Optional)
            </Label>
            <Input
              id="q-desc"
              placeholder="e.g. Evaluates communication clarity and confidence."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Question Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Question Type</Label>
              <Select
                value={type}
                onValueChange={(val) => setType(val as QuestionBankItemData["type"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN_ENDED">Open Ended (Verbal/Text)</SelectItem>
                  <SelectItem value="SINGLE_CHOICE">Single Choice</SelectItem>
                  <SelectItem value="MULTIPLE_CHOICE">Multiple Choice</SelectItem>
                  <SelectItem value="CODING">Live Coding</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col justify-end">
              <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/40">
                <Label htmlFor="q-enabled" className="text-xs font-medium cursor-pointer">
                  Auto-include in interviews
                </Label>
                <Switch
                  id="q-enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                />
              </div>
            </div>
          </div>

          {/* Choice options if applicable */}
          {(type === "SINGLE_CHOICE" || type === "MULTIPLE_CHOICE") && (
            <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
              <Label className="text-xs font-semibold">Options</Label>
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={opt}
                    onChange={(e) => {
                      const newOpts = [...options];
                      newOpts[idx] = e.target.value;
                      setOptions(newOpts);
                    }}
                    placeholder={`Option ${idx + 1}`}
                  />
                  {options.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOptions([...options, `Option ${options.length + 1}`])}
                className="mt-1 gap-1 text-xs"
              >
                <Plus className="h-3 w-3" /> Add Option
              </Button>
            </div>
          )}

          {/* Coding options if applicable */}
          {type === "CODING" && (
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Starter Code Language</Label>
                <Select value={codeLanguage} onValueChange={setCodeLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="typescript">TypeScript</SelectItem>
                    <SelectItem value="javascript">JavaScript</SelectItem>
                    <SelectItem value="python">Python</SelectItem>
                    <SelectItem value="java">Java</SelectItem>
                    <SelectItem value="cpp">C++</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Starter Code Template</Label>
                <Textarea
                  value={starterCode}
                  onChange={(e) => setStarterCode(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="gap-2">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {initialData?.id ? "Update Question" : "Add Question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
