"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { useOrg } from "@/components/org-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function NewProjectForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const onboarding = searchParams.get("onboarding") === "1";
  const { toast } = useToast();
  const { locale } = useAppLocale();
  const utils = trpc.useUtils();
  const { currentOrg } = useOrg();
  const isZh = locale === "zh";

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const createMutation = trpc.project.create.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
    },
    onError: (err) => {
      toast({
        title: isZh ? "错误" : "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const finish = () => {
    router.push(onboarding ? "/dashboard" : "/projects");
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || !currentOrg) return;
    setLoading(true);
    try {
      await createMutation.mutateAsync({
        organizationId: currentOrg.id,
        name: trimmed,
      });
      toast({ title: isZh ? "项目已创建" : "Project created" });
      finish();
    } catch {
      // onError toast
    } finally {
      setLoading(false);
    }
  };

  if (!currentOrg) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {isZh ? "尚未选择组织" : "No organization selected"}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle>
            {onboarding
              ? isZh
                ? "创建第一个项目"
                : "Create your first project"
              : isZh
                ? "创建项目"
                : "Create Project"}
          </CardTitle>
          <CardDescription>
            {onboarding
              ? isZh
                ? "项目用来归类面试。可跳过，稍后在「项目」里创建。"
                : "Projects group interviews. You can skip and create one later."
              : isZh
                ? "创建一个新项目来组织面试。"
                : "Create a new project to organize interviews."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="projectName">{isZh ? "项目名称" : "Project name"}</Label>
            <Input
              id="projectName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                isZh ? "例如：工程招聘 Q1" : "e.g. Engineering Hiring Q1"
              }
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && !loading) {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
            />
          </div>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex items-center gap-3">
              {onboarding ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={finish}
                  disabled={loading}
                >
                  {isZh ? "跳过" : "Skip"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/projects")}
                  disabled={loading}
                >
                  {isZh ? "取消" : "Cancel"}
                </Button>
              )}
              <Button
                className="flex-1"
                onClick={() => void handleCreate()}
                disabled={loading || !name.trim()}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isZh ? "创建项目" : "Create project"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewProjectForm />
    </Suspense>
  );
}
