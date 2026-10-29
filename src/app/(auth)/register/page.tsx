import { AuthSplitView } from "@/components/auth/auth-split-view";
import { Suspense } from "react";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthSplitView defaultTab="register" />
    </Suspense>
  );
}

