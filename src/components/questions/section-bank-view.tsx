"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  CircleDot,
  ClipboardCheck,
  Code2,
  Edit2,
  Layers,
  ListChecks,
  Loader2,
  MessageSquare,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  QuestionBankDialog,
  type QuestionBankItemData,
} from "./question-bank-dialog";

const SECTION_ICONS: Record<string, React.ElementType> = {
  "screening round": ClipboardCheck,
  "technical round": Code2,
  "hr round": Briefcase,
};

const TYPE_BADGES: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  OPEN_ENDED: {
    label: "Open Ended",
    icon: MessageSquare,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  SINGLE_CHOICE: {
    label: "Single Choice",
    icon: CircleDot,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  MULTIPLE_CHOICE: {
    label: "Multiple Choice",
    icon: ListChecks,
    className: "border-violet-500/30 bg-violet-500/10 text-violet-400",
  },
  CODING: {
    label: "Live Coding",
    icon: Code2,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
};

interface SectionBankViewProps {
  organizationId: string;
}

export function SectionBankView({ organizationId }: SectionBankViewProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  // Dialog states
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string>("");
  const [activeSectionName, setActiveSectionName] = useState<string>("");
  const [editingItem, setEditingItem] = useState<QuestionBankItemData | null>(null);

  // New section dialog
  const [newSectionDialogOpen, setNewSectionDialogOpen] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionDesc, setNewSectionDesc] = useState("");

  // Edit section dialog
  const [editSectionDialogOpen, setEditSectionDialogOpen] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState("");
  const [editSectionName, setEditSectionName] = useState("");
  const [editSectionDesc, setEditSectionDesc] = useState("");

  const { data: sections, isLoading } = trpc.questionBank.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, staleTime: 10_000 },
  );

  const toggleSectionMutation = trpc.questionBank.updateSection.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
    },
    onError: (err) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleItemMutation = trpc.questionBank.toggleItem.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
    },
    onError: (err) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteItemMutation = trpc.questionBank.deleteItem.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
      toast({ title: "Question Removed" });
    },
  });

  const createSectionMutation = trpc.questionBank.createSection.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
      setNewSectionDialogOpen(false);
      setNewSectionName("");
      setNewSectionDesc("");
      toast({ title: "Round Created" });
    },
  });

  const updateSectionMutation = trpc.questionBank.updateSection.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
      setEditSectionDialogOpen(false);
      toast({ title: "Round Updated" });
    },
  });

  const deleteSectionMutation = trpc.questionBank.deleteSection.useMutation({
    onSuccess: () => {
      utils.questionBank.list.invalidate();
      utils.questionBank.getEnabledQuestions.invalidate();
      toast({ title: "Round Deleted" });
    },
  });

  const handleOpenAddQuestion = (secId: string, secName: string) => {
    setActiveSectionId(secId);
    setActiveSectionName(secName);
    setEditingItem(null);
    setQuestionDialogOpen(true);
  };

  const handleOpenEditQuestion = (item: QuestionBankItemData, secName: string) => {
    setActiveSectionId(item.sectionId);
    setActiveSectionName(secName);
    setEditingItem(item);
    setQuestionDialogOpen(true);
  };

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    await createSectionMutation.mutateAsync({
      organizationId,
      name: newSectionName.trim(),
      description: newSectionDesc.trim() || undefined,
    });
  };

  const handleUpdateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSectionName.trim()) return;
    await updateSectionMutation.mutateAsync({
      id: editingSectionId,
      name: editSectionName.trim(),
      description: editSectionDesc.trim() || null,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Banner & Quick Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl border border-border/80 bg-card/70 backdrop-blur-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="font-heading text-lg font-bold tracking-tight text-foreground">
              Standardized Round Presets
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
            Configure default questions for each interview stage (Screening, Technical, HR). Enabled questions are automatically included in new interviews and injected into the AI Generator to produce complementary, non-overlapping questions.
          </p>
        </div>
        <Button
          onClick={() => setNewSectionDialogOpen(true)}
          className="shrink-0 gap-1.5 rounded-xl font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm shadow-primary/20"
        >
          <Plus className="h-4 w-4" />
          <span>Add Custom Round</span>
        </Button>
      </div>

      {/* Sections List */}
      <div className="space-y-6">
        {(sections ?? []).map((sec) => {
          const IconComponent =
            SECTION_ICONS[sec.name.toLowerCase()] ?? Layers;
          const activeCount = (sec.items as QuestionBankItemData[]).filter((i) => i.isEnabled).length;

          return (
            <Card
              key={sec.id}
              className={cn(
                "rounded-2xl border border-border/80 bg-card/90 shadow-md backdrop-blur-sm transition-all overflow-hidden",
                !sec.isEnabled && "opacity-75 border-border/40",
              )}
            >
              {/* Section Header */}
              <CardHeader className="p-5 sm:p-6 pb-4 border-b border-border/50 bg-muted/20">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="font-heading text-lg font-bold text-foreground">
                          {sec.name}
                        </CardTitle>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs font-semibold rounded-lg",
                            sec.isEnabled
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {activeCount} of {sec.items.length} active
                        </Badge>
                      </div>
                      {sec.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sec.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Section Controls */}
                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border/60 bg-background/80">
                      <Label
                        htmlFor={`sec-toggle-${sec.id}`}
                        className="text-xs font-medium cursor-pointer"
                      >
                        Auto-include in interviews
                      </Label>
                      <Switch
                        id={`sec-toggle-${sec.id}`}
                        checked={sec.isEnabled}
                        onCheckedChange={(checked) =>
                          toggleSectionMutation.mutate({
                            id: sec.id,
                            isEnabled: checked,
                          })
                        }
                      />
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleOpenAddQuestion(sec.id, sec.name)}
                      className="gap-1.5 rounded-xl text-xs font-semibold"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Question</span>
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingSectionId(sec.id);
                            setEditSectionName(sec.name);
                            setEditSectionDesc(sec.description || "");
                            setEditSectionDialogOpen(true);
                          }}
                        >
                          <Edit2 className="h-3.5 w-3.5 mr-2" /> Edit Round Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete round "${sec.name}" and all its questions?`)) {
                              deleteSectionMutation.mutate({ id: sec.id });
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Round
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>

              {/* Questions List */}
              <CardContent className="p-0">
                {sec.items.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No questions added to this round yet. Click &quot;Add Question&quot; to create one.
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {(sec.items as QuestionBankItemData[]).map((item, idx: number) => {
                      const typeMeta = TYPE_BADGES[item.type] ?? TYPE_BADGES.OPEN_ENDED;
                      const TypeIcon = typeMeta.icon;

                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "flex items-start sm:items-center justify-between gap-4 p-4 sm:px-6 transition-colors hover:bg-muted/30",
                            !item.isEnabled && "opacity-60 bg-muted/10",
                          )}
                        >
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground mt-0.5 sm:mt-0">
                              {idx + 1}
                            </span>
                            <div className="space-y-1 flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-sm text-foreground break-words">
                                  {item.text}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn("text-[10px] font-semibold py-0 px-2 rounded-md inline-flex items-center gap-1", typeMeta.className)}
                                >
                                  <TypeIcon className="h-2.5 w-2.5" />
                                  <span>{typeMeta.label}</span>
                                </Badge>
                              </div>
                              {item.description && (
                                <p className="text-xs text-muted-foreground line-clamp-1">
                                  {item.description}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Item Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center gap-1.5 mr-2">
                              <Switch
                                id={`item-toggle-${item.id}`}
                                checked={item.isEnabled}
                                onCheckedChange={(checked) => {
                                  if (!item.id) return;
                                  toggleItemMutation.mutate({
                                    id: item.id,
                                    isEnabled: checked,
                                  });
                                }}
                                aria-label="Toggle question inclusion"
                              />
                            </div>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenEditQuestion(item, sec.name)}
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (!item.id) return;
                                deleteItemMutation.mutate({ id: item.id });
                              }}
                              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Question Add/Edit Dialog */}
      <QuestionBankDialog
        open={questionDialogOpen}
        onOpenChange={setQuestionDialogOpen}
        sectionId={activeSectionId}
        sectionName={activeSectionName}
        organizationId={organizationId}
        initialData={editingItem}
      />

      {/* New Section Dialog */}
      <Dialog open={newSectionDialogOpen} onOpenChange={setNewSectionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Custom Interview Round</DialogTitle>
            <DialogDescription>
              Create a custom round to organize questions (e.g. &quot;Executive Interview&quot;, &quot;System Design&quot;).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSection} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="sec-name">Round Name</Label>
              <Input
                id="sec-name"
                placeholder="e.g. Leadership & Values Round"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sec-desc">Description (Optional)</Label>
              <Input
                id="sec-desc"
                placeholder="e.g. Behavioral questions around team leadership"
                value={newSectionDesc}
                onChange={(e) => setNewSectionDesc(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewSectionDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createSectionMutation.isLoading}>
                {createSectionMutation.isLoading && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Round
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Section Dialog */}
      <Dialog open={editSectionDialogOpen} onOpenChange={setEditSectionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Round Details</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateSection} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-sec-name">Round Name</Label>
              <Input
                id="edit-sec-name"
                value={editSectionName}
                onChange={(e) => setEditSectionName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-sec-desc">Description</Label>
              <Input
                id="edit-sec-desc"
                value={editSectionDesc}
                onChange={(e) => setEditSectionDesc(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditSectionDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateSectionMutation.isLoading}>
                {updateSectionMutation.isLoading && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
