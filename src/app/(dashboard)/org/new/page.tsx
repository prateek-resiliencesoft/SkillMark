"use client";

import { useAppLocale } from "@/components/app-locale-provider";
import { useOrg } from "@/components/org-provider";
import { useTourSafe } from "@/components/tour/tour-provider";
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
import { createClient } from "@/lib/supabase/client";
import { trpc } from "@/lib/trpc/client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewOrgPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { locale } = useAppLocale();
  const utils = trpc.useUtils();
  const tour = useTourSafe();
  const { orgs, setCurrentOrg } = useOrg();
  const isZh = locale === "zh";
  const mustCreate = orgs.length === 0;
  const supabase = createClient();

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const createMutation = trpc.organization.create.useMutation({
    onSuccess: (org) => {
      utils.organization.list.invalidate();
      setCurrentOrg(org.id);
    },
    onError: (err) => {
      toast({
        title: isZh ? "错误" : "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await createMutation.mutateAsync({ name: trimmed });
      toast({ title: isZh ? "组织已创建" : "Organization created" });

      const onCreateOrgStep =
        tour?.active && tour.currentStep?.id === "create-org";
      if (onCreateOrgStep) {
        tour.completeStep("create-org");
      }
      // First-time onboarding: optional project step next. Extra orgs → org list.
      router.push(mustCreate ? "/projects/new?onboarding=1" : "/organizations");
    } catch {
      // mutation error already handled by onError
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card data-tour="create-org">
        <CardHeader>
          <CardTitle>
            {mustCreate
              ? isZh
                ? "创建你的组织"
                : "Name your organization"
              : isZh
                ? "创建组织"
                : "Create Organization"}
          </CardTitle>
          <CardDescription>
            {mustCreate
              ? isZh
                ? "Skillmark 是多租户产品。请输入组织名称后继续——此步骤不能跳过。"
                : "Skillmark is multitenant. Enter your organization name to continue — this step cannot be skipped."
              : isZh
                ? "创建一个新组织以与你的团队协作。"
                : "Create a new organization to collaborate with your team."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">
              {isZh ? "组织名称" : "Organization Name"}
            </Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isZh ? "例如：我的公司" : "e.g. Acme Hiring"}
              autoFocus
              required
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
              {!mustCreate && (
                <Button
                  variant="outline"
                  onClick={() => router.push("/organizations")}
                  disabled={loading}
                >
                  {isZh ? "取消" : "Cancel"}
                </Button>
              )}
              <Button
                className="flex-1"
                data-tour="create-org-submit"
                onClick={handleCreate}
                disabled={loading || !name.trim()}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isZh ? "创建组织" : "Create organization"}
              </Button>
            </div>
            {mustCreate && (
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => void handleSignOut()}
                disabled={loading}
              >
                {isZh ? "退出登录" : "Sign out"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
