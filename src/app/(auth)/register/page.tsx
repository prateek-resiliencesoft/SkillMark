import { AuthSplitView } from "@/components/auth/auth-split-view";
import { Suspense } from "react";
import { googleConfig } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthSplitView googleEnabled={!!googleConfig()} defaultTab="register" />
    </Suspense>
  );
}

