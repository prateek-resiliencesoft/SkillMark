import { AuthSplitView } from "@/components/auth/auth-split-view";
import { Suspense } from "react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthSplitView defaultTab="login" />
    </Suspense>
  );
}

