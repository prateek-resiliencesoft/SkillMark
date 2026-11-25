import { AuthSplitView } from "@/components/auth/auth-split-view";
import { Suspense } from "react";
import { googleConfig } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthSplitView googleEnabled={!!googleConfig()} defaultTab="login" />
    </Suspense>
  );
}

