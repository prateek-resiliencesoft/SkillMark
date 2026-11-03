"use client";

import { useEffect } from "react";
import { Illustration, NotFound } from "@/components/ui/not-found";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="relative flex min-h-svh w-full flex-col justify-center bg-background p-6 md:p-10">
      <div className="relative mx-auto w-full max-w-5xl">
        <Illustration className="absolute inset-0 h-[50vh] w-full text-foreground opacity-[0.04] dark:opacity-[0.03]" />
        <NotFound
          title="Something went wrong"
          description="This page hit an error or a dependency is down. Try again, or head home."
          homeHref="/dashboard"
        />
        <div className="mt-6 flex justify-center">
          <Button type="button" variant="outline" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
