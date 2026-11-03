import { Illustration, NotFound } from "@/components/ui/not-found";

export default function NotFoundPage() {
  return (
    <div className="relative flex min-h-svh w-full flex-col justify-center bg-background p-6 md:p-10">
      <div className="relative mx-auto w-full max-w-5xl">
        <Illustration className="absolute inset-0 h-[50vh] w-full text-foreground opacity-[0.04] dark:opacity-[0.03]" />
        <NotFound
          title="Page not found"
          description="This link is missing, mistyped, or the surface is temporarily unavailable."
          homeHref="/dashboard"
        />
      </div>
    </div>
  );
}
