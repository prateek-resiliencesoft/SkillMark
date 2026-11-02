import { AdminShell } from "@/components/admin/admin-shell";
import { getAuthUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) {
    redirect("/login?next=/admin");
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role, name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "ADMIN") {
    // Quiet redirect — no error page that leaks the admin surface.
    redirect("/organizations");
  }

  const operatorName =
    (profile.name as string | null) ||
    (profile.email as string | null) ||
    user.email ||
    null;

  return <AdminShell operatorName={operatorName}>{children}</AdminShell>;
}
