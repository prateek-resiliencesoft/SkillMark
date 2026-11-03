import { DashboardShell } from "@/components/layout/sidebar";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { createClient } from "@/lib/supabase/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Org routing (server-side, on every full page load):
 * - No org at all        → /org/new (first-time users only).
 * - Has org(s), no valid active org (fresh login, or active org removed)
 *                        → /organizations?pick=1 (org picker), keeping the target in ?next=.
 * - Has org(s) + valid active org → page renders normally (dashboard etc.).
 * - /org/new is only reachable with ?create=1 once the user already has an org.
 */
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
  const search = headers().get("x-search") ?? "";
  const onOrgNew = pathname === "/org/new" || pathname.startsWith("/org/new/");
  const onPicker = pathname === "/organizations";
  const wantsCreate = new URLSearchParams(search).get("create") === "1";

  const { data: memberships, error: membershipError } = await supabase
    .from("organization_members")
    .select("organizationId, organization:organizations(status)")
    .eq("userId", user.id);

  if (membershipError) {
    // Never bounce a user to org creation because of a DB/query error.
    console.error("[dashboard-layout] membership lookup failed", membershipError.message);
    return <DashboardShell>{children}</DashboardShell>;
  }

  const orgIds = new Set(
    (memberships ?? [])
      .filter((m) => {
        const raw = m.organization as unknown;
        const org = (Array.isArray(raw) ? raw[0] : raw) as { status?: string } | null;
        return !!org && org.status !== "DELETED";
      })
      .map((m) => m.organizationId as string),
  );

  if (orgIds.size === 0) {
    if (!onOrgNew) redirect("/org/new");
  } else if (onOrgNew) {
    if (!wantsCreate) redirect("/organizations?pick=1");
  } else if (!onPicker && pathname) {
    const active = cookies().get(ACTIVE_ORG_COOKIE)?.value;
    if (!active || !orgIds.has(active)) {
      const next = pathname + search;
      redirect(`/organizations?pick=1&next=${encodeURIComponent(next)}`);
    }
  }

  return <DashboardShell>{children}</DashboardShell>;
}
