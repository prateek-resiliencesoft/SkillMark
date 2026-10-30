import { DashboardShell } from "@/components/layout/sidebar";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const pathname = headers().get("x-pathname") ?? "";
  const onOrgNew = pathname === "/org/new" || pathname.startsWith("/org/new/");

  if (!onOrgNew) {
    const { data: memberships } = await supabase
      .from("organization_members")
      .select("workspaceId")
      .eq("userId", user.id)
      .limit(1);

    if (!memberships?.length) {
      redirect("/org/new");
    }
  }

  return <DashboardShell>{children}</DashboardShell>;
}
