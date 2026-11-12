"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useOrg } from "@/components/org-provider";
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
import {
  INTERVIEWER_GENDER_OPTIONS,
  normalizeInterviewerGender,
  type InterviewerGender,
} from "@/lib/interviewer-persona";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function OrgSettingsGeneralPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { locale } = useAppLocale();
  const { currentOrg } = useOrg();
  const utils = trpc.useUtils();
  const isZh = locale === "zh";

  const [name, setName] = useState(currentOrg?.name ?? "");
  const [defaultInterviewerGender, setDefaultInterviewerGender] =
    useState<InterviewerGender>(
      normalizeInterviewerGender(currentOrg?.defaultInterviewerGender),
    );
  useEffect(() => {
    setName(currentOrg?.name ?? "");
    setDefaultInterviewerGender(
      normalizeInterviewerGender(currentOrg?.defaultInterviewerGender),
    );
  }, [currentOrg?.id, currentOrg?.name, currentOrg?.defaultInterviewerGender]);

  const updateMutation = trpc.organization.update.useMutation({
    onSuccess: () => {
      toast({ title: isZh ? "组织已更新" : "Organization updated" });
      utils.organization.list.invalidate();
    },
    onError: (err) => {
      toast({
        title: isZh ? "错误" : "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = trpc.organization.delete.useMutation({
    onSuccess: () => {
      toast({
        title: isZh ? "组织已关闭" : "Organization closed",
        description: isZh
          ? "成员将无法再访问此组织。"
          : "Members can no longer access this organization.",
      });
      utils.organization.list.invalidate();
      router.push("/organizations");
    },
    onError: (err) => {
      toast({
        title: isZh ? "错误" : "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const exportQuery = trpc.organization.exportData.useQuery(
    { organizationId: currentOrg?.id ?? "" },
    { enabled: false },
  );

  const handleExport = async () => {
    if (!currentOrg) return;
    try {
      const data = await exportQuery.refetch();
      if (!data.data) {
        toast({
          title: isZh ? "导出失败" : "Export failed",
          variant: "destructive",
        });
        return;
      }
      const blob = new Blob([JSON.stringify(data.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentOrg.slug || "organization"}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: isZh ? "导出已开始" : "Download started" });
    } catch (err) {
      toast({
        title: isZh ? "导出失败" : "Export failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  if (!currentOrg) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {isZh ? "尚未选择组织" : "No organization selected"}
      </div>
    );
  }

  const isOwner = currentOrg.role === "OWNER";
  const isAdmin = isOwner || currentOrg.role === "ADMIN";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{isZh ? "通用" : "General"}</h2>
        <p className="text-sm text-muted-foreground">
          {isZh ? "管理你的组织设置。" : "Manage your organization settings."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isZh ? "组织名称" : "Organization Name"}</CardTitle>
          <CardDescription>
            {isZh
              ? `你当前的组织名称是“${currentOrg.name}”。`
              : `Your organization is currently named "${currentOrg.name}".`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">{isZh ? "名称" : "Name"}</Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <Button
            onClick={() => updateMutation.mutate({ id: currentOrg.id, name })}
            disabled={
              updateMutation.isPending ||
              !name.trim() ||
              name === currentOrg.name
            }
          >
            {updateMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {isZh ? "保存" : "Save"}
          </Button>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{isZh ? "默认面试官" : "Default interviewer"}</CardTitle>
            <CardDescription>
              {isZh
                ? "新建面试时默认使用的面试官性别。单个面试仍可覆盖此设置。"
                : "Used when creating a new interview. You can still change it on each interview."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{isZh ? "面试官性别" : "Interviewer gender"}</Label>
              <Select
                value={defaultInterviewerGender}
                onValueChange={(v) =>
                  setDefaultInterviewerGender(v as InterviewerGender)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVIEWER_GENDER_OPTIONS.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {isZh ? g.labelZh : g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() =>
                updateMutation.mutate({
                  id: currentOrg.id,
                  defaultInterviewerGender,
                })
              }
              disabled={
                updateMutation.isPending ||
                defaultInterviewerGender ===
                  normalizeInterviewerGender(currentOrg.defaultInterviewerGender)
              }
            >
              {updateMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isZh ? "保存" : "Save"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{isZh ? "导出数据" : "Export data"}</CardTitle>
            <CardDescription>
              {isZh
                ? "下载组织、成员、项目和面试的摘要（JSON）。"
                : "Download a JSON summary of this organization, people, projects, and interviews."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exportQuery.isFetching}
            >
              {exportQuery.isFetching && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isZh ? "下载导出" : "Download export"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">
              {isZh ? "关闭组织" : "Close organization"}
            </CardTitle>
            <CardDescription>
              {isZh
                ? "关闭后成员将无法访问。可先导出数据。"
                : "Members lose access immediately. Export your data first if you need a copy."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  {isZh ? "关闭组织" : "Close organization"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {isZh
                      ? `关闭“${currentOrg.name}”？`
                      : `Close "${currentOrg.name}"?`}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {isZh
                      ? "组织将从成员列表中消失，待处理邀请会被取消。此操作面向所有者，请确认后继续。"
                      : "The organization will disappear from member lists and pending invites will be cancelled. Only the owner can do this."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {isZh ? "取消" : "Cancel"}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteMutation.mutate({ id: currentOrg.id })}
                  >
                    {deleteMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isZh ? "确认关闭" : "Close organization"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
