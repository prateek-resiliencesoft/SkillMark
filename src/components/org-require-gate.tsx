"use client";

import { useOrg } from "@/components/org-provider";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

/** Only org creation is reachable until the user owns/joins a tenant. */
const ALLOWED_WITHOUT_ORG = ["/org/new"];

/**
 * Multitenant gate: signup does not create an org. User must name + create one.
 * No skip — every other dashboard route redirects here when orgs.length === 0.
 */
export function OrgRequireGate({ children }: { children: React.ReactNode }) {
  const { orgs, isLoading } = useOrg();
  const pathname = usePathname();
  const router = useRouter();

  const allowed = ALLOWED_WITHOUT_ORG.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  const needsOrg = !isLoading && orgs.length === 0 && !allowed;

  useEffect(() => {
    if (needsOrg) {
      router.replace("/org/new");
    }
  }, [needsOrg, router]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (needsOrg) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
